/**
* Minimal LLM client stub (Node + Apps Script compatible).
* --------------------------------------------------------
* The real OpenAI/Gemini integration will replace this implementation.  For
* now we expose the *same* async API so callers can `await generate(...)`
* without caring about the runtime.
*/

export interface LLMRequest {
  prompt: string;
  model?: string;
  /** Max tokens to generate (soft cap). */
  maxTokens?: number;
}

export interface LLMResponse {
  text: string;
  /* Raw provider-specific payload for debugging / analytics. */
  raw?: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function generate(req: LLMRequest): Promise<LLMResponse> {
  // When the necessary environment variables are present we could attempt a
  // real HTTP call here.  For this early slice we intentionally return a
  // deterministic stub so unit tests run offline.

  // eslint-disable-next-line no-console
  console.info('[llmClient] Stubbed generate() called – returning placeholder');

  return {
    text: 'Stubbed LLM response for prompt: ' + req.prompt.slice(0, 60) + '...',
    raw: null,
  };
}
