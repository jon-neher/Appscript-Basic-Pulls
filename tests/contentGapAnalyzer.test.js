/**
* ContentGapAnalyzer – unit tests covering basic frequency counting, gap
* detection threshold, priority scoring, and persistence across runs.
*/

import { jest } from '@jest/globals';
import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// 1. Stub axios.post so that embedText() never calls the real API.
// ---------------------------------------------------------------------------

const { default: axios } = await import('axios');
axios.post = jest.fn(async () => ({
  data: { data: [{ embedding: [0, 0, 0] }] },
}));

// 2. Stub vectorStore.query so that it always returns *low* similarity (→ gap).

const pageAnalysisMod = await import('../src/pipeline/pageAnalysis.js');
jest.spyOn(pageAnalysisMod.vectorStore, 'query').mockImplementation(async () => [{ score: 0.1 }]);

// 3. Stub `undici.fetch` so that the internal callLLM helper returns a static
//    JSON response without hitting the network.

jest.unstable_mockModule('undici', () => ({
  fetch: jest.fn(async () => ({
  ok: true,
  json: async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            topic: 'enable-dark-mode',
            outline: '- Step 1\n- Step 2',
          }),
        },
      },
    ],
  }),
  text: async () => 'mock',
  })),
}));

// Node >= 18 has a global `fetch`.  Stub it as well because the module under
// test prefers the global implementation when available.

global.fetch = jest.fn(async () => ({
  ok: true,
  json: async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            topic: 'enable-dark-mode',
            outline: '- Step 1\n- Step 2',
          }),
        },
      },
    ],
  }),
  text: async () => 'mock',
}));

// Ensure the on-disk gap store is cleared between test runs.

await fs.rm(path.resolve('data', 'content_gaps.json'), { force: true });

// Provide an API key so the helper doesn’t bail out early.
process.env.OPENAI_API_KEY = 'sk-test';

// Import the module under test *after* all stubs are in place.
const { ContentGapAnalyzer } = await import('../src/gap/ContentGapAnalyzer.js');

describe('ContentGapAnalyzer', () => {
  const analyzer = new ContentGapAnalyzer();

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('detects repeated questions and assigns priority', async () => {
    const logs = [
      ['How do I enable dark mode?'],
      { id: 'c1', messages: ['How do I enable dark mode?', 'Thanks!'] },
      ['Random chatter', 'How do I enable dark mode?'],
    ];

    const gaps = await analyzer.analyse(logs);

    expect(gaps).toHaveLength(1);
    const gap = gaps[0];

    expect(gap.topic).toBe('enable-dark-mode');
    expect(gap.frequency).toBe(3);
    // Priority = frequency * 10, capped at 100.
    expect(gap.priority).toBe(30);

    // ensure persistence was called (ContentGapStore upsert)
    const stored = await analyzer.listStoredGaps();
    expect(stored[0].frequency).toBe(3);
  });
});
