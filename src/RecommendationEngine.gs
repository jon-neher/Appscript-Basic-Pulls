/**
* Prompt-based Recommendation Engine – orchestrator module.
*
* Responsibilities:
*   1. Build the LLM prompt (using `buildRecommendationPrompt`).
*   2. Call the configured LLM provider.
*   3. Parse the LLM response (`parseRecommendationResponse`).
*   4. Gracefully fall back to the local scoring algorithm when:
*        – The LLM API request throws (network, quota, etc.).
*        – The response parser fails validation.
*
* The exported `recommendDocumentationSections()` function is pure and
* synchronous from the perspective of Apps Script callers.  Under the hood it
* uses `UrlFetchApp.fetch` for the network step, which is synchronous in the
* Apps Script runtime.  For Jest tests the `UrlFetchApp` global can be stubbed
* or the function can be overridden via the optional `caller` parameter.
*/

(function (global) {
  'use strict';

  // Defensive requires – these will be global functions in Apps Script but are
  // exported via CommonJS when running in Jest.
  const buildRecommendationPrompt =
    global.buildRecommendationPrompt || require('./PromptTemplates').buildRecommendationPrompt;
  const parseRecommendationResponse =
    global.parseRecommendationResponse || require('./ResponseParser').parseRecommendationResponse;

  /**
   * Local, deterministic scoring algorithm used as a fallback when the LLM
   * path fails.  It performs a naive token-overlap count between the user
   * context and each section’s title + snippet.
   *
   * @param {string} context User’s extracted context/question.
   * @param {Array<{ id: string, title: string, snippet: string }>} sections
   * @return {{ ranking: string[], explanations: Record<string,string> }}
   */
  function localScoreSections(context, sections) {
    const ctxTokens = tokenize(context);

    /** @type {Array<{ id: string, score: number, explanation: string }>} */
    const scored = sections.map(function (sec) {
      const corpus = `${sec.title} ${sec.snippet}`;
      const overlap = countOverlap(ctxTokens, tokenize(corpus));
      return {
        id: sec.id,
        score: overlap,
        explanation: `Fallback ranking – ${overlap} keyword overlaps.`,
      };
    });

    scored.sort(function (a, b) {
      return b.score - a.score; // Descending
    });

    const ranking = scored.map(function (s) { return s.id; });
    const explanations = Object.create(null);
    scored.forEach(function (s) {
      explanations[s.id] = s.explanation;
    });

    return { ranking, explanations };
  }

  /**
   * Simple whitespace/token splitter → lowercase alphanumerics.
   */
  function tokenize(text) {
    return (text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function countOverlap(aTokens, bTokens) {
    const setB = new Set(bTokens);
    return aTokens.reduce(function (count, t) {
      return count + (setB.has(t) ? 1 : 0);
    }, 0);
  }

  /**
   * Attempt to call the configured LLM provider using `UrlFetchApp`.  The
   * implementation is *minimal* – just enough to illustrate the integration
   * point.  Production-ready error handling, retries, and token counting are
   * intentionally out of scope for this task.
   *
   * @param {string} prompt Fully-rendered prompt.
   * @return {string} Raw text completion.
   */
  function callLlm(prompt) {
    if (typeof UrlFetchApp === 'undefined') {
      throw new Error('URL fetch not available – likely running under Jest.');
    }

    // For the purpose of this MVP we use the OpenAI completions endpoint if
    // the config dictates so.  Gemini would require a different endpoint –
    // omitted here for brevity.
    if (global.CONFIG?.LLM_PROVIDER !== 'openai') {
      throw new Error(`Unsupported LLM_PROVIDER "${global.CONFIG?.LLM_PROVIDER}"`);
    }

    const apiKey = global.CONFIG?.OPENAI_API_KEY;

    // Fail fast when the credential is not configured instead of
    // performing a doomed network request that returns “401 Unauthorized”.
    if (!apiKey) {
      throw new Error('OpenAI API key missing - set CONFIG.OPENAI_API_KEY.');
    }
    const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      payload: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 500,
      }),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`OpenAI API error – HTTP ${response.getResponseCode()}`);
    }

    const json = JSON.parse(response.getContentText());
    const raw = json.choices?.[0]?.message?.content ?? '';
    if (!raw) {
      throw new Error('OpenAI API: missing completion content.');
    }

    return raw;
  }

  /**
   * Public orchestrator – first tries the LLM, then falls back to the local
   * scorer.  The contract purposefully mirrors the JSON schema expected by
   * downstream callers so that the fallback path is transparently
   * interchangeable.
   *
   * @param {{ context: string, sections: Array<{ id: string, title: string, snippet: string }> }} params
   * @return {{ ranking: string[], explanations: Record<string,string> }}
   */
  function recommendDocumentationSections(params) {
    const { context, sections } = params;

    // Guard clauses – fail fast for programmer errors.
    if (!context || typeof context !== 'string') {
      throw new Error('recommendDocumentationSections: "context" must be a string.');
    }
    if (!Array.isArray(sections) || sections.length === 0) {
      throw new Error('recommendDocumentationSections: "sections" must be a non-empty array.');
    }

    const prompt = buildRecommendationPrompt({ context, sections });

    try {
      const raw = callLlm(prompt);
      const parsed = parseRecommendationResponse(raw, sections);
      return parsed;
    } catch (err) {
      console.warn('LLM ranking failed – falling back to local scoring.', err);
      return localScoreSections(context, sections);
    }
  }

  // Attach to global (Apps Script).
  // eslint-disable-next-line no-param-reassign
  global.recommendDocumentationSections = recommendDocumentationSections;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { recommendDocumentationSections, localScoreSections }; // Export local scorer for unit tests.
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
