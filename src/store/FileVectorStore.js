import fs from 'node:fs/promises';
import path from 'node:path';
import { VectorStore } from './VectorStore.js';
import { cosineSimilarity } from '../utils/math.js';

const DEFAULT_FILENAME = path.resolve('data', 'embeddings.json');

/**
* Extremely light-weight JSON file-based vector store.
*
* Records are stored as a single JSON object:
*   {
*     "<pageId>": {
*       "vector": [...],
*       "metadata": {...}
*     },
*     ...
*   }
*
* This is *not* intended for production at scale – it is a bootstrapping
* implementation that avoids external services so the team can iterate on
* the embedding pipeline before committing to Pinecone/Weaviate/etc.
*/
export class FileVectorStore extends VectorStore {
  /**
   * @param {string=} filename Optional absolute/relative path to the JSON file.
   */
  constructor(filename = DEFAULT_FILENAME) {
    super();
    this.filename = filename;
    this._cache = null; // Lazy-loaded in memory.
    /**
     * Promise used to serialize concurrent writes.
     *
     * @type {Promise<void>|null}
     * @private
     */
    this._pending = null;
  }

  /** @private */
  async _load() {
    if (this._cache) return this._cache;

    try {
      const raw = await fs.readFile(this.filename, 'utf8');
      this._cache = JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this._cache = {};
      } else {
        throw err;
      }
    }

    return this._cache;
  }

  /**
   * Persist the in-memory cache to disk atomically and with in-process
   * serialization.
   *
   * The write strategy is:
   *   1. Ensure the parent directory exists (`fs.mkdir … { recursive: true }`).
   *   2. Write the JSON payload to a *temporary* file in the same directory
   *      so the eventual `fs.rename` happens on the same device – POSIX
   *      guarantees the rename to be atomic in that case.
   *   3. Rename the temp file to the target path.  If another process crashes
   *      mid-write the original file is left intact.
   *
   * Because `_persist()` can be called multiple times concurrently (e.g. via
   * `Promise.all()`), we keep a simple promise queue (`this._pending`) that
   * chains write operations so they execute sequentially within a single
   * process.  Each call returns a promise that resolves once *its* write has
   * completed.
   *
   * @private
   * @returns {Promise<void>} Resolves once the write operation for *this* call
   *          completes.
   */
  async _persist() {
    // Function that performs the actual atomic write.
    const performWrite = async () => {
      const dir = path.dirname(this.filename);
      await fs.mkdir(dir, { recursive: true });

      // Place the temp file in the same dir to guarantee same-device rename.
      const tempPath = `${this.filename}.${process.pid}.${Date.now()}.tmp`;

      // Write pretty-printed JSON for easier debugging / manual edits.
      await fs.writeFile(tempPath, JSON.stringify(this._cache, null, 2));

      // Atomically replace (or create) the target file.
      await fs.rename(tempPath, this.filename);
    };

    // Chain the write off the previous pending promise to serialize access.
    // Start with the previous promise or a resolved one if none.
    const pending = this._pending ?? Promise.resolve();

    // We create a new promise that will run after `pending`.
    const next = pending.then(performWrite, performWrite);

    // Ensure we reset `_pending` once *this* write finishes so the queue can
    // accept new writers even if an earlier one failed.
    this._pending = next.finally(() => {
      // Only clear if still pointing to `next` to avoid races where a newer
      // caller already replaced `_pending` with its own promise.
      if (this._pending === next) {
        this._pending = null;
      }
    });

    // The caller should await its own write completion.
    return next;
  }

  async upsert(pageId, vector, metadata = {}) {
    if (!Array.isArray(vector)) throw new TypeError('vector must be an array');

    const store = await this._load();
    store[pageId] = { vector, metadata };
    await this._persist();
  }

  async get(pageId) {
    const store = await this._load();
    const rec = store[pageId];
    return rec ? { vector: rec.vector, metadata: rec.metadata } : null;
  }

  async query(queryVector, k = 5) {
    // Naïve brute-force cosine similarity – fine for < 10k pages.
    const store = await this._load();
    const results = Object.entries(store).map(([pageId, rec]) => {
      const score = cosineSimilarity(queryVector, rec.vector);
      return { pageId, score, metadata: rec.metadata };
    });

    // Higher score = closer similarity.
    return results.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
