import axios from 'axios';

/**
* Fetches raw HTML for a documentation page.
*
* This helper is intentionally thin – it defers retries and error
* handling to the caller so that higher-level pipeline code can decide
* whether to re-queue, skip permanently, or abort the run.
*
* @param {string} url Absolute URL of the page to fetch.
* @return {Promise<string>} Resolves with the raw HTML payload.
*/
export async function fetchPage(url) {
  if (!url.startsWith('http')) {
    throw new TypeError(`fetchPage expected an absolute URL, got "${url}"`);
  }

  const resp = await axios.get(url, {
    responseType: 'text',
    timeout: 15_000, // 15 s network timeout – tweak as needed
    headers: {
      'User-Agent': 'knowledge-bot/0.1 (+https://github.com/jon-neher/AppScript-Chat-Knowledge)'
    }
  });

  // Axios throws for non-2xx so we only reach this point on success.
  return resp.data;
}
