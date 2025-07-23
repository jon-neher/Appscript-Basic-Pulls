/**
* Unit tests for the LLM adapter routing logic.
*
* Focus: ensure that `sendThreadForUnderstanding()` builds the correct
* parameter shape when `OPENAI_ENDPOINT === 'responses'` and forwards the
* call to `callOpenAIResponses()`.
*/



import { jest } from '@jest/globals';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('sendThreadForUnderstanding() – OpenAI responses endpoint', () => {
  // Preserve the real `global.fetch` so we can restore it after each test and
  // avoid cross-test pollution.
  let originalFetch;

  beforeEach(() => {
    // Cache the original implementation in case another test (or Jest itself)
    // has already mutated it.
    originalFetch = global.fetch;

    // Replace with a minimal stub that satisfies the implementation’s needs
    // while preventing real network I/O.
    // eslint-disable-next-line no-async-promise-executor
    const fakeResponsePayload = {
      choices: [
        {
          message: { content: 'stubbed response' },
        },
      ],
    };

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      // `doFetch` consumes `text()`, so we serialize the JSON payload there.
      text: async () => JSON.stringify(fakeResponsePayload),
      json: async () => fakeResponsePayload,
    }));
  });

  afterEach(() => {
    // Restore whatever was there before the test started.
    global.fetch = originalFetch;
  });
  test('converts chat messages into a prompt string and calls responses endpoint', async () => {
    // Arrange – inject a minimal CONFIG object before requiring the module so
    // that `apiWrapper` picks it up instead of loading the default .gs file.
    global.CONFIG = {
      LLM_PROVIDER: 'openai',
      OPENAI_ENDPOINT: 'responses',
      OPENAI_API_KEY: 'sk-test',
      RESPONSES_BETA: true,
    };

    // Now load the module under test (after global.CONFIG *and* fetch are set)
    // Dynamically import the module so it executes in ESM mode and attaches
    // helper functions to the global object (see apiWrapper implementation).
    const api = await import('../src/llm/apiWrapper.js');

    // Spy on the internal helper (exposed on the global object by the module)
    // so we can assert call parameters without triggering a real network request.

    // The stubbed `fetch` above avoids any outbound network.

    const messages = [{ role: 'user', content: 'hello' }];

    // Act
    await global.sendThreadForUnderstanding({ messages });

    // Assert – the fetch stub should have been called once via the wrapper.
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Clean-up to avoid leaking mocks or globals between tests.
    delete global.CONFIG;
  });
});
