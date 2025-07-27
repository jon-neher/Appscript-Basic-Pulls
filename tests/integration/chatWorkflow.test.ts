import nock from 'nock';
import { once } from 'events';

import { createMessageServer } from '../helpers/httpServer';

/**
* End-to-end integration test that spins up the minimal HTTP server created
* for local development (`createMessageServer()`), issues a POST /message
* request that flows through:
*   – GoogleChatService → fetches thread history via REST (nocked)
*   – LLM provider       → generateText() (OpenAI, nocked)
*   – ChatBot.onMessage  → business logic & prompt construction
* and finally returns the assistant reply as JSON.
*/

describe('POST /message → echo response (E2E)', () => {
  // No external HTTP calls are expected in the echo-only MVP, but we still
  // keep network mocking disabled to guard against accidental outbound calls.

  let server: ReturnType<typeof createMessageServer>;
  let port: number;

  beforeAll(async () => {
    // Allow real network connections to the local HTTP server only.
    nock.disableNetConnect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nock.enableNetConnect((host: any) => host.startsWith('127.0.0.1'));

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

  it('returns an echoed reply for a standard message', async () => {
    // No external calls expected – the MVP simply echoes the message text.

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
    expect(json.text).toBe('You said: "Hello?"');
  });
});
