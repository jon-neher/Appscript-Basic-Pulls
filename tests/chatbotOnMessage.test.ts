import nock from 'nock';

// AI_PATH_DISABLED_FOR_MVP: The onMessage handler now returns a placeholder
// response while the AI reply flow is disabled. Tests have been updated to
// reflect the new behaviour and to ensure **no** external AI calls occur.

import { onMessage } from '../src/server/ChatBot';


describe('ChatBot.onMessage - AI reply generation (disabled for MVP)', () => {
  const chatBase = 'https://chat.googleapis.com';
  const threadPath = '/v1/spaces/AAA/threads/BBB/messages';

  beforeAll(() => {
    // Required for GoogleChatService auth and LLM provider.
    process.env.GOOGLE_CHAT_ACCESS_TOKEN = 'dummy-chat-token';
    process.env.OPENAI_API_KEY = 'dummy-openai-key';
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('returns a placeholder when AI path is disabled', async () => {
    // AI_PATH_DISABLED_FOR_MVP: The handler should *not* fetch Chat history or
    // call the OpenAI completions endpoint. We still set up the nock scopes so
    // the test will fail if a request slips through.

    // Stub: Google Chat GET – expect **zero** calls.
    nock(chatBase)
      .get(threadPath)
      .query(true)
      .reply(200, {});

    // Stub: OpenAI chat completions – expect **zero** calls.
    const openaiScope = nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {});

    // ---------------------------------------------------
    // Invoke handler
    // ---------------------------------------------------
    const event = {
      type: 'MESSAGE',
      space: { name: 'spaces/AAA' },
      message: {
        text: 'Hello, how are you?',
        thread: { name: 'spaces/AAA/threads/BBB' },
      },
    } as any;

    const response = await onMessage(event);

    expect(response!.text).toMatch(/AI reply path disabled/i);

    // LLM endpoint should **not** have been reached
    expect(openaiScope.isDone()).toBe(false);
  });

  it('ignores slash-command events', async () => {
    // Stub OpenAI but *do not* expect it to be called.
    const openaiScope = nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {});

    const event = {
      type: 'MESSAGE',
      message: {
        text: '/capture-knowledge',
        slashCommand: { commandId: 2 },
        thread: { name: 'spaces/AAA/threads/BBB' },
      },
    } as any;

    const response = await onMessage(event);

    // Handler should indicate no response by returning null
    expect(response).toBeNull();

    // LLM endpoint should NOT have been reached
    expect(openaiScope.isDone()).toBe(false);
  });
});
