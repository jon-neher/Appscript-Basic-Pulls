import { fetchPage } from './fetchPage.js';
import { cleanHtml } from './cleanHtml.js';
import { embedText } from './embedText.js';
import { summarizeText } from './summarizeText.js';
import { FileVectorStore } from '../store/FileVectorStore.js';

const vectorStore = new FileVectorStore();

/**
* Runs the full analysis pipeline for a single documentation page.
*
* @param {string} pageId Stable identifier (slug/path) – used as PK.
* @param {string} absoluteUrl Full URL to the page.
* @param {string=} siteId Documentation site identifier.  Defaults to `'default'`.
*/
export async function analysePage(pageId, absoluteUrl, siteId = 'default') {
  const rawHtml = await fetchPage(absoluteUrl);
  const cleaned = cleanHtml(rawHtml);

  const [vector, summary] = await Promise.all([
    embedText(cleaned),
    summarizeText(cleaned),
  ]);

  // Namespace the vector by site to avoid collisions across multi-site setups.
  const vectorKey = `${siteId}:${pageId}`;

  await vectorStore.upsert(vectorKey, vector, {
    url: absoluteUrl,
    summary,
    model: 'openai',
    siteId,
    updatedAt: new Date().toISOString(),
  });

  return { vector, summary };
}

/**
* Convenience for re-exporting a shared instance.
*/
export { vectorStore };

/**
* Returns the summary for a page.  If it does not exist (or the caller opts
* to refresh), the page is fetched and re-analysed.
*
* @param {string} pageId
* @param {boolean} [forceRefresh=false]
* @return {Promise<string>}
*/
export async function getSummary(pageId, forceRefresh = false) {
  let record = await vectorStore.get(pageId);

  if (!record || forceRefresh) {
    if (!record?.metadata?.url) {
      throw new Error(`Cannot refresh – no URL metadata for page "${pageId}"`);
    }
    const { summary } = await analysePage(pageId, record.metadata.url);
    return summary;
  }

  return record.metadata.summary;
}

