/**
* Content Gap Analysis Pipeline (Issue #6 – VEN-14)
*
* This module orchestrates an end-to-end pipeline that analyses historical chat
* conversations, clusters repeated questions, detects documentation gaps
* against the existing vector store, and generates LLM-powered suggestions
* complete with outlines and priority scores.
*
* The design intentionally mirrors the style and lightweight dependency
* footprint of the existing `src/pipeline/*` utilities so that the feature can
* run in the same constrained execution environments (Cloud Functions, local
* Node scripts, or Apps Script).
*
* The public API surface is a single `runContentGapAnalysis()` function plus a
* helper `GapAnalysisStore` class (file-backed JSON) for recurring-themes
* tracking.
*
* Usage (simplified):
*   import { runContentGapAnalysis } from './pipeline/contentGapAnalysis.js';
*
*   const result = await runContentGapAnalysis({
*     loadChats: async () => fetchChatsFromDb(),
*     coverageThreshold: 0.8, // optional – default 0.8
*   });
*
*   console.log(JSON.stringify(result.suggestions, null, 2));
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';

import { embedText } from './embedText.js';
import { vectorStore as docVectorStore } from './pageAnalysis.js';
import { CONFIG } from '../config/nodeConfig.js';

// ---------------------------------------------------------------------------
// Constants & configurable defaults
// ---------------------------------------------------------------------------

const GAP_STORE_PATH = path.resolve('data', 'gap_analysis.json');

const DEFAULTS = {
  // Cosine-similarity cut-off for considering two questions as duplicates.
  clusterSimilarityThreshold: 0.85,

  // When the closest documentation page scores *below* this value we flag the
  // question cluster as an information gap.
  coverageThreshold: 0.8,

  // Priority-score weightings – sum does **not** need to equal 1; values are
  // re-scaled internally.
  weights: {
    frequency: 0.7,
    recurring: 0.3,
  },
};

// ---------------------------------------------------------------------------
// Helper – cosine similarity (duplicated here to avoid fragile imports)
// ---------------------------------------------------------------------------

function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error('Vector length mismatch');

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] ** 2;
    magB += b[i] ** 2;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Helper – slugification for stable IDs
// ---------------------------------------------------------------------------

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60); // prevent extremely long filenames/keys
}

// ---------------------------------------------------------------------------
// GapAnalysisStore – persisted theme tracking between runs
// ---------------------------------------------------------------------------

class GapAnalysisStore {
  constructor(filepath = GAP_STORE_PATH) {
    this.filename = filepath;
    this._cache = null;
  }

  async _load() {
    if (this._cache) return this._cache;

    try {
      const raw = await fs.readFile(this.filename, 'utf8');
      this._cache = JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this._cache = { themes: {} };
      } else {
        throw err;
      }
    }

    return this._cache;
  }

  async _persist() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    await fs.writeFile(this.filename, JSON.stringify(this._cache, null, 2));
  }

  async recordTheme(themeId, meta = {}) {
    const store = await this._load();
    const rec = store.themes[themeId] ?? { occurrences: 0 };

    rec.occurrences += 1;
    rec.lastSeen = new Date().toISOString();
    rec.topic = meta.topic;

    store.themes[themeId] = rec;

    // Persistence is now caller-controlled to avoid excessive disk I/O.
    return rec;
  }

  /**
   * Persists the in-memory cache to disk. Call once after multiple
   * `recordTheme()` mutations to batch disk writes.
   *
   * @return {Promise<void>}
   */
  async save() {
    await this._persist();
  }

  async getTheme(themeId) {
    const store = await this._load();
    return store.themes[themeId] ?? null;
  }
}

// ---------------------------------------------------------------------------
// Chat-log ingestion & question extraction helpers
// ---------------------------------------------------------------------------

/**
* Normalises a raw chat conversation object array into a flat list of
* user-authored questions.
*
* Each conversation is expected to follow this minimal shape:
*   {
*     id: string,
*     messages: [
*       { author: 'user' | 'assistant', text: string, timestamp: string }
*     ]
*   }
*
* No attempt is made to detect multi-sentence questions – the entire user
* message is treated as one question if it ends with a question-mark or if
* `force` is passed.
*
* @param {Array<Object>} conversations Parsed chat logs.
* @return {Array<{ text:string, convId:string, timestamp:string }>}
*/
export function extractQuestions(conversations) {
  if (!Array.isArray(conversations)) {
    throw new TypeError('extractQuestions expects an array');
  }

  const questions = [];

  for (const conv of conversations) {
    if (!conv || !Array.isArray(conv.messages)) continue;

    for (const msg of conv.messages) {
      if (msg.author !== 'user') continue;
      if (typeof msg.text !== 'string') continue;

      // Heuristic: treat as a question if the message contains a trailing '?' –
      // or if it starts with an interrogative word.
      const trimmed = msg.text.trim();
      const isQuestion = /\?$/.test(trimmed)
        || /\b(what|how|why|when|where|is|are|do|does|can)\b/i.test(trimmed);

      if (isQuestion) {
        questions.push({
          text: trimmed,
          convId: String(conv.id ?? ''),
          timestamp: msg.timestamp ?? conv.timestamp ?? null,
        });
      }
    }
  }

  return questions;
}

