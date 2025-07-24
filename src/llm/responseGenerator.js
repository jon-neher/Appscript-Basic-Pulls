/*
* generateContextualResponse(params)
* ------------------------------------------------------------------------
* Cross-runtime helper (Node + Google Apps Script) that generates a **conversation-aware**
* assistant reply using the configured LLM provider (OpenAI Chat or Google Gemini).
*
* The implementation combines the _conversation-memory_ support that landed on `main`
* with the improved prompt-truncation and Apps Script sync path from the feature branch
* (VEN-13).  Key properties:
*   • Preserves up to `MAX_MEMORY_ENTRIES` previous replies per conversation thread.
*   • Guarantees the final prompt string ≤ `MAX_REQUEST_CHARS`, budgeting room for the
*     truncation marker so the limit is never exceeded.
*   • Uses a fully synchronous path in Apps Script (no busy-wait loops) with
*     exponential-backoff retries.
*   • Provides an async Promise-based API in all other runtimes (Node, browser, Jest).
*
* Public API
* ----------
* generateContextualResponse({
*   original_messages: string[]|string,
*   llm_analysis:      object|string,
*   llm_recommendations: object|string,
*   team_info?:        object|string,
* }) ⇒ string  (Apps Script) | Promise<string> (elsewhere)
*/

