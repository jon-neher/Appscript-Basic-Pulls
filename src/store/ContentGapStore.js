import fs from 'node:fs/promises';
import path from 'node:path';

/**
* Persistent JSON-backed store for documentation content gaps detected by the
* LLM-powered analysis pipeline.
*
* Records are keyed by a **stable** `gapId` computed from the normalised topic
* string so that recurring detections across multiple analysis runs collapse
* into a single entry whose `frequency` counter and `lastSeen` timestamp are
* incrementally updated.
*
*    {
*      "rendering-errors": {
*        "topic": "Fix code block rendering errors",
*        "question": "Why are my code blocks not rendering properly?",
*        "outline": "... markdown string ...",
*        "frequency": 4,
*        "priority": 80,
*        "firstSeen": "2025-07-23T23:30:00.123Z",
*        "lastSeen": "2025-07-24T11:01:05.987Z"
*      },
*      ...
*    }
*/

const DEFAULT_FILENAME = path.resolve('data', 'content_gaps.json');

export class ContentGapStore {
  /**
   * @param {string=} filename Optional absolute/relative path to the JSON file.
   */
  constructor(filename = DEFAULT_FILENAME) {
    this.filename = filename;
    this._cache = null; // Lazy-loaded in-memory object.

    /** @type {Promise<void>|null} */
    this._pending = null; // Serialises concurrent writes.
  }

  /** @private */
  async _load() {
    if (this._cache) return this._cache;

    try {
      const raw = await fs.readFile(this.filename, 'utf8');
      this._cache = JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // File doesn’t exist – initialise a fresh store.
        this._cache = {};
      } else if (err instanceof SyntaxError) {
        // Corrupted JSON – back up the bad file and start over so that the
        // application can continue running.
        try {
          await fs.rename(this.filename, `${this.filename}.corrupt_${Date.now()}`);
        } catch (_) {
          /* ignore secondary failures */
        }
        this._cache = {};
      } else {
        throw err;
      }
    }

    return this._cache;
  }

  /**
   * Atomically persists the in-memory cache to disk.  Identical to the logic
   * used by `FileVectorStore` so that partial writes never corrupt the JSON
   * payload.
   * @private
   */
  async _persist() {
    const performWrite = async () => {
      const dir = path.dirname(this.filename);
      await fs.mkdir(dir, { recursive: true });

      const tempPath = `${this.filename}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(this._cache, null, 2));
      await fs.rename(tempPath, this.filename);
    };

    const previous = this._pending ?? Promise.resolve();
    const next = previous.then(performWrite, performWrite);

    this._pending = next.finally(() => {
      if (this._pending === next) this._pending = null;
    });

    return next;
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  /**
   * Upserts (insert or update) a single gap record keyed by `gapId`.
   *
   * If the gap already exists the function merges `data` into the existing
   * record, overriding any overlapping keys.  Callers are expected to handle
   * frequency/priority calculation prior to the upsert.
   *
   * @param {string} gapId Stable identifier (kebab-case, no spaces).
   * @param {object} data  Plain object describing the gap.
   */
  async upsert(gapId, data) {
    if (!gapId || typeof gapId !== 'string') {
      throw new TypeError('gapId must be non-empty string');
    }

    const store = await this._load();
    const existing = store[gapId] ?? {};
    store[gapId] = { ...existing, ...data };

    await this._persist();
  }

  /**
   * Returns a *copy* of the gap record or `null` if not found.
   * @param {string} gapId
   */
  async get(gapId) {
    const store = await this._load();
    return store[gapId] ? { ...store[gapId] } : null;
  }

  /**
   * Returns **all** gaps as an array sorted by descending `priority`.
   * @return {Promise<object[]>}
   */
  async list() {
    const store = await this._load();
    return Object.values(store).sort((a, b) => b.priority - a.priority);
  }
}
