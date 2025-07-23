import axios from 'axios';
import { CONFIG } from '../config/nodeConfig.js';

/**
* Generates a concise summary for a documentation page.
*
* Only supports OpenAI Chat Completions for now.  The prompt is kept minimal
* and deterministic – tweak `max_tokens`/`temperature` as needed.
*
* @param {string} text Cleaned page text (truncated if necessary).
* @return {Promise<string>} A plain-text abstract (≤ 1 paragraph).
*/
export async function summarizeText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new TypeError('summarizeText requires non-empty string');
  }

  switch (CONFIG.LLM_PROVIDER) {
    case 'openai':
      return summarizeOpenAI(text);

    case 'gemini':
      throw new Error('Gemini summarisation is not implemented yet.');

    default:
      throw new Error(`Unknown LLM_PROVIDER "${CONFIG.LLM_PROVIDER}"`);
  }
}

async function summarizeOpenAI(text) {
  const apiKey = process.env.OPENAI_API_KEY || CONFIG.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith('replace-')) {
    throw new Error('OPENAI_API_KEY missing – set env var or update Config.gs');
  }

  // Trim extremely long pages – cost guardrail.
  const MAX_CHARS = 10_000; // ≈ 2.5k tokens
  const input = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

  const resp = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a technical writer. Provide a 2-3 sentence abstract for the given documentation page. Do not exceed 80 words.',
        },
        { role: 'user', content: input },
      ],
      temperature: 0.2,
      max_tokens: 120,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 45_000,
    },
  );

  const choice = resp.data.choices?.[0];
  if (!choice) throw new Error('Invalid completion response');

  return choice.message.content.trim();
}
