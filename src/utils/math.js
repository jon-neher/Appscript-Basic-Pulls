/**
* Math utility helpers shared across multiple modules.
*
* Keeping these small, *pure* utilities in one place avoids code duplication
* and ensures consistent behaviour when computing key metrics like cosine
* similarity across the code-base.
*/

/**
* Computes the cosine similarity between two numeric vectors.
*
* The function performs a simple dot-product calculation followed by
* normalisation. It intentionally avoids external dependencies to keep the
* runtime footprint minimal (used in both Node and Apps Script
* environments).
*
* @param {number[]} a First vector.
* @param {number[]} b Second vector (must be the same length as `a`).
* @returns {number} Similarity score in the range [-1, 1]. Higher means more
*   similar.
*/
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vector length mismatch');
  }

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
