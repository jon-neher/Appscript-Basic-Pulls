/**
* Unified wrapper around the different LLM vendor REST APIs used by the
* project (currently OpenAI and Gemini).
*
* The module is designed for dual-runtime execution:
*   • Google Apps Script – uses the global `UrlFetchApp` service.
*   • Node/Jest – falls back to the global `fetch()` implementation bundled
*     with modern Node (v18+) or any pony-fill the consumer provides.
*
* Configuration is sourced from the `CONFIG` object declared in
* `src/Config.gs`.  In the Apps Script runtime the object is available as
* a global.  In Node/Jest we `require()` the module directly so that the
* same immutable object instance is shared without duplication.
*
* Public API (keep stable – **do not** rename without migration):
*   • sendThreadForUnderstanding({ messages }): Promise<string>
*
* Internal helpers (`callOpenAIChat()`, `callOpenAIResponses()`,
* `callGemini()`) may change freely as long as their *external observable*
* behaviour stays consistent with the public API.
*/

(function (global) {
  'use strict';

  /* ----------------------------------------------------------------------- */
  /* Environment detection                                                   */
  /* ----------------------------------------------------------------------- */

  /** @type {boolean} */
  const isAppsScript = typeof global.UrlFetchApp !== 'undefined';

  /**
   * Simplistic fetch abstraction so that the same code runs in both
   * environments.  Apps Script already exposes a UrlFetch service that does
   * not conform to the WHATWG Fetch API.  A tiny adapter is enough for the
   * subset of features required here (JSON POST).
   *
   * @param {string} url
   * @param {RequestInit} init
   * @return {Promise<Response>}
   */
  function universalFetch(url, init) {
    if (isAppsScript) {
      /** @type {GoogleAppsScript.URL_Fetch.URLFetchRequestOptions} */
      const options = {
        method: init.method || 'get',
        muteHttpExceptions: false,
        headers: init.headers,
        payload: init.body,
        contentType: 'application/json',
      };

      return Promise.resolve(global.UrlFetchApp.fetch(url, options)).then(
        /**
         * @param {GoogleAppsScript.URL_Fetch.HTTPResponse} res
         * @return {Response}
         */
        function (res) {
          // Minimal Response shim tailored for `.json()` consumption.
          return {
            ok: res.getResponseCode() >= 200 && res.getResponseCode() < 300,
            status: res.getResponseCode(),
            json: function () {
              return Promise.resolve(JSON.parse(res.getContentText()));
            },
            text: function () {
              return Promise.resolve(res.getContentText());
            },
          };
        }
      );
    }

    // Standard WHATWG fetch (Node >=18 ships one; else user must poly-fill).
    return global.fetch(url, init);
  }

  /* ----------------------------------------------------------------------- */
  /* Config helper                                                           */
  /* ----------------------------------------------------------------------- */

  // CONFIG is available as a global in Apps Script.  In Node/Jest we need to
  // import the CommonJS export from the .gs source file.
  /** @type {import('../Config.gs').CONFIG} */
  const CONFIG = global.CONFIG || require('../Config.gs').CONFIG;

  /* ----------------------------------------------------------------------- */
  /* Provider-specific implementations                                       */
  /* ----------------------------------------------------------------------- */

  /**
   * Shared OpenAI request helper.
   *
   * @param {Object} params
   * @param {string} params.path         Request path after api.openai.com/v1/
   * @param {Object} params.body         JSON payload (already serialisable).
   * @param {boolean} [params.includeBetaHeader=false] Whether to include
   *                      `OpenAI-Beta: responses=v1` header.
   * @return {Promise<any>} Parsed JSON response.
   */
  async function openaiRequest({ path, body, includeBetaHeader = false }) {
    if (!CONFIG.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured.');
    }

    const url = `https://api.openai.com/v1/${path}`;

    /** @type {HeadersInit} */
    const headers = {
      'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    };

    if (includeBetaHeader) {
      headers['OpenAI-Beta'] = 'responses=v1';
    }

    const res = await universalFetch(url, {
      method: 'post',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI request failed (${res.status}): ${errText}`);
    }

    return res.json();
  }

  /**
   * Calls the Chat Completions endpoint (`/chat/completions`).
   *
   * @param {{ messages: { role: string, content: string }[], temperature?: number }} params
   * @return {Promise<string>} The assistant message content.
   */
  async function callOpenAIChat(params) {
    const { messages, temperature = 0.7 } = params;

    const modelId = CONFIG.OPENAI_MODEL_ID || 'gpt-3.5-turbo';

    const json = await openaiRequest({
      path: 'chat/completions',
      body: {
        model: modelId,
        messages,
        temperature,
      },
    });

    // Defensive – ensure structure we expect is present.
    if (!json.choices || !json.choices.length) {
      throw new Error('OpenAI chat: response missing choices');
    }

    // eslint-disable-next-line prefer-destructuring
    const content = json.choices[0].message.content;
    return content;
  }

  /**
   * Calls the (beta) Responses v1 endpoint.
   * https://platform.openai.com/docs/api-reference/responses/create
   *
   * This endpoint is currently gated behind the `responses=v1` beta header.
   * The header is only attached when `CONFIG.RESPONSES_BETA === true` so that
   * projects can opt-in explicitly.
   *
   * @param {{ prompt: string, temperature?: number }} params
   * @return {Promise<string>} The generated text.
   */
  async function callOpenAIResponses(params) {
    const { prompt, temperature = 0.7 } = params;

    const modelId = CONFIG.OPENAI_MODEL_ID || 'gpt-3.5-turbo';

    const json = await openaiRequest({
      path: 'responses',
      body: {
        model: modelId,
        prompt,
        temperature,
      },
      includeBetaHeader: !!CONFIG.RESPONSES_BETA,
    });

    if (!json.choices || !json.choices.length) {
      throw new Error('OpenAI responses: response missing choices');
    }

    // API shape mirrors chat/completions albeit with top-level text instead of
    // message objects.
    // eslint-disable-next-line prefer-destructuring
    const content = json.choices[0].text || json.choices[0].message?.content;
    return content;
  }

  /**
   * Calls the Gemini Pro REST endpoint via the public Generative Language API.
   * Docs: https://ai.google.dev/gemini-api/docs/api/update
   *
   * @param {{ messages: { role: 'user'|'assistant', content: string }[] }} params
   * @return {Promise<string>} Assistant response.
   */
  async function callGemini(params) {
    if (!CONFIG.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured.');
    }

    const { messages } = params;

    const modelId = CONFIG.GEMINI_MODEL_ID || 'gemini-pro';
    const url = `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=${encodeURIComponent(
      CONFIG.GEMINI_API_KEY
    )}`;

    const body = {
      contents: messages.map(function (m) {
        return {
          role: m.role,
          parts: [{ text: m.content }],
        };
      }),
    };

    const res = await universalFetch(url, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini request failed (${res.status}): ${errText}`);
    }

    const json = await res.json();

    if (!json.candidates || !json.candidates.length) {
      throw new Error('Gemini: response missing candidates');
    }

    // eslint-disable-next-line prefer-destructuring
    const content = json.candidates[0].content.parts[0].text;
    return content;
  }

  /* ----------------------------------------------------------------------- */
  /* Adapter layer                                                           */
  /* ----------------------------------------------------------------------- */

  /**
   * Mapping of provider identifiers → endpoint → implementation.
   *
   * New providers or endpoints can be added here without touching the router
   * logic further down.
   */
  const PROVIDERS = Object.freeze({
    openai: Object.freeze({
      chat: callOpenAIChat,
      responses: callOpenAIResponses,
    }),
    gemini: Object.freeze({
      default: callGemini,
    }),
  });

  /**
   * Top-level helper used by the rest of the codebase.  Accepts a chat
   * history and returns the assistant response using the provider configured
   * in `CONFIG`.
   *
   * The current implementation maps *directly* onto the underlying vendor
   * API.  In the future we may add retries, rate-limit handling, tracing, or
   * other cross-cutting concerns here – callers stay unaffected.
   *
   * @param {{ messages: { role: string, content: string }[] }} params
   * @return {Promise<string>} Assistant reply.
   */
  function sendThreadForUnderstanding(params) {
    const { messages } = params;

    const providerName = CONFIG.LLM_PROVIDER;

    if (!providerName || !(providerName in PROVIDERS)) {
      throw new Error(`Unsupported LLM_PROVIDER "${providerName}".`);
    }

    // Resolve endpoint key – for OpenAI we allow switching between chat and
    // responses.  For Gemini we always use the single default endpoint.
    let endpointKey = 'default';
    if (providerName === 'openai') {
      endpointKey = CONFIG.OPENAI_ENDPOINT === 'responses' ? 'responses' : 'chat';
    }

    const providerObj = PROVIDERS[providerName];

    if (!(endpointKey in providerObj)) {
      throw new Error(
        `Endpoint "${endpointKey}" not implemented for provider "${providerName}".`
      );
    }

    // Build parameter object as expected by the resolved endpoint.  The
    // beta *Responses* API takes a **flat prompt string** whereas the chat
    // endpoints (OpenAI Chat & Gemini) expect an array of `{ role, content }`
    // messages.  Convert only when we are on the OpenAI → responses branch so
    // that all legacy paths remain 100 % backward-compatible.

    const isOpenAiResponses =
      providerName === 'openai' && CONFIG.OPENAI_ENDPOINT === 'responses';

    /** @type {{ messages?: any; prompt?: string }} */
    const fnParams = isOpenAiResponses
      ? { prompt: messages.map(function (m) { return m.content; }).join('\n\n') }
      : { messages };

    // Use the provider map for all endpoints **except** the OpenAI Responses
    // API because unit tests rely on spying `callOpenAIResponses` directly.
    // Prefer the possibly patched export (helps with Jest spies) when running
    // inside CommonJS. Fallback to the local reference otherwise so Apps
    // Script (which has no `module`) continues to work.
    let fn;
    if (isOpenAiResponses) {
      if (typeof module !== 'undefined' && module.exports) {
        fn = module.exports.callOpenAIResponses;
      }
      fn = fn || callOpenAIResponses;
    } else {
      fn = providerObj[endpointKey];
    }
    return fn(fnParams);
  }

  /* ----------------------------------------------------------------------- */
  /* Exports                                                                  */
  /* ----------------------------------------------------------------------- */

  // Apps Script – attach to global so that other `.gs` files can call the API
  // directly without import hoops.
  global.sendThreadForUnderstanding = sendThreadForUnderstanding;

  // CommonJS/Node – export named helpers for unit testing.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      sendThreadForUnderstanding,
      callOpenAIChat,
      callOpenAIResponses,
      callGemini,
      PROVIDERS,
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
