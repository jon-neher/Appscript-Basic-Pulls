/*
* ContentGapAnalyzer
* ------------------
* High-level driver that:
*   1. Ingests raw chat logs (array of conversation objects or arrays of
*      messages).
*   2. Detects frequently asked or clustered questions via simple frequency
*      counting.
*   3. Compares each question against the existing documentation embedding
*      corpus to detect **gaps** (low similarity).
*   4. Generates a short outline suggestion for each gap using the configured
*      LLM provider (OpenAI Chat or Google Gemini).
*   5. Scores and persists gaps so recurring themes increment their priority
*      over time.
*
* The implementation intentionally keeps the statistical logic *very* light-
* weight.  Sophisticated clustering can be added later – the public API will
* remain stable.
*/

import { embedText } from '../pipeline/embedText.js';
import { vectorStore } from '../pipeline/pageAnalysis.js';
import { ContentGapStore } from '../store/ContentGapStore.js';
import { CONFIG } from '../config/nodeConfig.js';
import pMap from 'p-map';
// Node ≤18 does not expose a global `fetch`.  Pull a standards-compliant
// implementation from `undici` and alias it locally so that the rest of the
// module can reference `fetch()` without worrying about runtime availability.
// The alias keeps the diff minimal while ensuring the polyfilled version is
// always used.
// Cross-runtime `fetch` polyfill: Node ≥18 ships a global implementation,
// earlier LTS versions do not.  We import the standard-compliant fetch from
// `undici` and fall back to it when the global is missing so production code
// always has a working reference while tests can continue to stub
// `global.fetch` if they wish.
import { fetch as undiciFetch } from 'undici';

const fetch = globalThis.fetch ?? undiciFetch;

const SIMILARITY_THRESHOLD = 0.3; // < 0.3 → considered *missing* in docs.

// ---------------------------------------------------------------------------
// Minimal LLM invocation helper – we do *not* export the provider-specific
// functions so as to keep the surface area tiny.  The implementation is a
// cut-down variant of the logic in src/llm/apiWrapper.js that only needs
// *generation* (not JSON-validated structured output).
// ---------------------------------------------------------------------------

