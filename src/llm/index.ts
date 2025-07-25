/**
* Generic LLM provider wrapper.
*
* For now we only implement the OpenAI chat-completions path.
* A stub branch exists for the upcoming Gemini integration.
*/

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SupportedProvider = 'openai' | 'gemini';

export interface GenerateTextOptions {
  /**
   * Which provider to route the call to. Defaults to `openai`.
   */
  provider?: SupportedProvider;
  /**
   * Model ID / name understood by the provider.
   *
   * When omitted we fall back to a provider-specific default.
   */
  modelId?: string;
  /**
   * Sampling temperature. Typical values 0-2. Defaults to `0.7`.
   */
  temperature?: number;
  /**
   * Maximum tokens for the generated completion. Provider-specific default
   * with a hard cap based on the model’s context window.
   */
  maxTokens?: number;
  /**
   * Override the HTTPS endpoint (e.g. when pointing at an Azure/OpenAI or
   * proxy instance). Optional.
   */
  endpoint?: string;
}

/** Default model IDs per provider */
const DEFAULT_MODELS: Record<SupportedProvider, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash-8b',
};

/**
* Very coarse upper token limits for popular OpenAI models. Not exhaustive —
* any unknown model gets a generous 1 million-token limit.
*/
const OPENAI_MODEL_LIMITS: Record<string, number> = {
  'gpt-4o-mini': 128_000,
  'gpt-4o': 128_000,
  'gpt-4.1': 1_000_000,
  'gpt-4.1-mini': 1_000_000,
  'gpt-4.1-nano': 1_000_000,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateText(
  prompt: string,
  opts: GenerateTextOptions = {},
): Promise<string> {
  const provider = opts.provider ?? 'openai';

  switch (provider) {
    case 'openai':
      return openaiGenerateText(prompt, opts);

    case 'gemini':
      // Feature flag placeholder — flip through env/property at a later date.
      throw new Error(
        'Gemini provider not implemented yet — track ticket VEN-XX for details.',
      );

    default: {
      // Exhaustive check for future additions.
      // Exhaustive guard so TypeScript will flag on new providers.
      const _never: never = provider as never;
      throw new Error(`Unsupported provider: ${String(_never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

/** Determine the runtime environment and perform a JSON HTTP POST. */
async function httpPostJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<any> {
  // 1) Node.js / server – prefer axios because nock can easily intercept.
  if (
    typeof process !== 'undefined' &&
    process.versions?.node // Node (including Jest). Using axios ensures nock/mockability.
  ) {
    const axios = (await import('axios')).default;
    const res = await axios.post(url, body, {
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      validateStatus: () => true, // we will throw manually for non-2xx
    });

    if (res.status >= 400) {
      throw new Error(`HTTP ${res.status} – ${JSON.stringify(res.data)}`);
    }

    return res.data;
  }

  // 2) Modern browsers / Cloudflare Workers – fall back to fetch.
  if (typeof fetch === 'function') {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '[no body]');
      throw new Error(`HTTP ${res.status} – ${text}`);
    }

    return res.json();
  }

  // Google Apps Script environment fallback.
  if (typeof UrlFetchApp !== 'undefined' && UrlFetchApp.fetch) {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers,
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code >= 400) {
      throw new Error(`HTTP ${code} – ${response.getContentText()}`);
    }

    return JSON.parse(response.getContentText());
  }

  throw new Error('No compatible HTTP client (fetch / UrlFetchApp) found.');
}

/** Convenience helper to read a key from env or Apps Script properties. */
function readConfig(key: string): string | undefined {
  // 1) Node / Cloud environment
  if (typeof process !== 'undefined' && process.env && key in process.env) {
    return process.env[key];
  }

  // 2) Google Apps Script `PropertiesService`
  try {
    if (
      typeof PropertiesService !== 'undefined' &&
      PropertiesService.getScriptProperties
    ) {
      return PropertiesService.getScriptProperties().getProperty(key) ?? undefined;
    }
  } catch (_) {
    /* swallow — likely running outside GAS */
  }

  return undefined;
}

// ------------------------------ OpenAI --------------------------------------

async function openaiGenerateText(
  prompt: string,
  opts: GenerateTextOptions,
): Promise<string> {
  const apiKey = readConfig('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'Missing OPENAI_API_KEY – set the env var or Apps Script property.',
    );
  }

  const endpointFromEnv = readConfig('OPENAI_ENDPOINT');
  const endpoint =
    opts.endpoint?.replace(/\/$/, '') || endpointFromEnv?.replace(/\/$/, '') ||
    'https://api.openai.com/v1/chat/completions';

  const modelId =
    opts.modelId || readConfig('OPENAI_MODEL_ID') || DEFAULT_MODELS.openai;

  const temperature =
    typeof opts.temperature === 'number' ? opts.temperature : 0.7;

  // Clamp maxTokens to provider/model limits.
  const requestedMax =
    typeof opts.maxTokens === 'number' ? opts.maxTokens : 1024;
  const modelCap = OPENAI_MODEL_LIMITS[modelId] ?? 1_000_000;
  const maxTokens = Math.min(Math.max(requestedMax, 1), modelCap);

  const body = {
    model: modelId,
    messages: [{ role: 'user', content: prompt }],
    temperature,
    max_tokens: maxTokens,
  } as const;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  const json = await httpPostJson(endpoint, headers, body);

  const content: string | undefined = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI response missing choices[0].message.content');
  }

  return content;
}
