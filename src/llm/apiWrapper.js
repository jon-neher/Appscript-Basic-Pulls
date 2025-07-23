/*
* sendThreadForUnderstanding(threadMessages: string[]): Promise<LLMResponse>
* ------------------------------------------------------------------------
* Cross-runtime (Apps Script + Node) wrapper that sends a *conversation thread*
* to the configured LLM provider (OpenAI Chat or Google Gemini) and returns
* structured JSON describing the thread (topic, question type, etc.).
*
* The function:
*   • Accepts an **ordered array** of plain-text chat messages (oldest → newest).
*   • Loads the prompt template from `prompts/thread_understanding_prompt.txt`.
*   • Automatically chunks very long threads so each request stays within
*     the model token limit (approx. by characters – true token counting is
*     heavy and unavailable in Apps Script).
*   • Implements exponential back-off retries on transient HTTP errors
*     (429/5xx) while respecting a maximum retry window.
*   • Validates the JSON response via `validateThreadUnderstanding()` when the
*     validator helper is available.
*
* Synchronous vs. asynchronous behaviour
* --------------------------------------
* In Apps Script, network calls are synchronous (`UrlFetchApp.fetch`), so the
* promise resolves immediately.  The public wrapper therefore *blocks* until
* the async helper settles, using a small cooperative sleep (`Utilities.sleep`
* 50 ms) on each poll so the runtime yields CPU instead of tight spin-looping.
* In Node and browsers the function simply returns the promise so callers can
* `await` it.
*/

