import * as nock from 'nock';

import { generateText } from '../src/llm/index';

describe('generateText – error branches & alternative providers', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    nock.cleanAll();
  });

  it('throws when OPENAI_API_KEY is missing', async () => {
    await expect(generateText('Hello')).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it('throws when provider gemini is selected (not yet implemented)', async () => {
    await expect(generateText('Hi', { provider: 'gemini' as any })).rejects.toThrow(/not implemented/i);
  });

  it('bubbles up HTTP errors from the OpenAI endpoint', async () => {
    process.env.OPENAI_API_KEY = 'key';

    nock('https://api.openai.com').post('/v1/chat/completions').reply(500, {
      error: 'boom',
    });

    await expect(generateText('Test HTTP error')).rejects.toThrow(/HTTP 500/);
  });

  it('throws on completely unsupported provider id', async () => {
    // Type cast to sidestep TS literal union constraint
    await expect(generateText('Hi', { provider: 'wat' as any })).rejects.toThrow(/Unsupported provider/);
  });
});
