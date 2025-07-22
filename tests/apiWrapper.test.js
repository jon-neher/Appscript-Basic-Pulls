/**
* Unit tests for the LLM adapter routing logic.
*
* Focus: ensure that `sendThreadForUnderstanding()` builds the correct
* parameter shape when `OPENAI_ENDPOINT === 'responses'` and forwards the
* call to `callOpenAIResponses()`.
*/

// Treat ".gs" like plain ".js" in Node so `require('../src/Config.gs')` works
// when executed outside Apps Script.
// eslint-disable-next-line no-extend-native
require.extensions['.gs'] = require.extensions['.js'];

describe('sendThreadForUnderstanding() – OpenAI responses endpoint', () => {
  test('converts chat messages into a prompt string and calls responses endpoint', async () => {
    // Arrange – inject a minimal CONFIG object before requiring the module so
    // that `apiWrapper` picks it up instead of loading the default .gs file.
    global.CONFIG = {
      LLM_PROVIDER: 'openai',
      OPENAI_ENDPOINT: 'responses',
      OPENAI_API_KEY: 'sk-test',
      RESPONSES_BETA: true,
    };

    // Stub the global `fetch` used by `universalFetch()` so no real HTTP
    // request goes out.  The stub mimics the minimal subset of the WHATWG
    // Response interface needed by the implementation.
    // eslint-disable-next-line no-async-promise-executor
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ text: 'stub' }] }),
      text: async () => '',
    }));

    // Now load the module under test (after global.CONFIG *and* fetch are set)
    // eslint-disable-next-line global-require
    const api = require('../src/llm/apiWrapper.js');

    // Spy on the internal helper so we can assert call parameters without
    // triggering a real network request.
    const spy = jest.spyOn(api, 'callOpenAIResponses');

    // The stubbed `fetch` above avoids any outbound network.

    const messages = [{ role: 'user', content: 'hello' }];

    // Act
    await api.sendThreadForUnderstanding({ messages });

    // Assert
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ prompt: 'hello' });

    // Clean-up to avoid leaking mocks or globals between tests.
    spy.mockRestore();
    delete global.CONFIG;
  });
});