(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants                                                          *
   * ------------------------------------------------------------------ */

  // Prompt-size constraints (roughly aligned with GPT-4o 128k context window
  // but kept conservative for forward compatibility).
  const MODEL_TOKEN_LIMIT = 16_000;
  const APPROX_CHARS_PER_TOKEN = 4;
  const MAX_REQUEST_CHARS = MODEL_TOKEN_LIMIT * APPROX_CHARS_PER_TOKEN; // 64k chars.

  // Conversation memory parameters.
  const MAX_MEMORY_ENTRIES = 5;    // Messages to keep per conversation.
  const MAX_CONVERSATIONS = 1_000; // Total conversations to keep in global map.

  // Retry/back-off parameters.
  const MAX_RETRIES = 5;
  const INITIAL_BACKOFF_MS = 500;

  /* ------------------------------------------------------------------ *
   * Prompt loader                                                      *
   * ------------------------------------------------------------------ */

  let PROMPT_TEMPLATE;

  /**
   * Load the `prompts/response_generation_prompt.txt` template in both Node
   * and Apps Script. Falls back to an inline stub so the function always
   * returns a string.
   * @return {string}
   */
  function loadPromptTemplate() {
    if (PROMPT_TEMPLATE) return PROMPT_TEMPLATE;

    // 1. Node/Jest – read from disk.
    try {
      // eslint-disable-next-line n/no-sync,import/no-dynamic-require
      const fs = require('fs');
      const path = require('path');
      const filePath = path.resolve(__dirname, '../../prompts/response_generation_prompt.txt');
      PROMPT_TEMPLATE = fs.readFileSync(filePath, 'utf8');
      return PROMPT_TEMPLATE;
    } catch (/** @type {*} */ nodeErr) {
      // 2. Apps Script – bundled via HtmlService.
      if (typeof HtmlService !== 'undefined' && HtmlService.createTemplateFromFile) {
        const candidates = [
          'prompts/response_generation_prompt.txt',
          'prompts/response_generation_prompt',
          'response_generation_prompt.txt',
          'response_generation_prompt',
        ];
        for (let i = 0; i < candidates.length; i += 1) {
          try {
            PROMPT_TEMPLATE = HtmlService.createTemplateFromFile(candidates[i]).getRawContent();
            if (PROMPT_TEMPLATE && PROMPT_TEMPLATE.trim()) return PROMPT_TEMPLATE;
          } catch (_) {
            /* try next */
          }
        }
      }

      // 3. Fallback minimal template so we never crash due to I/O errors.
      PROMPT_TEMPLATE =
        'ORIGINAL CONVERSATION:\n\n{{ORIGINAL_MESSAGES}}\n\n' +
        'ANALYSIS RESULTS:\n\n{{LLM_ANALYSIS}}\n\n' +
        'RECOMMENDATIONS:\n\n{{LLM_RECOMMENDATIONS}}\n\n' +
        'TEAM CONTEXT:\n\n{{TEAM_CONTEXT}}\n\n' +
        'CONVERSATION MEMORY:\n\n{{CONVERSATION_MEMORY}}\n\n' +
        'Respond in a natural, helpful style.';

      if (typeof console !== 'undefined' && console.warn) {
        console.warn('response_generation_prompt.txt missing – using built-in fallback');
        console.warn('Original error:', nodeErr);
      }

      return PROMPT_TEMPLATE;
    }
  }

  /* ------------------------------------------------------------------ *
   * Conversation memory (LRU)                                          *
   * ------------------------------------------------------------------ */

  const MEMORY_KEY = '__CONVERSATION_MEMORY__';
  /** @type {Map<string,string[]>} */
  const conversationMemory = (() => {
    if (global[MEMORY_KEY] && global[MEMORY_KEY] instanceof Map) return global[MEMORY_KEY];
    const map = new Map();
    Object.defineProperty(global, MEMORY_KEY, {
      value: map,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    return map;
  })();

  function computeHash(str) {
    // Apps Script – Utilities.computeDigest returns Uint8Array.
    if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
      const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str);
      return bytes
        .map((b) => ('0' + (b & 0xff).toString(16)).slice(-2))
        .join('');
    }

    // Node / browser – crypto module.
    try {
      // eslint-disable-next-line n/no-extraneous-import,import/no-extraneous-dependencies
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
    } catch (_) {
      // Last-ditch naive hash – never cryptographically strong but stable enough.
      let hash = 0;
      for (let i = 0; i < str.length; i += 1) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }
      return String(hash >>> 0);
    }
  }

  function buildConversationKey(msgArray) {
    return computeHash(msgArray.join('\u001E')); // Use unit separator to minimise collisions.
  }

  function setConversationMemory(key, arr) {
    // Evict LRU when inserting a new key at capacity.
    if (!conversationMemory.has(key) && conversationMemory.size >= MAX_CONVERSATIONS) {
      const oldest = conversationMemory.keys().next().value;
      conversationMemory.delete(oldest);
    }

    // Refresh insertion order (LRU behaviour).
    if (conversationMemory.has(key)) {
      conversationMemory.delete(key);
    }
    conversationMemory.set(key, arr);
  }

  /* ------------------------------------------------------------------ *
   * Public wrapper                                                     *
   * ------------------------------------------------------------------ */

  /**
   * Entry point used by the orchestration layer.
   * @param {object} params see top-of-file JSDoc.
   * @return {string|Promise<string>} synchronous in Apps Script.
   */
  function generateContextualResponse(params) {
    if (typeof UrlFetchApp !== 'undefined' && UrlFetchApp.fetch) {
      // Apps Script – synchronous path.
      return _generateContextualResponseSync(params);
    }

    // Node/browser – async.
    return _generateContextualResponseAsync(params);
  }

  /* ------------------------------------------------------------------ *
   * Core async implementation                                          *
   * ------------------------------------------------------------------ */

  async function _generateContextualResponseAsync(params) {
    validateParams(params);

    const originalArr = Array.isArray(params.original_messages)
      ? params.original_messages
      : [params.original_messages];

    const convKey = buildConversationKey(originalArr);
    const memoryArr = conversationMemory.get(convKey) || [];

    const prompt = buildPrompt(params, memoryArr.join('\n'));

    const safePrompt = truncatePrompt(prompt);

    const reply = await callModelWithRetry(safePrompt, 0);

    // Update memory and trim to capacity.
    const updated = memoryArr.concat(reply).slice(-MAX_MEMORY_ENTRIES);
    setConversationMemory(convKey, updated);

    return reply.trim();
  }

  /* ------------------------------------------------------------------ *
   * Core sync implementation (Apps Script only)                        *
   * ------------------------------------------------------------------ */

  function _generateContextualResponseSync(params) {
    validateParams(params);

    const originalArr = Array.isArray(params.original_messages)
      ? params.original_messages
      : [params.original_messages];

    const convKey = buildConversationKey(originalArr);
    const memoryArr = conversationMemory.get(convKey) || [];

    const prompt = buildPrompt(params, memoryArr.join('\n'));
    const safePrompt = truncatePrompt(prompt);

    const reply = callModelWithRetrySync(safePrompt, 0);

    const updated = memoryArr.concat(reply).slice(-MAX_MEMORY_ENTRIES);
    setConversationMemory(convKey, updated);

    return reply.trim();
  }

  /* ------------------------------------------------------------------ *
   * Prompt helpers                                                     *
   * ------------------------------------------------------------------ */

  function buildPrompt(p, memoryStr) {
    const tpl = loadPromptTemplate();

    const origStr = Array.isArray(p.original_messages)
      ? p.original_messages.join('\n')
      : String(p.original_messages);

    const analysisStr = stringifyChunk(p.llm_analysis);
    const recStr = stringifyChunk(p.llm_recommendations);
    const teamStr = stringifyChunk(p.team_info);

    return (
      tpl
        .replace('{{ORIGINAL_MESSAGES}}', origStr)
        .replace('{{LLM_ANALYSIS}}', analysisStr)
        .replace('{{LLM_RECOMMENDATIONS}}', recStr)
        .replace('{{TEAM_CONTEXT}}', teamStr)
        .replace('{{CONVERSATION_MEMORY}}', memoryStr || '')
    );
  }

  function stringifyChunk(chunk) {
    if (chunk == null) return '(none)';
    if (typeof chunk === 'string') return chunk;
    try {
      return JSON.stringify(chunk, null, 2);
    } catch (_) {
      return String(chunk);
    }
  }

  /* ------------------------------------------------------------------ *
   * Prompt size guard                                                  *
   * ------------------------------------------------------------------ */

  /**
   * Truncate the prompt to `MAX_REQUEST_CHARS` *including* the marker text.
   * Always preserves the beginning of the prompt because that contains the
   * system instructions and placeholders.
   * @param {string} prompt
   * @return {string}
   */
  function truncatePrompt(prompt) {
    if (prompt.length <= MAX_REQUEST_CHARS) return prompt;

    const marker = '\n[… truncated after ' + MAX_REQUEST_CHARS + ' chars …]';
    return prompt.slice(0, MAX_REQUEST_CHARS - marker.length) + marker;
  }

  /* ------------------------------------------------------------------ *
   * Retry wrappers                                                     *
   * ------------------------------------------------------------------ */

  async function callModelWithRetry(prompt, attempt) {
    try {
      return await callModel(prompt);
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;

      const transient = err && (err.statusCode === 429 || err.statusCode >= 500);
      if (!transient) throw err;

      const jitter = Math.floor(Math.random() * 100);
      const delay = INITIAL_BACKOFF_MS * 2 ** attempt + jitter;
      await sleep(delay);
      return callModelWithRetry(prompt, attempt + 1);
    }
  }

  function callModelWithRetrySync(prompt, attempt) {
    try {
      return callModelSync(prompt);
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;

      const transient = err && (err.statusCode === 429 || err.statusCode >= 500);
      if (!transient) throw err;

      const jitter = Math.floor(Math.random() * 100);
      const delay = INITIAL_BACKOFF_MS * 2 ** attempt + jitter;

      // Apps Script – Utilities.sleep is synchronous.
      if (typeof Utilities !== 'undefined' && Utilities.sleep) {
        Utilities.sleep(delay);
      } else {
        // Non-blocking fallback used only in tests.
        const start = Date.now();
        while (Date.now() - start < delay) {
          /* noop */
        }
      }

      return callModelWithRetrySync(prompt, attempt + 1);
    }
  }

  /* ------------------------------------------------------------------ *
   * Provider routing                                                   *
   * ------------------------------------------------------------------ */

  async function callModel(prompt) {
    if (!global.CONFIG) {
      throw new Error('CONFIG global is missing – did you load src/Config.gs?');
    }

    const provider = global.CONFIG.LLM_PROVIDER;
    if (provider === 'openai') return callOpenAI(prompt);
    if (provider === 'gemini') return callGemini(prompt);

    throw new Error('Unsupported LLM_PROVIDER "' + provider + '"');
  }

  function callModelSync(prompt) {
    if (!global.CONFIG) {
      throw new Error('CONFIG global is missing – did you load src/Config.gs?');
    }

    const provider = global.CONFIG.LLM_PROVIDER;
    if (provider === 'openai') return callOpenAISync(prompt);
    if (provider === 'gemini') return callGeminiSync(prompt);

    throw new Error('Unsupported LLM_PROVIDER "' + provider + '"');
  }

  /* ------------------------------------------------------------------ *
   * OpenAI implementation                                              *
   * ------------------------------------------------------------------ */

  async function callOpenAI(prompt) {
    const url = 'https://api.openai.com/v1/chat/completions';

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + global.CONFIG.OPENAI_API_KEY,
    };

    const body = {
      model: 'gpt-3.5-turbo-1106',
      messages: [
        { role: 'system', content: 'You are an experienced documentation assistant.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    };

    const responseText = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const json = JSON.parse(responseText);
    if (!json || !json.choices || !json.choices[0]?.message) {
      throw new Error('OpenAI unexpected response: ' + responseText);
    }

    return json.choices[0].message.content;
  }

  function callOpenAISync(prompt) {
    const url = 'https://api.openai.com/v1/chat/completions';

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + global.CONFIG.OPENAI_API_KEY,
    };

    const body = {
      model: 'gpt-3.5-turbo-1106',
      messages: [
        { role: 'system', content: 'You are an experienced documentation assistant.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    };

    const respText = doFetchSync(url, {
      method: 'post',
      headers,
      payload: JSON.stringify(body),
      contentType: 'application/json',
    });

    const json = JSON.parse(respText);
    if (!json || !json.choices || !json.choices[0]?.message) {
      throw new Error('OpenAI unexpected response: ' + respText);
    }

    return json.choices[0].message.content;
  }

  /* ------------------------------------------------------------------ *
   * Gemini implementation                                              *
   * ------------------------------------------------------------------ */

  async function callGemini(prompt) {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' +
      encodeURIComponent(global.CONFIG.GEMINI_API_KEY);

    const headers = { 'Content-Type': 'application/json' };

    const body = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
      },
    };

    const responseText = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const json = JSON.parse(responseText);
    if (!json || !json.candidates || !json.candidates[0]?.content) {
      throw new Error('Gemini unexpected response: ' + responseText);
    }

    const content = json.candidates[0].content;
    return content.parts.map((p) => p.text).join('');
  }

  function callGeminiSync(prompt) {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' +
      encodeURIComponent(global.CONFIG.GEMINI_API_KEY);

    const headers = { 'Content-Type': 'application/json' };

    const body = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
      },
    };

    const respText = doFetchSync(url, {
      method: 'post',
      headers,
      payload: JSON.stringify(body),
      contentType: 'application/json',
    });

    const json = JSON.parse(respText);
    if (!json || !json.candidates || !json.candidates[0]?.content) {
      throw new Error('Gemini unexpected response: ' + respText);
    }

    const content = json.candidates[0].content;
    return content.parts.map((p) => p.text).join('');
  }

  /* ------------------------------------------------------------------ *
   * Fetch shims                                                        *
   * ------------------------------------------------------------------ */

  async function doFetch(url, options) {
    if (typeof UrlFetchApp !== 'undefined' && UrlFetchApp.fetch) {
      // Apps Script – wrap the sync call in a Promise.
      return new Promise(function (resolve, reject) {
        try {
          const resp = UrlFetchApp.fetch(url, options);
          const code = resp.getResponseCode();
          if (code >= 200 && code < 300) {
            resolve(resp.getContentText());
          } else {
            const err = new Error('HTTP ' + code);
            // @ts-ignore mutable additions
            err.statusCode = code;
            // @ts-ignore
            err.body = resp.getContentText();
            reject(err);
          }
        } catch (e) {
          reject(e);
        }
      });
    }

    // Node / browser.
    const resp = await fetch(url, options);
    if (!resp.ok) {
      const err = new Error('HTTP ' + resp.status);
      // @ts-ignore
      err.statusCode = resp.status;
      // @ts-ignore
      err.body = await resp.text();
      throw err;
    }
    return resp.text();
  }

  function doFetchSync(url, options) {
    if (typeof UrlFetchApp === 'undefined' || !UrlFetchApp.fetch) {
      throw new Error('doFetchSync called outside Apps Script runtime');
    }

    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();
    if (code >= 200 && code < 300) return resp.getContentText();

    const err = new Error('HTTP ' + code);
    // @ts-ignore
    err.statusCode = code;
    // @ts-ignore
    err.body = resp.getContentText();
    throw err;
  }

  /* ------------------------------------------------------------------ *
   * Misc helpers                                                       *
   * ------------------------------------------------------------------ */

  function sleep(ms) {
    if (typeof Utilities !== 'undefined' && Utilities.sleep) {
      Utilities.sleep(ms);
    } else {
      return new Promise((res) => setTimeout(res, ms));
    }
  }

  function validateParams(p) {
    if (!p || typeof p !== 'object') {
      throw new TypeError('generateContextualResponse() expects a params object');
    }

    if (!p.original_messages || (Array.isArray(p.original_messages) && p.original_messages.length === 0)) {
      throw new TypeError('original_messages must be a non-empty string or string[]');
    }

    if (p.llm_analysis == null) throw new TypeError('llm_analysis is required');
    if (p.llm_recommendations == null) throw new TypeError('llm_recommendations is required');
  }

  /* ------------------------------------------------------------------ *
   * Exports                                                            *
   * ------------------------------------------------------------------ */

  global.generateContextualResponse = generateContextualResponse;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      generateContextualResponse,
    };
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
