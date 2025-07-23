/**
* Prompt template builder for the Recommendation Engine.
*
* The function exposed by this module takes the user’s extracted context and a
* list of candidate documentation sections, then returns a fully-rendered
* system prompt ready for an LLM completion call.
*
* A single, centralised builder keeps the logic deterministic and makes unit
* testing straightforward in both the Apps Script runtime and Jest.
*
* Usage (Apps Script):
*
*   const prompt = buildRecommendationPrompt({
*     context: "How do I reset a user’s password?",
*     sections: [
*       { id: 'SEC-1', title: 'Account Security', snippet: 'Password policies…' },
*       { id: 'SEC-2', title: 'Profile Settings', snippet: 'Manage your name…' },
*     ],
*   });
*
* The resulting string includes:
*   – A role description so the LLM understands the task.
*   – Two few-shot examples (see `FEW_SHOT_EXAMPLES`) that demonstrate the
*     desired response format.
*   – Placeholders replaced with the live context and candidate list.
*
* The examples purposefully omit IDs so that the LLM learns to echo back the
* *title* when producing its ranked list, which we later map back to the ID in
* the response parser.
*
* This module follows the same export pattern as `Config.gs`: attach the main
* function to the global object for Apps Script and to `module.exports` for
* Jest/common-JS consumers.
*/

(function (global) {
  'use strict';

  /**
   * Few-shot examples that demonstrate the exact input → output behaviour the
   * LLM should replicate.  They live in a constant so that tests can assert
   * their presence and downstream developers can update the wording without
   * touching the builder logic.
   */
  const FEW_SHOT_EXAMPLES = `
### Example 1
Context:
"A customer needs to reset their forgotten password."

Candidate sections:
1. Account Security – "Password policies, MFA, and how to reset credentials."
2. Profile Settings  – "Update your name, email, and avatar."
3. Billing           – "Payment methods and invoices."

Your task: Rank the sections by the **best single spot** to document the answer *and* explain why each is ordered that way.

Answer:
1. Account Security – Best match because it explicitly covers password resets.
2. Profile Settings – Somewhat related; users often look here first.
3. Billing – Unrelated to authentication.

### Example 2
Context:
"Where can I upload my new company logo so that it appears on outgoing emails?"

Candidate sections:
1. Design Center    – "Templates, brand assets, and the drag-and-drop editor."
2. Email Settings   – "Configure from-name, reply-to, and footer details."
3. Company Profile  – "Organisation-level information like address and logo." 

Answer:
1. Company Profile  – Specifically mentions organisation logo management.
2. Email Settings   – Secondary location that references logo in email footer.
3. Design Center    – Generic assets; less precise for email logo placement.
`;

  /**
   * Constructs the full prompt handed to the LLM.
   *
   * @param {{ context: string, sections: Array<{ id: string, title: string, snippet: string }> }} params
   * @return {string} The rendered prompt.
   */
  function buildRecommendationPrompt(params) {
    const { context, sections } = params;

    if (!context || typeof context !== 'string') {
      throw new Error('buildRecommendationPrompt: "context" is required and must be a string.');
    }
    if (!Array.isArray(sections) || sections.length === 0) {
      throw new Error('buildRecommendationPrompt: "sections" must be a non-empty array.');
    }

    // Format candidate sections into a stable, numbered list so that the LLM
    // can reference them unambiguously in its answer.
    const formattedSections = sections
      .map(function (sec, idx) {
        const title = sec.title?.trim() ?? '';
        const snippet = sec.snippet?.trim() ?? '';
        return `${idx + 1}. ${title} – "${snippet}"`;
      })
      .join('\n');

    return `You are a technical writer helping maintain a public knowledge base.\n\n${FEW_SHOT_EXAMPLES}\n\n### Live query\nContext:\n"${context.trim()}"\n\nCandidate sections:\n${formattedSections}\n\nAnswer:\n`; // Trailing newline gives the model space to start generating.
  }

  // Attach to global (Apps Script).
  // eslint-disable-next-line no-param-reassign
  global.buildRecommendationPrompt = buildRecommendationPrompt;

  // Export for Jest/Node.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildRecommendationPrompt, FEW_SHOT_EXAMPLES };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
