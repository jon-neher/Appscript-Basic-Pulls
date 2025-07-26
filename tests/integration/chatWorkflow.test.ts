import * as nock from 'nock';
import { once } from 'events';

import { createMessageServer } from '../../src/server/httpServer';

/**
* End-to-end integration test that spins up the minimal HTTP server created
* for local development (`createMessageServer()`), issues a POST /message
* request that flows through:
*   – GoogleChatService → fetches thread history via REST (nocked)
*   – LLM provider       → generateText() (OpenAI, nocked)
*   – ChatBot.onMessage  → business logic & prompt construction
* and finally returns the assistant reply as JSON.
*/

describe('POST /message → LLM → response (E2E)', () => {
  const chatBase = 'https://chat.googleapis.com';
  const threadPath = '/v1/spaces/AAA/threads/BBB/messages';

  let server: ReturnType<typeof createMessageServer>;
  let port: number;

  beforeAll(async () => {
    // Allow real network connections to the local HTTP server only.
    nock.disableNetConnect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nock.enableNetConnect((host: any) => host.startsWith('127.0.0.1'));

    // Required runtime config for Google Chat + OpenAI helpers.
    process.env.GOOGLE_CHAT_ACCESS_TOKEN = 'dummy-chat-token';
    process.env.OPENAI_API_KEY = 'dummy-openai-key';

    server = createMessageServer().listen(0);
    await once(server, 'listening');
    const address = server.address();
    if (address && typeof address === 'object') {
      port = address.port;
    } else {
      throw new Error('Failed to determine server port');
    }
  });

  afterAll((done) => {
    nock.enableNetConnect(); // restore default
    server.close(done);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('returns the assistant reply for a standard message', async () => {
    // ---------------- Google Chat thread fetch --------------------
    nock(chatBase)
      .get(threadPath)
      .query(true)
      .reply(200, {
        messages: [
          {
            name: 'spaces/AAA/threads/BBB/messages/1',
            text: 'Hello?',
            createTime: '2025-07-25T10:00:00Z',
            sender: { name: 'users/USER1', displayName: 'Alice' },
          },
        ],
      });

    // ---------------- OpenAI completions --------------------------
    const openaiScope = nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        choices: [
          {
            message: { role: 'assistant', content: 'Hey Alice! 👋' },
          },
        ],
      });

    // ---------------- HTTP call under test ------------------------
    const res = await fetch(`http://127.0.0.1:${port}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'MESSAGE',
        space: { name: 'spaces/AAA' },
        message: {
          text: 'Hello?',
          thread: { name: 'spaces/AAA/threads/BBB' },
        },
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { text: string };
    expect(json.text).toBe('Hey Alice! 👋');

    openaiScope.done(); // ensure LLM call happened
  });
});
