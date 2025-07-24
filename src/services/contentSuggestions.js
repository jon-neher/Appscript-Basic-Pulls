/**
* Intelligent Content Suggestions Service
* --------------------------------------
* Lightweight heuristics-based implementation that fulfils the contract for
* Issue #9. Each public method returns *structured* data so callers can swap
* in a true LLM-backed implementation later without changing the API surface.
*
* The file is plain JavaScript with comprehensive JSDoc type annotations so
* that `tsc` can still perform static type-checking (`allowJs` is *not* enabled
* in the project).  We therefore export *runtime* objects only – the Type
* aliases are documented for human readers.
*/

/* -------------------------------------------------------------------------- *
* Type definitions (JSDoc only – no runtime impact)                          *
* -------------------------------------------------------------------------- */

/**
* @typedef {'user'|'assistant'|'system'|string} Role
*
* @typedef {Object} ConversationMessage
* @property {Role} role
* @property {string} content
*
* @typedef {Object} ConversationContext
* @property {ConversationMessage[]} messages
*
* @typedef {Object} OutlineSection
* @property {string} title
* @property {OutlineSection[]} [subSections]
*
* @typedef {Object} ContentOutline
* @property {OutlineSection[]} outline
*
* @typedef {Object} SuggestionList
* @property {string[]} suggestions
*
* @typedef {Object} WritingPrompts
* @property {string[]} prompts
*
* @typedef {Object} ConsolidationSplit
* @property {string[]} consolidate
* @property {string[]} split
*
* @typedef {Object} SnippetExamples
* @property {string[]} snippets
*
* @typedef {Object} CorpusPageMetadata
* @property {string} id
* @property {string} title
* @property {number} wordCount
* @property {string[]} topics
*
* @typedef {Object} CorpusMetadata
* @property {CorpusPageMetadata[]} pages
*/

/**
* Very small list of stop-words for naive keyword extraction. We purposefully
* keep the list short and ASCII-only so it works in Apps Script without
* external dependencies.
* @type {Set<string>}
*/
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'about', 'have',
  'into', 'are', 'but', 'was', 'were', 'will', 'would', 'could', 'should',
  'then', 'than', 'these', 'those', 'their', 'they', 'them', 'what', 'when',
  'where', 'which', 'while', 'who', 'how', 'why', 'can', 'also', 'such',
]);

/**
* Extracts up to `max` keywords (most frequent non-stop words).
* @param {string} text
* @param {number} [max=5]
* @return {string[]}
*/
function extractKeywords(text, max = 5) {
  if (!text) return [];

  // Very naive tokenisation by non-word characters (Apps Script-safe).
  const words = text.toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);
  /** @type {Record<string, number>} */
  const freq = {};
  for (const w of words) {
    if (STOP_WORDS.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

/**
* @param {string} word
* @return {string}
*/
function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/* -------------------------------------------------------------------------- *
* Public service API                                                         *
* -------------------------------------------------------------------------- */

/**
* @param {ConversationContext} context
* @return {ContentOutline}
*/
export function generateContentOutline(context) {
  const concatenated = context.messages.map((m) => m.content).join(' ');
  const keywords = extractKeywords(concatenated, 5);

  /** @type {OutlineSection[]} */
  const outline = keywords.length
    ? keywords.map((kw) => ({
        title: capitalise(kw),
        subSections: [
          { title: `Introduction to ${kw}` },
          { title: `Deep dive into ${kw}` },
          { title: `Best practices for ${kw}` },
        ],
      }))
    : [
        {
          title: 'Overview',
          subSections: [
            { title: 'Introduction' },
            { title: 'Details' },
            { title: 'Conclusion' },
          ],
        },
      ];

  return { outline };
}

/**
* @param {string} existingPageContent
* @return {SuggestionList}
*/
export function suggestImprovements(existingPageContent) {
  /** @type {string[]} */
  const suggestions = [];

  if (!existingPageContent || existingPageContent.trim().length === 0) {
    suggestions.push('Add meaningful content – the page is currently empty.');
    return { suggestions };
  }

  const wordCount = existingPageContent.trim().split(/\s+/).length;
  if (wordCount < 200) {
    suggestions.push('Expand the article – it is currently quite short.');
  }
  if (/todo[:]?/i.test(existingPageContent)) {
    suggestions.push('Resolve outstanding TODO items.');
  }
  if (!/\bexample\b/i.test(existingPageContent)) {
    suggestions.push('Include example snippets to illustrate concepts.');
  }
  if (!/\bsummary\b/i.test(existingPageContent)) {
    suggestions.push('Add a summary or conclusion section.');
  }

  if (suggestions.length === 0) {
    suggestions.push('The page looks good – consider minor copy-editing.');
  }

  return { suggestions };
}

/**
* @param {string} topicOrSection
* @return {WritingPrompts}
*/
export function provideWritingPrompts(topicOrSection = '') {
  const topic = topicOrSection.trim() || 'your subject';
  const prompts = [
    `Explain the core concept of ${topic} to a beginner audience.`,
    `Describe a real-world example where ${topic} solves a problem.`,
    `Outline advanced best practices when working with ${topic}.`,
    `Write a step-by-step tutorial for implementing ${topic}.`,
    `List common pitfalls developers face with ${topic} and how to avoid them.`,
  ];
  return { prompts };
}

/**
* @param {CorpusMetadata} corpus
* @return {ConsolidationSplit}
*/
export function identifyConsolidationOrSplit(corpus) {
  /** @type {string[]} */
  const consolidate = [];
  /** @type {string[]} */
  const split = [];

  for (let i = 0; i < corpus.pages.length; i += 1) {
    const a = corpus.pages[i];

    // Consolidation candidates – overlap + short.
    if (a.wordCount < 400) {
      for (let j = i + 1; j < corpus.pages.length; j += 1) {
        const b = corpus.pages[j];
        if (b.wordCount < 400) {
          const intersection = a.topics.filter((t) => b.topics.includes(t));
          if (intersection.length >= Math.min(2, a.topics.length, b.topics.length)) {
            consolidate.push(`${a.title} <-> ${b.title}`);
          }
        }
      }
    }

    // Split candidates – long + many topics.
    if (a.wordCount > 2000 && a.topics.length >= 5) {
      split.push(a.title);
    }
  }

  return { consolidate, split };
}

/**
* @param {string} [topicOrOutline=''] Optional topic or outline title. Defaults to empty string.
* @return {SnippetExamples}
*/
export function generateExampleSnippets(topicOrOutline = '') {
  const topic = topicOrOutline.trim() || 'Sample';
  const snippets = [
    `// Quick-start example for ${topic}\nconsole.log('Hello ${topic}!');`,
    `/* Advanced usage of ${topic} */\nfunction use${capitalise(topic)}() {\n  // ...implementation\n}`,
    `> **Tip:** When working with ${topic}, always validate user input.`,
  ];
  return { snippets };
}

/* -------------------------------------------------------------------------- *
* End of module                                                              *
* -------------------------------------------------------------------------- */