// ---------------------------------------------------------------------------
// Question clustering (naïve single-pass agglomerative clustering)
// ---------------------------------------------------------------------------

/**
* Clusters questions by embedding similarity.  Complexity is O(n²) which is
* acceptable for <10k unique questions.  If future datasets grow larger we
* should port to HNSW or use a dedicated ANN lib.
*
* @param {Array<{ text:string, metadata:Object }>} questions
* @param {number} similarityThreshold Cosine similarity to merge questions.
* @return {Promise<Array<{ centroid:number[], questions:Array, topic:string }>>}
*/
export async function clusterQuestions(questions, similarityThreshold = DEFAULTS.clusterSimilarityThreshold) {
  if (!Array.isArray(questions)) {
    throw new TypeError('clusterQuestions expects an array');
  }

  // 1. Embed all questions in controlled batches to respect provider rate
  //    limits.  OpenAI allows large burst concurrency but for large chat
  //    exports we quickly hit the TPM quota if we fire one request per
  //    question simultaneously.  We therefore chunk the work into small
  //    groups (default 128) and run the batches sequentially while retaining
  //    full intra-batch concurrency.

  const BATCH_SIZE = 128;

  /** @type {Array<number[]>} */
  const embeds = new Array(questions.length);

  for (let start = 0; start < questions.length; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, questions.length);
    const slice = questions.slice(start, end);

    // Run the current batch concurrently then merge back preserving the
    // original order.
    const results = await Promise.all(slice.map((q) => embedText(q.text)));

    for (let i = 0; i < results.length; i += 1) {
      embeds[start + i] = results[i];
    }
  }

  // 2. Greedy clustering – assign each question to the first existing cluster
  //    with a centroid above the threshold, otherwise create a new cluster.
  /** @type {Array<{ centroid:number[], questions:Array<{ text:string, metadata:Object }> }>} */
  const clusters = [];

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    const vec = embeds[i];

    let assigned = false;
    for (const cluster of clusters) {
      const sim = cosineSimilarity(vec, cluster.centroid);
      if (sim >= similarityThreshold) {
        cluster.questions.push(q);

        // Update centroid – incremental mean (cheap and good enough)
        const n = cluster.questions.length;
        for (let d = 0; d < cluster.centroid.length; d += 1) {
          cluster.centroid[d] = ((cluster.centroid[d] * (n - 1)) + vec[d]) / n;
        }

        assigned = true;
        break;
      }
    }

    if (!assigned) {
      clusters.push({ centroid: vec.slice(), questions: [q] });
    }
  }

  // 3. Derive a representative topic string – choose the shortest question
  //    under 120 chars to keep it concise.
  for (const cluster of clusters) {
    cluster.topic = cluster.questions
      .map((qq) => qq.text)
      .sort((a, b) => a.length - b.length)[0];
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// Documentation gap detection
// ---------------------------------------------------------------------------

async function detectGaps(clusters, coverageThreshold = DEFAULTS.coverageThreshold) {
  const gaps = [];

  for (const cluster of clusters) {
    const nearest = await docVectorStore.query(cluster.centroid, 1);
    const best = nearest[0];

    if (!best || best.score < coverageThreshold) {
      gaps.push({ ...cluster, docMatch: best ?? null });
    }
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// LLM outline generation – OpenAI chat completions only (for now)
// ---------------------------------------------------------------------------

async function generateOutline(topic, sampleQuestions) {
  const apiKey = process.env.OPENAI_API_KEY || CONFIG.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith('replace-')) {
    throw new Error('OPENAI_API_KEY missing – set env var or update Config.gs');
  }

  const prompt = [
    {
      role: 'system',
      content: 'You are a senior technical writer tasked with expanding product documentation. Given a user question cluster, propose a concise documentation topic title and a hierarchical outline using Markdown heading levels (##, ###). Limit to 6-8 sub-headings.',
    },
    {
      role: 'user',
      content: `Representative question: "${topic}"

Sample similar questions:
${sampleQuestions.slice(0, 5).map((q) => `- ${q}`).join('\n')}

Provide the output in the following JSON schema without additional commentary:
{
  "topic": string,          // concise title
  "outline": string         // markdown headings only
}`,
    },
  ];

  const resp = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: prompt,
      temperature: 0.2,
      max_tokens: 500,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60_000,
    },
  );

  const raw = resp.data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error('Outline generation returned empty response');

  // Attempt to parse the JSON – fallback to naive extraction if malformed.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Try to detect JSON block in the response.
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      parsed = JSON.parse(match[0]);
    } else {
      throw new Error(`Unable to parse outline JSON: ${raw}`);
    }
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Priority scoring – simple weighted normalisation
// ---------------------------------------------------------------------------

