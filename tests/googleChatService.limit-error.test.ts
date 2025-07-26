import * as nock from 'nock';

import { getThreadMessages } from '../src/services/GoogleChatService';

describe('getThreadMessages – limit & error branches', () => {
  const basePath = 'https://chat.googleapis.com';
  const threadPath = '/v1/spaces/AAA/threads/BBB/messages';

  beforeEach(() => {
    process.env.GOOGLE_CHAT_ACCESS_TOKEN = 'token';
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('respects the `limit` parameter and uses DESC ordering', async () => {
    // Expect exactly one request thanks to limit=2 (pageSize=2 orderBy=DESC)
    nock(basePath)
      .get(threadPath)
      .query((q) => q.pageSize === '2' && q.orderBy === 'DESC')
      .reply(200, {
        messages: [
          {
            name: 'spaces/AAA/threads/BBB/messages/3',
            text: 'Third',
            createTime: '2025-07-25T12:00:00Z',
          },
          {
            name: 'spaces/AAA/threads/BBB/messages/2',
            text: 'Second',
            createTime: '2025-07-25T11:00:00Z',
          },
        ],
      });

    const msgs = await getThreadMessages('spaces/AAA/threads/BBB', 2);

    expect(msgs).toHaveLength(2);
    // Should be sorted oldest → newest after the helper adjusts order.
    expect(msgs[0].text).toBe('Second');
    expect(msgs[1].text).toBe('Third');
  });

  it('throws helpful error on non-200 API response', async () => {
    nock(basePath)
      .get(threadPath)
      .query(true)
      .reply(500, { error: 'internal' });

    await expect(getThreadMessages('spaces/AAA/threads/BBB')).rejects.toThrow(/Google Chat API/);
  });
});
