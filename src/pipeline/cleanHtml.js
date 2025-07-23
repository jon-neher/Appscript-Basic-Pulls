import { load } from 'cheerio';

/**
* Strips boilerplate markup from a raw HTML string and returns plain text.
*
* 1. Removes <script>, <style>, <noscript>, and <template> tags.
* 2. Optionally drops header/footer elements that match common CSS classes
*    (best-effort – tweak to match real docs markup).
* 3. Normalises whitespace and returns a newline-separated block.
*
* @param {string} html Raw HTML fetched from the documentation site.
* @return {string} Cleaned, human-readable text ready for embedding.
*/
export function cleanHtml(html) {
  if (typeof html !== 'string') {
    throw new TypeError('cleanHtml expected a string');
  }

  const $ = load(html);

  // Remove obviously irrelevant elements first.
  $('script, style, noscript, template').remove();

  // Best-effort header/footer stripping – customise for your site if needed.
  const boilerplateSelectors = [
    'header',
    'footer',
    '.navbar',
    '.site-header',
    '.site-footer',
    '.sidebar',
  ];
  $(boilerplateSelectors.join(',')).remove();

  // Extract text while preserving minimal structure (paragraph breaks).
  const textChunks = [];
  $('body').each((_idx, el) => {
    const raw = $(el).text();
    if (raw) textChunks.push(raw);
  });

  // Collapse redundant whitespace while preserving paragraph breaks.
  const joined = textChunks.join('\n');

  return joined
    // Collapse spaces, tabs, carriage returns, form feeds *within* a line without touching real line breaks.
    .replace(/[\t\f\r ]+/g, ' ')
    // Deduplicate multiple blank lines (two or more consecutive \n) down to a single \n.
    .replace(/\n{2,}/g, '\n')
    .trim();
}