/**
* Computes a 0-100 priority score for a documentation gap suggestion.
*
* The score is a weighted combination of two normalised dimensions:
*   1. frequency  – how many unique user questions map to the cluster, scaled
*                   relative to the most-frequent cluster observed in the
*                   current analysis run.
*   2. recurring  – how many analysis runs have seen the same theme before
*                   (persisted in `GapAnalysisStore`). Already tracked by the
*                   caller on a 0-100 scale where 10 = one prior run.
*
* Both dimensions are multiplied by their respective weights then summed and
* capped to the 0-100 range.
*
* @param {Object}  params
* @param {number}  params.frequency      Raw question count for the cluster.
* @param {number}  params.recurring      Recurrence score (0-100, multiples of 10).
* @param {number}  params.maxFrequency   Largest `frequency` value across all
*                                       clusters in this run.
* @param {Object}  [weights]             Weightings; defaults to
*                                       `DEFAULTS.weights`.
* @return {number} Priority score 0‒100.
*/
function computePriority({ frequency, recurring, maxFrequency }, weights = DEFAULTS.weights) {
  if (!maxFrequency || maxFrequency <= 0) {
    throw new Error('computePriority: `maxFrequency` must be a positive number');
  }

  // 1 – normalise frequency to a 0-100 scale relative to the maximum cluster
  //     size seen in the current analysis run.
  const freqNorm = (frequency / maxFrequency) * 100;

  // 2 – apply weightings.
  const raw = (freqNorm * (weights.frequency ?? 1)) + (recurring * (weights.recurring ?? 1));

  // 3 – round and cap to 0-100.
  const score = Math.min(100, Math.round(raw));

  return score;
}

// ---------------------------------------------------------------------------
// Top-level orchestration
// ---------------------------------------------------------------------------

/**
* Runs the full content-gap analysis.  Chat logs are supplied by the caller so
* that the pipeline remains storage-agnostic.
*
* @param {Object} options
* @param {() => Promise<Array>} options.loadChats          Async loader fn.
* @param {number=} options.coverageThreshold              Override default.
* @param {number=} options.clusterSimilarityThreshold     Override default.
* @param {Object=} options.weights                        Priority weights.
* @return {Promise<{ suggestions:Array, recurringSummary:Object }>}
*/
export async function runContentGapAnalysis(options = {}) {
  const loadChats = options.loadChats;
  if (typeof loadChats !== 'function') {
    throw new TypeError('options.loadChats callback is required');
  }

  const coverageThreshold = options.coverageThreshold ?? DEFAULTS.coverageThreshold;
  const similarityThreshold = options.clusterSimilarityThreshold ?? DEFAULTS.clusterSimilarityThreshold;
  const weights = { ...DEFAULTS.weights, ...(options.weights ?? {}) };

  // 1. Ingest chats & extract questions.
  const conversations = await loadChats();
  const questions = extractQuestions(conversations);

  if (questions.length === 0) {
    return { suggestions: [], recurringSummary: {} };
  }

  // 2. Cluster similar questions.
  const clusters = await clusterQuestions(questions, similarityThreshold);

  // Determine the maximum cluster size to normalise frequency scores.
  const maxFrequency = clusters.reduce((max, c) => Math.max(max, c.questions.length), 0) || 1;

  // 3. Compare clusters against documentation embeddings.
  const gaps = await detectGaps(clusters, coverageThreshold);

  // 4. Theme tracking persistence.
  const store = new GapAnalysisStore();

  const suggestions = [];

  for (const gap of gaps) {
    const themeId = slugify(gap.topic);
    const themeMeta = await store.recordTheme(themeId, { topic: gap.topic });

    // 5. LLM outline generation.
    const outlineResp = await generateOutline(gap.topic, gap.questions.map((qq) => qq.text));

    // 6. Priority scoring.
    const frequency = gap.questions.length; // raw question count
    const recurring = Math.min(100, themeMeta.occurrences * 10);
    const priority = computePriority({ frequency, recurring, maxFrequency }, weights);

    suggestions.push({
      topic: outlineResp.topic ?? gap.topic,
      outline: outlineResp.outline,
      priority,
      frequency: gap.questions.length,
      recurring: themeMeta.occurrences,
    });
  }

  // Order by priority desc.
  suggestions.sort((a, b) => b.priority - a.priority);

  // Persist theme updates once after processing all gaps.
  await store.save();

  // Summary metrics for recurring themes.
  const recurringSummary = suggestions.map((s) => ({ topic: s.topic, recurring: s.recurring }));

  return { suggestions, recurringSummary };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { GapAnalysisStore };
