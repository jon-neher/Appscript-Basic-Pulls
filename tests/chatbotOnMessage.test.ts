import * as nock from 'nock';

import { onMessage } from '../src/server/ChatBot';


describe('ChatBot.onMessage - AI reply generation', () => {
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

  it('generates an AI reply for a standard message', async () => {
    // ---------------------------------------------------
    // Stub: Google Chat GET – fetch thread messages
    // ---------------------------------------------------
    nock(chatBase)
      .get(threadPath)
      // Accept any query params – the handler may vary pageSize/orderBy.
      .query(true)
      .reply(200, {
        messages: [
          {
            name: 'spaces/AAA/threads/BBB/messages/1',
            text: 'Hello, how are you?',
            createTime: '2025-07-25T10:00:00Z',
            sender: { name: 'users/USER1', displayName: 'Alice' },
          },
        ],
      });

    // ---------------------------------------------------
    // Stub: OpenAI chat completions
    // ---------------------------------------------------
    const openaiScope = nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        choices: [
          {
            message: { role: 'assistant', content: 'I am doing well, thanks!' },
          },
        ],
      });

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

    expect(response.text).toBe('I am doing well, thanks!');

    openaiScope.done(); // ensure the LLM call happened
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
