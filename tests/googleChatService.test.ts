// This test file targets Node.js runtime – include Node type defs.
// Declare Node globals for TypeScript without bringing in full @types/node dep
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

import * as nock from 'nock';

import { getThreadMessages } from '../src/services/GoogleChatService';

describe('getThreadMessages', () => {
  const basePath = 'https://chat.googleapis.com';
  const threadPath = '/v1/spaces/AAA/threads/BBB/messages';

  beforeAll(() => {
    process.env.GOOGLE_CHAT_ACCESS_TOKEN = 'test-token';
    process.env.AI_BOT_USER_ID = 'users/BOT123';
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('fetches all pages, orders chronologically and flags AI bot messages', async () => {
    // Page 1
    nock(basePath)
      .get(threadPath)
      .query((query) => query.pageSize === '100' && !query.pageToken)
      .reply(200, {
        messages: [
          {
            name: 'spaces/AAA/threads/BBB/messages/1',
            text: 'Hello',
            createTime: '2025-07-25T10:00:00Z',
            sender: { name: 'users/USER1', displayName: 'Alice' },
          },
          {
            name: 'spaces/AAA/threads/BBB/messages/3',
            text: 'I am the bot',
            createTime: '2025-07-25T12:00:00Z',
            sender: { name: 'users/BOT123', displayName: 'AiBot' },
          },
        ],
        nextPageToken: 'pg2',
      });

    // Page 2
    nock(basePath)
      .get(threadPath)
      .query((query) => query.pageSize === '100' && query.pageToken === 'pg2')
      .reply(200, {
        messages: [
          {
            name: 'spaces/AAA/threads/BBB/messages/2',
            text: 'How are you?',
            createTime: '2025-07-25T11:00:00Z',
            sender: { name: 'users/USER2', displayName: 'Bob' },
          },
        ],
      });

    const messages = await getThreadMessages('spaces/AAA/threads/BBB');

    expect(messages).toHaveLength(3);

    // Should be sorted oldest -> newest 10:00, 11:00, 12:00
    const times = messages.map((m) => m.createTime);
    expect(times).toEqual([
      '2025-07-25T10:00:00Z',
      '2025-07-25T11:00:00Z',
      '2025-07-25T12:00:00Z',
    ]);

    // Bot message flagged
    const botMsg = messages.find((m) => m.sender?.name === 'users/BOT123');
    expect(botMsg?.isAiBot).toBe(true);

    // Non-bot message not flagged
    const userMsg = messages.find((m) => m.sender?.name === 'users/USER1');
    expect(userMsg?.isAiBot).toBe(false);
  });
});
