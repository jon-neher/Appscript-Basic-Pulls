/**
* embedText() – chunking and averaging logic (ESM test).
*/

import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock `axios` *before* importing the module under test so that the mocked
// version is injected by the ESM loader.
// ---------------------------------------------------------------------------

// Rather than relying on Jest's ESM mocking APIs (which require additional
// flags) we import the real Axios module and monkey-patch `post` with a Jest
// spy.  Because `embedText()` holds on to the same module reference this is
// sufficient for full interception.

const { default: axios } = await import('axios');
axios.post = jest.fn();

// Reduce the character budget for easier testing.
process.env.EMBEDDING_MAX_TOKENS = '50'; // → ~200 characters
process.env.OPENAI_API_KEY = 'sk-test';

// Import the module under test after setting up mocks and env vars.
const { embedText } = await import('../src/pipeline/embedText.js');

describe('embedText()', () => {
  beforeEach(() => {
    axios.post.mockClear();
  });

  it('delegates directly when input is below the threshold', async () => {
    axios.post.mockResolvedValueOnce({
      data: { data: [{ embedding: [1, 2, 3] }] },
    });

    const vec = await embedText('short input');
    expect(vec).toEqual([1, 2, 3]);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('splits oversized input and averages embeddings', async () => {
    const longText = 'x'.repeat(600); // 3× the configured 200-char budget => 3 chunks

    axios.post
      .mockResolvedValueOnce({ data: { data: [{ embedding: [0, 0, 3] }] } })
      .mockResolvedValueOnce({ data: { data: [{ embedding: [3, 3, 0] }] } })
      .mockResolvedValueOnce({ data: { data: [{ embedding: [3, 0, 3] }] } });

    const vec = await embedText(longText);

    expect(vec).toEqual([2, 1, 2]);
    expect(axios.post).toHaveBeenCalledTimes(3);
  });
});
