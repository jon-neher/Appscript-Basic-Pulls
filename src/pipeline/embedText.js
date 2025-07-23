import axios from 'axios';
import { CONFIG } from '../config/nodeConfig.js';

/**
* Hard limit (in tokens) imposed by the OpenAI `text-embedding-3-small` model.
* We translate it to an approximate character budget using a ~4 chars/token
* heuristic which is accurate enough for pre-flight gating.
*
* Use `EMBEDDING_MAX_TOKENS` env var to override in tests or if OpenAI changes
* the limit in the future.
*/
const MAX_MODEL_TOKENS = Number(process.env.EMBEDDING_MAX_TOKENS) || 8_192;
const APPROX_CHARS_PER_TOKEN = 4; // OpenAI docs: English ≈ 3-4 chars per token
const MAX_CHARS = MAX_MODEL_TOKENS * APPROX_CHARS_PER_TOKEN;

/**
* Compute a *very* rough token count estimate by assuming 4 characters per
* token. Accuracy within ±10 % is sufficient for the cut-off guard – the API
* will still reject pathological cases and we propagate the error upstream.
*
* @param {string} input
* @return {number}
*/
function approxTokenCount(input) {
  return Math.ceil(input.length / APPROX_CHARS_PER_TOKEN);
}

/**
* Splits `text` into chunks that each stay safely under `MAX_CHARS` while
* trying to respect paragraph boundaries (identified by newline characters).
*
* No sliding-window overlap is used for now; if you need tighter semantic
* continuity increase `OVERLAP_CHARS`.
*
* @param {string} text
* @return {string[]} ordered list of chunk strings
*/
function chunkText(text) {
  if (text.length <= MAX_CHARS) return [text];

  const chunks = [];
  const paragraphs = text.split(/\n+/);
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n${para}` : para;
    if (candidate.length > MAX_CHARS) {
      if (current) {
        chunks.push(current.trim());
      }
      // Paragraph itself is longer than the limit – hard slice.
      if (para.length > MAX_CHARS) {
        for (let i = 0; i < para.length; i += MAX_CHARS) {
          chunks.push(para.slice(i, i + MAX_CHARS));
        }
        current = '';
      } else {
        current = para;
      }
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

/**
* Calls the configured embeddings backend and returns the vector.
*
* If the input exceeds the provider limits the text is chunked, each chunk is
* embedded independently, and the per-chunk vectors are averaged element-wise
* to yield a single stable representation.
*
* Only OpenAI is implemented today. Extend with Gemini or other providers by
* branching on `CONFIG.LLM_PROVIDER`.
*
* @param {string} text Cleaned text input (arbitrary length).
* @return {Promise<number[]>} Embedding vector representing the *entire* text.
*/
export async function embedText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new TypeError('embedText requires non-empty string');
  }

  const chunks = chunkText(text);

  switch (CONFIG.LLM_PROVIDER) {
    case 'openai': {
      // Concurrently embed all chunks then reduce.
      const vectors = await Promise.all(chunks.map(embedOpenAI));

      // Fast-path: single chunk → single call.
      if (vectors.length === 1) return vectors[0];

      // Element-wise average.
      const dims = vectors[0].length;
      const sum = new Array(dims).fill(0);

      for (const vec of vectors) {
        if (vec.length !== dims) {
          throw new Error('Embedding dimension mismatch across chunks');
        }
        for (let i = 0; i < dims; i += 1) sum[i] += vec[i];
      }

      return sum.map((x) => x / vectors.length);
    }

    case 'gemini':
      throw new Error('Gemini embeddings are not implemented yet.');

    default:
      throw new Error(`Unknown LLM_PROVIDER "${CONFIG.LLM_PROVIDER}"`);
  }
}

async function embedOpenAI(text) {
  const apiKey = process.env.OPENAI_API_KEY || CONFIG.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith('replace-')) {
    throw new Error('OPENAI_API_KEY missing – set env var or update Config.gs');
  }

  // Use the new text-embedding-3-small model for cost/quality balance.
  const resp = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      input: text,
      model: 'text-embedding-3-small',
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    },
  );

  const data = resp.data;
  if (!data || !data.data || !data.data[0] || !Array.isArray(data.data[0].embedding)) {
    throw new Error('Invalid embeddings response');
  }

  return data.data[0].embedding;
}
