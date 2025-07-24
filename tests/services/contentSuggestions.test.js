/**
* Unit tests for the Intelligent Content Suggestions Service.
*/

import {
  generateContentOutline,
  suggestImprovements,
  provideWritingPrompts,
  identifyConsolidationOrSplit,
  generateExampleSnippets,
} from '../../src/services/contentSuggestions.js';

describe('contentSuggestions service', () => {
  describe('generateContentOutline()', () => {
    it('returns an outline structure with at least one top-level section', () => {
      const ctx = {
        messages: [
          { role: 'user', content: 'How do I integrate the Foo API with my app?' },
          { role: 'assistant', content: 'You can start by authenticating...' },
        ],
      };

      const { outline } = generateContentOutline(ctx);

      expect(Array.isArray(outline)).toBe(true);
      expect(outline.length).toBeGreaterThan(0);
      outline.forEach((section) => {
        expect(typeof section.title).toBe('string');
      });
    });
  });

  describe('suggestImprovements()', () => {
    it('returns suggestions array', () => {
      const { suggestions } = suggestImprovements('Short doc');
      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('provideWritingPrompts()', () => {
    it('returns multiple prompts containing the topic string', () => {
      const topic = 'Authentication';
      const { prompts } = provideWritingPrompts(topic);
      expect(prompts.every((p) => p.includes(topic))).toBe(true);
    });
  });

  describe('identifyConsolidationOrSplit()', () => {
    it('identifies pages for consolidation and split', () => {
      const corpus = {
        pages: [
          { id: '1', title: 'Intro', wordCount: 300, topics: ['foo', 'bar'] },
          { id: '2', title: 'Basics', wordCount: 350, topics: ['foo', 'bar'] },
          { id: '3', title: 'Massive Guide', wordCount: 3000, topics: ['a', 'b', 'c', 'd', 'e'] },
        ],
      };

      const result = identifyConsolidationOrSplit(corpus);
      expect(result.consolidate.some((s) => s.includes('Intro'))).toBe(true);
      expect(result.split).toContain('Massive Guide');
    });
  });

  describe('generateExampleSnippets()', () => {
    it('returns at least one snippet containing the topic', () => {
      const topic = 'Foo';
      const { snippets } = generateExampleSnippets(topic);
      expect(snippets.length).toBeGreaterThan(0);
      expect(snippets.some((s) => s.includes(topic))).toBe(true);
    });
  });
});
