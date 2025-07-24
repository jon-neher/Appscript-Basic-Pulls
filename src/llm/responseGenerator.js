/*
* generateContextualResponse(originalMessages, llmAnalysis, llmRecommendations, teamContext?)
* ----------------------------------------------------------------------------------------
* Cross-runtime (Apps Script + Node) helper that produces **conversation-aware** assistant
* replies.  It consumes the structured thread understanding output plus any recommendation
* objects and turns them into a natural language reply that:
*   • Matches the existing tone and formality of the conversation.
*   • Provides concrete, actionable guidance with examples.
*   • Mentions relevant documentation pages/sections.
*   • Suggests next steps tailored to the requesting team.
*   • Persists *conversation memory* so follow-up calls to the function inside the same
*     runtime can reference previous answers without callers needing to resend them.
*
* API parity with `src/llm/apiWrapper.js`: the public export behaves synchronously when
* running inside Apps Script (blocking until the async model call resolves) and returns a
* Promise everywhere else.
*/

(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Static configuration & memory store                                *
   * ------------------------------------------------------------------ */

  const MAX_MEMORY_ENTRIES = 5; // limit per conversation to avoid bloat per thread.

  // Global cap on conversations stored (LRU eviction).
  const MAX_CONVERSATIONS = 1000;

  // Re-use a single Map across multiple module evaluations (Jest isolates each test
  // in its own Node context, but Apps Script executes in a single global scope).
  const MEMORY_KEY = '__CONVERSATION_MEMORY__';
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

  /* ------------------------------------------------------------------ *
   * Prompt loader                                                      *
   * ------------------------------------------------------------------ */

  let PROMPT_TEMPLATE;

  function loadPromptTemplate() {
    if (PROMPT_TEMPLATE) return PROMPT_TEMPLATE;

    // 1. Node / Jest – read from disk.
    try {
      // eslint-disable-next-line n/no-sync -- single initialisation I/O.
      const fs = require('fs');
      const path = require('path');
      const filePath = path.resolve(__dirname, '../../prompts/response_generation_prompt.txt');
      PROMPT_TEMPLATE = fs.readFileSync(filePath, 'utf8');
      return PROMPT_TEMPLATE;
    } catch (/** @type {*} */ nodeErr) {
      // 2. Apps Script – HtmlService bundle fallback.
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

      // 3. Hard-coded minimal fallback so the function never crashes because of I/O.
      PROMPT_TEMPLATE =
        'ORIGINAL CONVERSATION:\n\n{{ORIGINAL_MESSAGES}}\n\n' +
        'ANALYSIS RESULTS:\n\n{{LLM_ANALYSIS}}\n\n' +
        'RECOMMENDATIONS:\n\n{{LLM_RECOMMENDATIONS}}\n\n' +
        'TEAM CONTEXT:\n\n{{TEAM_CONTEXT}}\n\n' +
        'CONVERSATION MEMORY:\n\n{{CONVERSATION_MEMORY}}\n\n' +
        'Respond in a natural, helpful style.';

      // eslint-disable-next-line no-console -- helpful during local dev, ignored in Apps Script.
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('response_generation_prompt.txt missing – using built-in fallback');
      }

      return PROMPT_TEMPLATE;
    }
  }

  /* ------------------------------------------------------------------ *
   * Public wrapper                                                     *
   * ------------------------------------------------------------------ */

  /**
   * @param {string[]} originalMessages
   * @param {string|object} llmAnalysis
   * @param {string|object} llmRecommendations
   * @param {string|object} [teamContext]
   * @return {string|Promise<string>} assistant reply – plain string.
   */
  function generateContextualResponse(
    originalMessages,
    llmAnalysis,
    llmRecommendations,
    teamContext
  ) {
    // Apps Script runtime → fully synchronous path (no busy-wait).
    if (typeof UrlFetchApp !== 'undefined' && UrlFetchApp.fetch) {
      return _generateContextualResponseSync(
        originalMessages,
        llmAnalysis,
        llmRecommendations,
        teamContext
      );
    }

    // Node/browser → return Promise.
    return _generateContextualResponseAsync(
      originalMessages,
      llmAnalysis,
      llmRecommendations,
      teamContext
    );
  }

  /* ------------------------------------------------------------------ *
   * Core async implementation                                          *
   * ------------------------------------------------------------------ */

  async function _generateContextualResponseAsync(
    originalMessages,
    llmAnalysis,
    llmRecommendations,
    teamContext
  ) {
    // ----------------------------- Validation ----------------------------
    if (!Array.isArray(originalMessages) || originalMessages.length === 0) {
      throw new TypeError('original_messages must be a non-empty string[]');
    }

    // Accept analysis / recommendations as objects or strings – stringify if needed.
    const analysisStr =
      typeof llmAnalysis === 'string' ? llmAnalysis : JSON.stringify(llmAnalysis, null, 2);
    const recsStr =
      typeof llmRecommendations === 'string'
        ? llmRecommendations
        : JSON.stringify(llmRecommendations, null, 2);
    const teamStr =
      teamContext == null ? 'N/A' : typeof teamContext === 'string' ? teamContext : JSON.stringify(teamContext, null, 2);

    // ------------------------ Conversation memory ------------------------
    const convKey = buildConversationKey(originalMessages);
    const memArr = conversationMemory.get(convKey) || [];
    const memoryStr = memArr.join('\n');

    // ------------------------------ Prompt ------------------------------
    const template = loadPromptTemplate();
    let prompt = template
      .replace('{{ORIGINAL_MESSAGES}}', originalMessages.join('\n'))
      .replace('{{LLM_ANALYSIS}}', analysisStr)
      .replace('{{LLM_RECOMMENDATIONS}}', recsStr)
      .replace('{{TEAM_CONTEXT}}', teamStr)
      .replace('{{CONVERSATION_MEMORY}}', memoryStr || '');

    // ------------------------------- Call -------------------------------
    const reply = await callModelWithRetry(prompt, 0);

    // ----------------------- Update conversation memory -----------------
    const updated = memArr.concat(reply).slice(-MAX_MEMORY_ENTRIES);
    setConversationMemory(convKey, updated);

    return reply;
  }

  /* ------------------------------------------------------------------ *
   * Core sync implementation (Apps Script only)                        *
   * ------------------------------------------------------------------ */

  function _generateContextualResponseSync(
    originalMessages,
    llmAnalysis,
    llmRecommendations,
    teamContext
  ) {
    // Validation
    if (!Array.isArray(originalMessages) || originalMessages.length === 0) {
      throw new TypeError('original_messages must be a non-empty string[]');
    }

    const analysisStr =
      typeof llmAnalysis === 'string' ? llmAnalysis : JSON.stringify(llmAnalysis, null, 2);
    const recsStr =
      typeof llmRecommendations === 'string'
        ? llmRecommendations
        : JSON.stringify(llmRecommendations, null, 2);
    const teamStr =
      teamContext == null ? 'N/A' : typeof teamContext === 'string' ? teamContext : JSON.stringify(teamContext, null, 2);

    const convKey = buildConversationKey(originalMessages);
    const memArr = conversationMemory.get(convKey) || [];
    const memoryStr = memArr.join('\n');

    const template = loadPromptTemplate();
    const prompt = template
      .replace('{{ORIGINAL_MESSAGES}}', originalMessages.join('\n'))
      .replace('{{LLM_ANALYSIS}}', analysisStr)
      .replace('{{LLM_RECOMMENDATIONS}}', recsStr)
      .replace('{{TEAM_CONTEXT}}', teamStr)
      .replace('{{CONVERSATION_MEMORY}}', memoryStr || '');

    // Synchronous call with transient-failure retry & exponential backoff.
    const reply = callModelWithRetrySync(prompt, 0);

    const updated = memArr.concat(reply).slice(-MAX_MEMORY_ENTRIES);
    setConversationMemory(convKey, updated);

    return reply;
  }

  /* ----------------------- Sync provider routing ---------------------- */

  function callModelSync(prompt) {
    if (!global.CONFIG) {
      throw new Error('CONFIG global is missing – did you load src/Config.gs?');
    }

    const provider = global.CONFIG.LLM_PROVIDER;
    if (provider === 'openai') return callOpenAISync(prompt);
    if (provider === 'gemini') return callGeminiSync(prompt);

    throw new Error('Unsupported LLM_PROVIDER "' + provider + '"');
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
        { role: 'system', content: 'You are a helpful engineering assistant.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 512,
    };

    const responseText = doFetchSync(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      muteHttpExceptions: true,
    });

    const json = JSON.parse(responseText);
    if (!json || !json.choices || !json.choices[0]?.message) {
      throw new Error('OpenAI unexpected response: ' + responseText);
    }

    return json.choices[0].message.content.trim();
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
        maxOutputTokens: 512,
      },
    };

    const responseText = doFetchSync(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      muteHttpExceptions: true,
    });

    const json = JSON.parse(responseText);
    if (!json || !json.candidates || !json.candidates[0]?.content) {
      throw new Error('Gemini unexpected response: ' + responseText);
    }

    const geminiContent = json.candidates[0].content;
    return geminiContent.parts.map(function (p) {
      return p.text;
    }).join('').trim();
  }

  function doFetchSync(url, options) {
    if (typeof UrlFetchApp === 'undefined' || !UrlFetchApp.fetch) {
      throw new Error('doFetchSync called outside Apps Script runtime');
    }

    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();
    if (code >= 200 && code < 300) {
      return resp.getContentText();
    }

    const err = new Error('HTTP ' + code);
    // @ts-ignore dynamic props
    err.statusCode = code;
    // @ts-ignore
    err.body = resp.getContentText();
    throw err;
  }

  /* ------------------------------------------------------------------ *
   * Helpers                                                            *
   * ------------------------------------------------------------------ */

  /**
   * Compute a stable SHA-256 hash across runtimes.
   * @param {string} str
   * @return {string} lowercase hex digest
   */
  function computeHash(str) {
    // Apps Script – Utilities.computeDigest returns Uint8Array.
    if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
      const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str);
      return bytes
        .map(function (b) {
          return ('0' + (b & 0xff).toString(16)).slice(-2);
        })
        .join('');
    }

    // Node / browser with crypto.
    try {
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
    } catch (_) {
      // Fallback – very unlikely; use naive hash.
      let hash = 0;
      for (let i = 0; i < str.length; i += 1) {
        // simple hashCode algorithm
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0; // convert to 32-bit int
      }
      return String(hash >>> 0);
    }
  }

  function buildConversationKey(msgArray) {
    return computeHash(msgArray.join('\u001E')); // Use unit separator to avoid accidental joins.
  }

  /**
   * Persist a conversation slice, evicting the oldest entry if needed to stay within capacity.
   * This implements a simple LRU policy based on Map insertion order.
   * @param {string} key
   * @param {string[]} arr
   */
  function setConversationMemory(key, arr) {
    // Evict oldest conversation when at capacity and inserting a new key.
    if (!conversationMemory.has(key) && conversationMemory.size >= MAX_CONVERSATIONS) {
      const oldestKey = conversationMemory.keys().next().value;
      conversationMemory.delete(oldestKey);
    }

    // Refresh insertion order so recently used conversations drift to the end.
    if (conversationMemory.has(key)) {
      conversationMemory.delete(key);
    }

    conversationMemory.set(key, arr);
  }

  /* --------------------------- Model access ------------------------- */

  const MAX_RETRIES = 5;
  const INITIAL_BACKOFF_MS = 500;

  async function callModelWithRetry(prompt, attempt) {
    try {
      return await callModel(prompt);
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;

      const transient = err && (err.statusCode === 429 || err.statusCode >= 500);
      if (!transient) throw err;

      await sleep(INITIAL_BACKOFF_MS * 2 ** attempt + Math.floor(Math.random() * 100));
      return callModelWithRetry(prompt, attempt + 1);
    }
  }

  /* ------------------------------ Sleep ---------------------------- */

  function sleep(ms) {
    if (typeof Utilities !== 'undefined' && Utilities.sleep) {
      Utilities.sleep(ms);
    } else {
      return new Promise((res) => setTimeout(res, ms));
    }
  }

  /* -------------------- Sync retry helper ------------------------- */

  /**
   * Synchronous retry wrapper for Apps Script executions.
   * Implements exponential backoff with jitter, mirroring the async helper.
   *
   * @param {string} prompt
   * @param {number} attempt 0-based attempt counter
   * @returns {string} model reply
   */
  function callModelWithRetrySync(prompt, attempt) {
    try {
      return callModelSync(prompt);
    } catch (/** @type {*} */ err) {
      const transient = err && (err.statusCode === 429 || err.statusCode >= 500);

      if (!transient || attempt >= MAX_RETRIES) {
        throw err; // rethrow non-transient or exhausted retries.
      }

      const jitter = Math.floor(Math.random() * 100);
      const delayMs = INITIAL_BACKOFF_MS * 2 ** attempt + jitter;

      if (typeof Utilities !== 'undefined' && Utilities.sleep) {
        Utilities.sleep(delayMs);
      } else {
        // Fallback busy-sleep (should never hit in Apps Script runtime).
        const end = Date.now() + delayMs;
        while (Date.now() < end) {
          /* noop */
        }
      }

      return callModelWithRetrySync(prompt, attempt + 1);
    }
  }

  /* ------------------------- Provider routing ---------------------- */

  async function callModel(prompt) {
    if (!global.CONFIG) {
      throw new Error('CONFIG global is missing – did you load src/Config.gs?');
    }

    const provider = global.CONFIG.LLM_PROVIDER;
    if (provider === 'openai') return callOpenAI(prompt);
    if (provider === 'gemini') return callGemini(prompt);

    throw new Error('Unsupported LLM_PROVIDER "' + provider + '"');
  }

  /* ------------------------------ OpenAI ---------------------------- */

  async function callOpenAI(prompt) {
    const url = 'https://api.openai.com/v1/chat/completions';

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + global.CONFIG.OPENAI_API_KEY,
    };

    const body = {
      model: 'gpt-3.5-turbo-1106',
      messages: [
        { role: 'system', content: 'You are a helpful engineering assistant.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 512,
    };

    const responseText = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      muteHttpExceptions: true,
    });

    const json = JSON.parse(responseText);
    if (!json || !json.choices || !json.choices[0]?.message) {
      throw new Error('OpenAI unexpected response: ' + responseText);
    }

    return json.choices[0].message.content.trim();
  }

  /* ------------------------------ Gemini --------------------------- */

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
        maxOutputTokens: 512,
      },
    };

    const responseText = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      muteHttpExceptions: true,
    });

    const json = JSON.parse(responseText);
    if (!json || !json.candidates || !json.candidates[0]?.content) {
      throw new Error('Gemini unexpected response: ' + responseText);
    }

    const geminiContent = json.candidates[0].content;
    return geminiContent.parts.map((p) => p.text).join('').trim();
  }

  /* --------------------------- doFetch shim ------------------------- */

  async function doFetch(url, options) {
    if (typeof UrlFetchApp !== 'undefined' && UrlFetchApp.fetch) {
      return new Promise(function (resolve, reject) {
        try {
          const resp = UrlFetchApp.fetch(url, options);
          const code = resp.getResponseCode();
          if (code >= 200 && code < 300) {
            resolve(resp.getContentText());
          } else {
            const err = new Error('HTTP ' + code);
            // @ts-ignore dynamic props
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

    // Node / browser
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

  /* ------------------------------------------------------------------ *
   * Exports                                                           *
   * ------------------------------------------------------------------ */

  global.generateContextualResponse = generateContextualResponse;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      generateContextualResponse,
    };
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
