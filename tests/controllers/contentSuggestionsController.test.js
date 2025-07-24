/**
* Integration tests for the Content Suggestions controller layer.
*/

import {
  generateContentOutlineHandler,
  suggestImprovementsHandler,
  provideWritingPromptsHandler,
  identifyConsolidationOrSplitHandler,
  generateExampleSnippetsHandler,
} from '../../src/controllers/contentSuggestionsController.js';

describe('contentSuggestions controller', () => {
  it('flow: request → generateContentOutlineHandler → response', () => {
    const req = {
      body: {
        messages: [{ role: 'user', content: 'Tell me about Bar APIs' }],
      },
    };
    const res = generateContentOutlineHandler(req);
    expect(res.statusCode).toBe(200);
    expect(res.body.outline.length).toBeGreaterThan(0);
  });

  it('flow: request → suggestImprovementsHandler → response', () => {
    const res = suggestImprovementsHandler({ body: { pageContent: 'Short doc' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
  });

  it('flow: request → provideWritingPromptsHandler → response', () => {
    const topic = 'Caching';
    const res = provideWritingPromptsHandler({ body: { topic } });
    expect(res.statusCode).toBe(200);
    expect(res.body.prompts.every((p) => p.includes(topic))).toBe(true);
  });

  it('flow: request → identifyConsolidationOrSplitHandler → response', () => {
    const corpus = {
      pages: [
        { id: '1', title: 'X', wordCount: 100, topics: ['cache', 'validation'] },
        { id: '2', title: 'Y', wordCount: 120, topics: ['cache', 'validation'] },
        { id: '3', title: 'Z', wordCount: 2500, topics: ['a', 'b', 'c', 'd', 'e'] },
      ],
    };

    const res = identifyConsolidationOrSplitHandler({ body: corpus });
    expect(res.statusCode).toBe(200);
    expect(res.body.consolidate.length).toBeGreaterThan(0);
    expect(res.body.split).toContain('Z');
  });

  it('flow: request → generateExampleSnippetsHandler → response', () => {
    const topic = 'Widgets';
    const res = generateExampleSnippetsHandler({ body: { topic } });
    expect(res.statusCode).toBe(200);
    expect(res.body.snippets.some((s) => s.includes(topic))).toBe(true);
  });
});