async function callLLM(prompt) {
  switch (CONFIG.LLM_PROVIDER) {
    case 'openai':
      return callOpenAI(prompt);
    case 'gemini':
      return callGemini(prompt);
    default:
      throw new Error(`Unsupported LLM_PROVIDER "${CONFIG.LLM_PROVIDER}"`);
  }
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY || CONFIG.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith('replace-')) {
    throw new Error('OPENAI_API_KEY missing – set env var or update Config.gs');
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo-1106',
      messages: [
        { role: 'system', content: 'You are a technical documentation expert.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 512,
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI HTTP ${resp.status}: ${await resp.text()}`);
  }

  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI response missing content');
  return content.trim();
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY || CONFIG.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith('replace-')) {
    throw new Error('GEMINI_API_KEY missing – set env var or update Config.gs');
  }

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 512,
        },
      }),
    },
  );

  if (!resp.ok) {
    throw new Error(`Gemini HTTP ${resp.status}: ${await resp.text()}`);
  }

  const json = await resp.json();
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!parts || !Array.isArray(parts)) throw new Error('Gemini response missing content');
  return parts.map((p) => p.text).join('').trim();
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
* Very naive text normaliser: lower-case, collapse whitespace and remove most
* punctuation.  Good enough for frequency counting.
* @param {string} text
*/
function normalise(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function kebabCase(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80); // hard cap to keep filenames short if used externally
}

function computePriority(frequency) {
  // Linear scale: every additional mention adds 10 points. Cap at 100.
  return Math.min(100, frequency * 10);
}

function buildPrompt(question, docsSummary) {
  return [
    'You are an AI assistant helping to improve product documentation.',
    `User question (not well covered in docs):\n${question}`,
    docsSummary
      ? `\nClosest existing documentation summary:\n${docsSummary}`
      : '\nNo relevant documentation was found.',
    '\n\nRespond with a concise JSON object containing:\n' +
      '  topic: short kebab-case topic string,\n' +
      '  outline: markdown bullet list outline covering what should be documented.\n',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Public class
// ---------------------------------------------------------------------------

export class ContentGapAnalyzer {
  constructor(store = new ContentGapStore()) {
    this.store = store;
  }

  /**
   * Runs the full gap analysis *once* for the provided chat logs.
   * Callers are responsible for deduplicating logs across invocations.
   *
   * @param {(string[]|{ id: string, messages: string[] })[]} chatLogs
   * @return {Promise<object[]>} Array of gap objects sorted by priority.
   */
  async analyse(chatLogs) {
    if (!Array.isArray(chatLogs) || chatLogs.length === 0) {
      throw new TypeError('analyse() expects non-empty chatLogs array');
    }

    // -------------------------------------------------------------------
    // 1. Flatten & count questions
    // -------------------------------------------------------------------
    /** @type {Map<string, { original: string, count: number }> } */
    const freq = new Map();

    for (const convo of chatLogs) {
      const msgs = Array.isArray(convo)
        ? convo
        : Array.isArray(convo.messages)
          ? convo.messages
          : [];

      for (const msg of msgs) {
        // Heuristic: treat any sentence ending with ? as a question.
        if (typeof msg === 'string' && msg.trim().endsWith('?')) {
          const norm = normalise(msg);
          const entry = freq.get(norm) ?? { original: msg.trim(), count: 0 };
          entry.count += 1;
          freq.set(norm, entry);
        }
      }
    }

    // No questions – early exit.
    if (freq.size === 0) return [];

    // -------------------------------------------------------------------
    // 2. Gap detection against doc embeddings – run expensive embedding &
    //    similarity queries *in parallel* to maximise throughput.  We map each
    //    unique question to a Promise that resolves to the embedding-query
    //    tuple and then process the resulting array sequentially.  This keeps
    //    error-handling logic unchanged while drastically reducing total wall
    //    clock time for large inputs.
    // -------------------------------------------------------------------
    const nowIso = new Date().toISOString();
    /** @type {object[]} */
    const gapResults = [];

    // Kick off embedding + similarity look-ups with bounded concurrency to
    // avoid rate-limit spikes against upstream APIs.  `p-map` elegantly
    // handles back-pressure while preserving the original mapping semantics.

    const settled = await pMap(
      freq.entries(),
      async ([norm, { original, count }]) => {
        const vector = await embedText(original);
        const [top] = await vectorStore.query(vector, 1);
        return { norm, original, count, top };
      },
      { concurrency: 8 }, // tune as needed per deploy; 8 → ~2× typical OpenAI rate limit
    );

    for (const { norm, original, count, top } of settled) {
      const similarity = top ? top.score : 0;

      if (similarity >= SIMILARITY_THRESHOLD) continue; // docs already cover it

      // Pull page summary for prompt context (if we have any match at all).
      const summary = top?.metadata?.summary ?? '';

      const prompt = buildPrompt(original, summary);
      let jsonStr;
      try {
        jsonStr = await callLLM(prompt);
      } catch (err) {
        // On model failure log and continue with a fallback outline.
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('callLLM failed:', err);
        }
        jsonStr = JSON.stringify({ topic: original.slice(0, 50), outline: '- TBD' });
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        parsed = { topic: original.slice(0, 50), outline: jsonStr };
      }

      const gapId = kebabCase(parsed.topic || original);
      const priority = computePriority(count);

      const gapObj = {
        id: gapId,
        topic: parsed.topic || original,
        question: original,
        outline: parsed.outline || '',
        frequency: count,
        priority,
        firstSeen: nowIso,
        lastSeen: nowIso,
      };

      // Persist: if the gap already exists merge counts & keep original firstSeen.
      const existing = await this.store.get(gapId);
      if (existing) {
        gapObj.frequency = existing.frequency + count;
        gapObj.priority = computePriority(gapObj.frequency);
        gapObj.firstSeen = existing.firstSeen;
      }

      await this.store.upsert(gapId, gapObj);
      gapResults.push(gapObj);
    }

    // Sort by priority descending.
    gapResults.sort((a, b) => b.priority - a.priority);
    return gapResults;
  }

  /**
   * Convenience wrapper that simply proxies `ContentGapStore.list()`.
   */
  async listStoredGaps() {
    return this.store.list();
  }
}
