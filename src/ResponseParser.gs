/**
* LLM response parser for the Recommendation Engine.
*
* The parser is intentionally tolerant: it handles the most common natural
* language formats produced by LLMs when asked to "rank and explain" items,
* including numbered lists, markdown bullets, or plain paragraphs separated by
* newlines.  The goal is *not* to cover every variation under the sun, but to
* succeed for the overwhelmingly common cases while failing fast so that the
* caller can fall back to the deterministic local scoring algorithm.
*
* Parsing strategy (in order):
*
*   1. Extract each list item – recognised patterns include:
*        • "1. Title – reason" (en dash or hyphen)
*        • "1) Title: reason"
*        • "- Title – reason" (unordered list)
*   2. Split the captured segment into a `title` and `explanation` using the
*      first dash "-" or colon ":" as a delimiter.
*   3. Map the (case-insensitive) title back to the candidate section ID.
*   4. Build the final `{ ranking, explanations }` object.
*
* If *no* valid titles are mapped the function throws, signalling to the caller
* that they should fall back to local scoring.
*
* Public API:
*
*   parseRecommendationResponse(raw, candidateSections)
*
* Companion private helpers are intentionally not exported.
*/

(function (global) {
  'use strict';

  /**
   * @typedef {Object} CandidateSection
   * @property {string} id Stable ID string used internally by the pipeline.
   * @property {string} title Human-readable title.
   * @property {string} snippet Short summary (unused by the parser but kept for
   *   signature parity).
   */

  /**
   * Parses the raw text response from the LLM.
   *
   * @param {string} raw Complete text content returned by the LLM.
   * @param {CandidateSection[]} candidateSections Original section list (used
   *   to map titles → stable IDs).
   * @return {{ ranking: string[], explanations: Record<string, string> }} Parsed
   *   and validated output.
   */
  function parseRecommendationResponse(raw, candidateSections) {
    if (!raw || typeof raw !== 'string') {
      throw new Error('parseRecommendationResponse: "raw" must be a non-empty string.');
    }
    if (!Array.isArray(candidateSections) || candidateSections.length === 0) {
      throw new Error('parseRecommendationResponse: "candidateSections" must be a non-empty array.');
    }

    // Build a quick look-up: lowercase title → ID
    /** @type {Record<string,string>} */
    const titleToId = Object.create(null);
    candidateSections.forEach(function (sec) {
      if (sec.title) {
        titleToId[sec.title.toLowerCase()] = sec.id;
      }
    });

    /**
     * Step 1 – Break the raw answer into potential list items.  Two passes:
     *   a) Split on newlines, filter lines starting with a list marker
     *   b) If no obvious list markers, fall back to paragraph splitting.
     */
    const lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); });

    // Regex matches ordered and unordered list markers.
    const listLineRegex = /^(?:\d+\.|\d+\)|-|•|\*)\s+(.*)$/;

    /** @type {string[]} */
    let items = lines
      .map(function (line) {
        const m = listLineRegex.exec(line);
        return m ? m[1] : null; // Item content without the leading marker.
      })
      .filter(Boolean);

    if (items.length === 0) {
      // Fallback: split on blank lines if no explicit list markers detected.
      items = raw.split(/\n{2,}/).map(function (s) { return s.trim(); }).filter(Boolean);
    }

    /**
     * Step 2 – Extract title & explanation from each item.
     */
    /** @type {Array<{ id: string, explanation: string }> } */
    const parsed = [];

    items.forEach(function (item) {
      // Split at the first dash or colon.
      const m = /^(.*?)(?:\s*[–-]|:)\s+(.*)$/.exec(item);
      if (!m) return; // Skip if pattern not recognised.

      const title = m[1].trim();
      const explanation = m[2].trim();
      const id = titleToId[title.toLowerCase()];
      if (id) {
        parsed.push({ id, explanation });
      }
    });

    if (parsed.length === 0) {
      throw new Error('parseRecommendationResponse: No valid section titles found in LLM output.');
    }

    // Preserve order as ranked.
    const ranking = parsed.map(function (p) { return p.id; });

    /** @type {Record<string,string>} */
    const explanations = Object.create(null);
    parsed.forEach(function (p) {
      explanations[p.id] = p.explanation;
    });

    return { ranking, explanations };
  }

  // Attach to global (Apps Script).
  // eslint-disable-next-line no-param-reassign
  global.parseRecommendationResponse = parseRecommendationResponse;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseRecommendationResponse };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
