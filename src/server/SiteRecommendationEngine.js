/**
* Multi-documentation *site* recommendation engine.
*
* High-level flow mirrors `RecommendationEngine.ts` which operates at the
* *section* level.  Given a set of documentation site descriptors and the
* caller-supplied `audience` + `contentType`, the exported
* `recommendDocumentationSite()` function:
*
*   1. Builds an LLM prompt (`buildSiteRecommendationPrompt`).
*   2. Attempts to call the configured LLM backend (`callLlm`).
*   3. Parses the response (`parseSiteRecommendationResponse`).
*   4. Falls back to a deterministic local scoring algorithm if anything
*      above fails (network, quota, validation).
*   5. Performs a light post-processing pass that surfaces *cross-site* link
*      suggestions (eg. tutorials that should link to API reference on a
*      different site).
*
* The module intentionally uses **plain JavaScript** (CommonJS-compatible)
* rather than `.ts` so Jest can import it without a transpilation step – a
* pragmatic choice that follows other server-side utilities in this repo.
*/

(function (global) {
  'use strict';

  //--------------------------------------------------------------------------
  // Type defs (JSDoc)
  //--------------------------------------------------------------------------

  /**
   * @typedef {'developer'|'end-user'|'internal-staff'} Audience
   * @typedef {'api-reference'|'tutorial'|'troubleshooting'} ContentType
   *
   * @typedef {Object} DocSite
   * @property {string} id           Stable, unique identifier (slug).
   * @property {string} type         Human friendly type label (eg. "developer docs").
   * @property {'public'|'internal'} visibility
   * @property {string[]} categories Supported content categories.
   * @property {Record<string,any>=} overrides Arbitrary per-site overrides.
   */

  /**
   * Builds the system prompt handed to the LLM.
   *
   * The prompt is *very* compact on purpose – we list candidate sites as a
   * simple table so the model can reference the IDs directly.  A single
   * artificial few-shot example is embedded so the model learns to emit the
   * expected JSON output (top site ID + justification + optional cross-links).
   *
   * @param {{ audience: Audience, contentType: ContentType, sites: DocSite[] }} p
   * @return {string}
   */
  function buildSiteRecommendationPrompt(p) {
    const { audience, contentType, sites } = p;

    /** Few-shot to steer the JSON output format. */
    const EXAMPLE = {
      query: {
        audience: 'developer',
        contentType: 'tutorial',
      },
      sites: [
        { id: 'dev',   visibility: 'public',   type: 'developer docs', categories: ['api-reference', 'tutorial'] },
        { id: 'guide', visibility: 'public',   type: 'user guides',    categories: ['tutorial', 'troubleshooting'] },
        { id: 'wiki',  visibility: 'internal', type: 'internal wiki',  categories: ['troubleshooting'] },
      ],
      answer: {
        recommendedSiteId: 'dev',
        reasoning: 'Developer tutorial best fits in the public developer docs.',
        crossSiteLinks: [
          { fromSiteId: 'dev', toSiteId: 'guide', reason: 'Guide has end-user tutorial variant.' },
        ],
      },
    };

    const tableRows = sites.map(function (s) {
      return `| ${s.id} | ${s.type} | ${s.visibility} | ${s.categories.join(', ')} |`;
    }).join('\n');

    return [
      'You are an information architect deciding **which documentation site**',
      'a new article should live in.  Here is an example of the required JSON',
      'output (no markdown, one-line):',
      '',
      'Example:',
      `Input: ${JSON.stringify({ audience: EXAMPLE.query.audience, contentType: EXAMPLE.query.contentType }, null, 0)}`,
      `Sites: ${JSON.stringify(EXAMPLE.sites, null, 0)}`,
      `Output: ${JSON.stringify(EXAMPLE.answer, null, 0)}`,
      '',
      '---',
      '',
      `Input: ${JSON.stringify({ audience, contentType }, null, 0)}`,
      'Sites table (pipe separated):',
      '| id | type | visibility | categories |',
      '|----|------|------------|------------|',
      tableRows,
      '',
      'Output (JSON):',
    ].join('\n');
  }

  //--------------------------------------------------------------------------
  //  Local deterministic scoring fallback
  //--------------------------------------------------------------------------

  /**
   * Heuristic score based on visibility + category match + audience → type.
   * Tuned for simplicity – good enough as a non-LLM fallback.
   *
   * @param {Audience} audience
   * @param {ContentType} contentType
   * @param {DocSite} site
   * @return {number}
   */
  function scoreSite(audience, contentType, site) {
    let score = 0;

    // 1. Visibility gating
    if (audience === 'internal-staff') {
      score += site.visibility === 'internal' ? 2 : 0;
    } else {
      score += site.visibility === 'public' ? 2 : -2; // penalise internal site for external audience
    }

    // 2. Category direct hit
    if (site.categories.includes(contentType.replace(/\s+/g, '-'))) {
      // Ensure consistent dash-based categories; test data uses canonical.
      score += 3;
    }

    // 3. Audience ↔ site.type mapping
    const map = {
      developer: 'developer',
      'end-user': 'user',
      'internal-staff': 'internal',
    };
    if (site.type.toLowerCase().includes(map[audience])) score += 2;

    return score;
  }

  /**
   * Deterministic fallback that ranks all sites and fabricates explanations.
   *
   * @param {{ audience: Audience, contentType: ContentType, sites: DocSite[] }} params
   */
  function localRecommend(params) {
    const { audience, contentType, sites } = params;

    const scored = sites.map(function (s) {
      return {
        id: s.id,
        score: scoreSite(audience, contentType, s),
        explanation: `Visibility-category audience heuristic score.`,
      };
    }).sort(function (a, b) { return b.score - a.score; });

    const recommendedSiteId = scored[0].id;

    // Cross-site link suggestions: categories present in *other* sites but not in recommended.
    /** @type {Array<{ fromSiteId: string, toSiteId: string, reason: string }>} */
    const crossSiteLinks = [];
    const recommendedSite = sites.find((s) => s.id === recommendedSiteId);
    const missingCats = recommendedSite
      ? sites.flatMap((s) => s.categories.filter((c) => !recommendedSite.categories.includes(c)))
      : [];

    if (missingCats.length) {
      // Suggest the first site that has the first missing category.
      for (const cat of missingCats) {
        const target = sites.find((s) => s.id !== recommendedSiteId && s.categories.includes(cat));
        if (target) {
          crossSiteLinks.push({
            fromSiteId: recommendedSiteId,
            toSiteId: target.id,
            reason: `Link ${cat} content found in ${target.id}.`,
          });
        }
      }
    }

    /** @type {Record<string,string>} */
    const explanations = Object.create(null);
    scored.forEach(function (s) { explanations[s.id] = s.explanation; });

    return { recommendedSiteId, ranking: scored.map((s) => s.id), explanations, crossSiteLinks };
  }

  //--------------------------------------------------------------------------
  //  LLM orchestration helpers (very similar to RecommendationEngine.ts)
  //--------------------------------------------------------------------------

  function callLlm(prompt) {
    if (typeof UrlFetchApp === 'undefined') {
      throw new Error('URL fetch not available – likely running under Jest.');
    }

    if (!global.CONFIG) throw new Error('CONFIG global missing');
    if (global.CONFIG.LLM_PROVIDER !== 'openai') {
      throw new Error(`Unsupported LLM_PROVIDER "${global.CONFIG.LLM_PROVIDER}"`);
    }

    const apiKey = global.CONFIG.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key missing');

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
        max_tokens: 400,
      }),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`OpenAI API error – HTTP ${response.getResponseCode()}`);
    }

    const json = JSON.parse(response.getContentText());
    const raw = json.choices?.[0]?.message?.content ?? '';
    if (!raw) throw new Error('OpenAI API: missing content.');
    return raw;
  }

  /**
   * Super-naïve JSON parse with minimal validation.
   * In practice the LLM is steered with a JSON few-shot so this mostly works.
   * Throws if the shape is not as expected so the caller can fallback.
   */
  function parseSiteRecommendationResponse(raw) {
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (err) {
      throw new Error('LLM did not return valid JSON');
    }

    if (!obj || typeof obj.recommendedSiteId !== 'string') {
      throw new Error('LLM response missing "recommendedSiteId"');
    }

    return {
      recommendedSiteId: obj.recommendedSiteId,
      ranking: Array.isArray(obj.ranking) ? obj.ranking : [obj.recommendedSiteId],
      explanations: typeof obj.explanations === 'object' && obj.explanations ? obj.explanations : {},
      crossSiteLinks: Array.isArray(obj.crossSiteLinks) ? obj.crossSiteLinks : [],
    };
  }

  //--------------------------------------------------------------------------
  //  Public orchestrator
  //--------------------------------------------------------------------------

  /**
   * Entry point usable from Apps Script *and* Jest.
   *
   * @param {{ audience: Audience, contentType: ContentType, sites: DocSite[] }} params
   * @returns {{ recommendedSiteId: string, ranking: string[], explanations: Record<string,string>, crossSiteLinks: any[] }}
   */
  function recommendDocumentationSite(params) {
    const { audience, contentType, sites } = params;

    if (!audience || !contentType) throw new Error('audience and contentType required');
    if (!Array.isArray(sites) || sites.length === 0) throw new Error('sites must be non-empty array');

    const prompt = buildSiteRecommendationPrompt(params);

    try {
      const raw = callLlm(prompt);
      return parseSiteRecommendationResponse(raw);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Site LLM recommendation failed – falling back to heuristic.', e);
      return localRecommend(params);
    }
  }

  // Expose globally for Apps Script as per existing pattern.
  // eslint-disable-next-line no-param-reassign
  global.recommendDocumentationSite = recommendDocumentationSite;

  // Note: This file is shipped as a native ES module (`package.json` sets
  // "type": "module").  We previously included a guarded `module.exports`
  // fallback to support CommonJS `require()`.  That mixed-format approach
  // breaks under either ESM or CJS consumers because Node decides the module
  // format *before* evaluating the code.  The safest fix is to drop the
  // CommonJS branch entirely and publish **only** the ES export below.  Apps
  // Script callers still access the global `recommendDocumentationSite`
  // symbol, and Jest/Node tests import via standard `import { … } from …`.
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Re-export for ES module consumers.
// @ts-ignore – global attachment done above.
export const recommendDocumentationSite = (globalThis).recommendDocumentationSite;