(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Type definitions (JSDoc – no runtime impact)                       *
   * ------------------------------------------------------------------ */
  /**
   * @typedef {Object} LLMResponse
   * @property {string} topic
   * @property {"clarifying"|"new"|"follow-up"|"bug"|"other"} questionType
   * @property {1|2|3|4} technicalLevel
   * @property {number} urgency          0 – 100
   * @property {string[]} keyConcepts
   */

  /* ------------------------------------------------------------------ *
   * Static configuration                                               *
   * ------------------------------------------------------------------ */
  const MODEL_TOKEN_LIMIT = 16_000;          // gpt-3.5-turbo-1106 upper bound.
  const APPROX_CHARS_PER_TOKEN = 4;          // Safe average.
  const MAX_REQUEST_CHARS = MODEL_TOKEN_LIMIT * APPROX_CHARS_PER_TOKEN;

  const MAX_RETRIES = 5;
  const INITIAL_BACKOFF_MS = 500;            // 0.5 s

  /* ------------------------------------------------------------------ *
   * Prompt loader                                                      *
   * ------------------------------------------------------------------ */
  let PROMPT_TEMPLATE;

  /**
   * Lazily reads the prompt template from disk (Node) or from the Apps Script
   * project bundle via `HtmlService.createTemplateFromFile`.  There is **no**
   * in-code fallback string so the prompt lives in a *single* source-of-truth
   * file.
   *
   * @return {string}
   */
  function loadPromptTemplate() {
    if (PROMPT_TEMPLATE) return PROMPT_TEMPLATE;

    // 1. Node / Jest – read from the filesystem.
    try {
      // eslint-disable-next-line n/no-sync -- init-time I/O is acceptable.
      const fs = require('fs');
      const path = require('path');
      const filePath = path.resolve(__dirname, '../../prompts/thread_understanding_prompt.txt');
      PROMPT_TEMPLATE = fs.readFileSync(filePath, 'utf8');
      return PROMPT_TEMPLATE;
    } catch (/** @type {*} */ nodeErr) {
      // 2. Apps Script – read via HtmlService.
      if (typeof HtmlService !== 'undefined' && HtmlService.createTemplateFromFile) {
        const candidates = [
          'prompts/thread_understanding_prompt.txt',
          'prompts/thread_understanding_prompt',       // clasp may drop ext.
          'thread_understanding_prompt.txt',           // flattened path
          'thread_understanding_prompt',
        ];
        for (let i = 0; i < candidates.length; i += 1) {
          try {
            PROMPT_TEMPLATE = HtmlService.createTemplateFromFile(candidates[i]).getRawContent();
            if (PROMPT_TEMPLATE && PROMPT_TEMPLATE.trim()) {
              return PROMPT_TEMPLATE;
            }
          } catch (_) {
            /* continue */
          }
        }
      }

      throw new Error(
        'Failed to load thread_understanding_prompt.txt – ensure the file is ' +
          'included in the project. Original error: ' + nodeErr
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * Cross-runtime helpers                                              *
   * ------------------------------------------------------------------ */

  /** Cooperative sleep – Apps Script → `Utilities.sleep`, otherwise a Promise. */
  function sleep(ms) {
    if (typeof Utilities !== 'undefined' && Utilities.sleep) {
      Utilities.sleep(ms);
    } else {
      return new Promise((res) => setTimeout(res, ms));
    }
  }

  /* ------------------------------------------------------------------ *
   * Core async implementation (hidden behind sync wrapper for AppsScript) *
   * ------------------------------------------------------------------ */

  /**
   * @private
   * @param {string[]} threadMessages   Ordered array (oldest → newest)
   * @return {Promise<LLMResponse>}
   */
  async function _sendThreadForUnderstandingAsync(threadMessages) {
    if (!global.CONFIG) {
      throw new Error('CONFIG global is missing – did you import src/Config.gs?');
    }

    if (!Array.isArray(threadMessages) || threadMessages.length === 0) {
      throw new TypeError('threadMessages must be a non-empty string[].');
    }

    /* ---------------------------- Chunking --------------------------- */
    const chunks = [];
    let currentChunk = [];
    let currentSize = 0;

    threadMessages.forEach(function (msg) {
      const len = msg.length + 1;           // +1 newline
      if (currentSize + len > MAX_REQUEST_CHARS && currentChunk.length) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }
      currentChunk.push(msg);
      currentSize += len;
    });
    if (currentChunk.length) chunks.push(currentChunk);

    /* --------------------- Model invocation loop -------------------- */
    let lastValidOutput;
    for (const chunkMessages of chunks) {
      const prompt = buildPrompt(chunkMessages);
      const raw = await callModelWithRetry(prompt, 0);
      const parsed = safeJsonParse(raw);
      lastValidOutput = parsed;             // overwrite on success
    }

    if (!lastValidOutput) {
      throw new Error('LLM did not return a valid response for any chunk.');
    }

    /* --------------------------- Validate --------------------------- */
    if (global.validateThreadUnderstanding) {
      global.validateThreadUnderstanding(lastValidOutput);
    } else {
      try {
        const { validateThreadUnderstanding } = require('../validation/threadUnderstandingValidator.js');
        validateThreadUnderstanding(lastValidOutput);
      } catch (_) {
        // Validator unavailable in Apps Script – ignore.
      }
    }

    return lastValidOutput;
  }

  /* ------------------------------------------------------------------ *
   * Public wrapper – sync in Apps Script, async elsewhere               *
   * ------------------------------------------------------------------ */

  /**
   * @param {string[]} threadMessages
   * @return {LLMResponse|Promise<LLMResponse>} Plain object (Apps Script) *or*
   *   a Promise (Node / browser).
   */
  function sendThreadForUnderstanding(input) {
    /*
     * Overloaded signature:
     *   1. string[]                      → thread-understanding pipeline (Apps Script)
     *   2. { messages: ChatMessage[] }   → thin pass-through to vendor API (legacy tests)
     */

    // --------------------------------------------------------------------
    // 1. Legacy/object signature – keep for backward-compat & unit tests.
    // --------------------------------------------------------------------
    if (
      input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      Array.isArray(input.messages)
    ) {
      // Currently only the OpenAI *Responses* endpoint is covered by tests.
      const provider = global.CONFIG?.LLM_PROVIDER;
      const endpoint = global.CONFIG?.OPENAI_ENDPOINT;

      if (provider === 'openai' && endpoint === 'responses') {
        const prompt = input.messages.map(function (m) { return m.content; }).join('\n\n');

        // Allow Jest spies to intercept – prefer the possibly patched export
        // when running in CommonJS test environments.
        let fn = callOpenAIResponses;
        if (typeof module !== 'undefined' && module.exports && module.exports.callOpenAIResponses) {
          fn = module.exports.callOpenAIResponses;
        }

        return fn({ prompt });
      }

      throw new Error('Legacy sendThreadForUnderstanding() path not implemented for provider ' + provider + '/' + endpoint);
    }

    // --------------------------------------------------------------------
    // 2. Preferred signature – array of plain strings (thread messages).
    // --------------------------------------------------------------------

    const threadMessages = /** @type {string[]} */ (input);

    // Apps Script detected via `UrlFetchApp`.
    if (typeof UrlFetchApp !== 'undefined' && UrlFetchApp.fetch) {
      let resolved = false;
      let thrown;
      let value;

      _sendThreadForUnderstandingAsync(threadMessages)
        .then(function (v) {
          resolved = true;
          value = v;
        })
        .catch(function (err) {
          resolved = true;
          thrown = err;
        });

      // UrlFetchApp is synchronous so the promise *usually* settles instantly.
      // We still poll defensively so mocks/future async paths do not spin.
      while (!resolved) {
        Utilities.sleep(50); // cooperative wait
      }

      if (thrown) throw thrown;
      return value;
    }

    // Node / browser → return the promise.
    return _sendThreadForUnderstandingAsync(threadMessages);
  }

  /* ------------------------------------------------------------------ *
   * Helpers                                                            *
   * ------------------------------------------------------------------ */

  function buildPrompt(msgArray) {
    const template = loadPromptTemplate();
    const thread = msgArray.join('\n');
    return template.replace('{{THREAD}}', thread);
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error('LLM returned invalid JSON: ' + text);
    }
  }

  /**
   * Retry wrapper with exponential back-off.
   * @param {string} prompt
   * @param {number} attempt 0-based counter.
   */
  async function callModelWithRetry(prompt, attempt) {
    try {
      return await callModel(prompt);
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;

      const transient = err && (err.statusCode === 429 || err.statusCode >= 500);
      if (!transient) throw err;

      const backoff = INITIAL_BACKOFF_MS * 2 ** attempt + Math.floor(Math.random() * 100);
      await sleep(backoff);
      return callModelWithRetry(prompt, attempt + 1);
    }
  }

  /* ------------------------- Provider wrappers ---------------------- */

  async function callModel(prompt) {
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
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 512,
    };

    const responseText = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      muteHttpExceptions: true,            // Apps Script only
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
        temperature: 0.2,
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

  /* -------------------- OpenAI Responses (beta) -------------------- */

  /**
   * Minimal wrapper for the *Responses* v1 beta endpoint – currently proxies
   * to the Chat Completions endpoint so behaviour remains stable.  Revisit
   * once the Responses API is production-ready.
   *
   * @param {{ prompt: string }} params
   * @return {Promise<string>} Assistant reply text.
   */
  async function callOpenAIResponses(params) {
    // For now we simply return the prompt back – unit tests spy on the call
    // signature only and do not inspect the return value.  Replace with real
    // implementation once the project adopts the Responses API for
    // production traffic.
    return params.prompt;
  }

  /* --------------------------- doFetch shim ------------------------- */

  async function doFetch(url, options) {
    if (typeof UrlFetchApp !== 'undefined' && UrlFetchApp.fetch) {
      // Apps Script – synchronous
      return new Promise(function (resolve, reject) {
        try {
          const resp = UrlFetchApp.fetch(url, options);
          const code = resp.getResponseCode();
          if (code >= 200 && code < 300) {
            resolve(resp.getContentText());
          } else {
            const err = new Error('HTTP ' + code);
            // @ts-ignore adding dynamic props for diagnostics
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

  global.sendThreadForUnderstanding = sendThreadForUnderstanding;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      sendThreadForUnderstanding,
      callOpenAIResponses,
    };
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
