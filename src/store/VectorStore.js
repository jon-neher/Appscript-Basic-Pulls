/**
* Abstract interface for a persistent vector store.
*
* Concrete implementations **must** implement all methods.  The shape is kept
* intentionally small so that swapping providers (Pinecone, Weaviate, local)
* is straightforward.
*
* Page identifiers are treated as opaque strings (e.g. URL path or slug).
*/
export class VectorStore {
  /**
   * Persist a single embedding vector + metadata.
   *
   * @param {string} pageId Stable page identifier (e.g. "/getting-started").
   * @param {number[]} vector Embedding vector.
   * @param {Object} metadata Arbitrary JSON-serialisable metadata.
   * @return {Promise<void>}
   */
  async upsert(pageId, vector, metadata) {
    throw new Error('Not implemented');
  }

  /**
   * Retrieves the record for a page.
   *
   * @param {string} pageId
   * @return {Promise<{ vector: number[], metadata: Object }|null>}
   */
  async get(pageId) {
    throw new Error('Not implemented');
  }

  /**
   * Returns `k` nearest neighbours by cosine similarity.
   *
   * @param {number[]} vector Query embedding.
   * @param {number} k Number of neighbours to return.
   * @return {Promise<Array<{ pageId:string, score:number, metadata:Object }>>}
   */
  async query(vector, k = 5) {
    throw new Error('Not implemented');
  }
}
