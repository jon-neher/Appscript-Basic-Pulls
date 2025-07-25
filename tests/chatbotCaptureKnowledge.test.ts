// ---------------------------------------------------------------------------
// Unit tests for the /capture-knowledge pipeline inside ChatBot.onSlashCommand
// ---------------------------------------------------------------------------

/**
* The ChatBot implementation dynamically imports both the Google Chat service
* wrapper and the Google Sheets integration.  We therefore need to establish
* **module mocks** _before_ importing ChatBot so that the `import()` calls
* inside the production code resolve to our stubs.
*/

// -----------------------
// Mock: Google Chat service
// -----------------------

const fakeThreadMessages = [
  {
    name: 'spaces/AAAA/threads/BBBB/messages/1',
    text: 'What is the capital of France?',
    createTime: '2025-07-25T10:00:00Z',
    sender: { name: 'users/USER1', displayName: 'Alice' },
    isAiBot: false,
  },
  {
    name: 'spaces/AAAA/threads/BBBB/messages/2',
    text: 'Paris is the capital of France.',
    createTime: '2025-07-25T10:01:00Z',
    sender: { name: 'users/BOT123', displayName: 'AiBot' },
    isAiBot: true,
  },
];

// Mock resolved absolute path as well to cover dynamic import from ChatBot.
jest.mock('../src/services/GoogleChatService', () => {
  return {
    getThreadMessages: jest.fn().mockResolvedValue(fakeThreadMessages),
  };
});

// -----------------------
// Mock: Google Sheets integration
// -----------------------

// Track calls so we can assert later.
const appendRowsMock = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/integrations/googleSheets', () => {
  return {
    formatCapturedKnowledge: jest.fn((entry: any) => [
      entry.timestamp,
      entry.source,
      entry.content,
      (entry.tags ?? []).join(', '),
    ]),
    appendRows: appendRowsMock,
  };
});

// After mocks are in place we can import the module under test.
import { onSlashCommand } from '../src/server/ChatBot';

describe('/capture-knowledge pipeline', () => {
  const baseEvent = {
    type: 'MESSAGE',
    space: { name: 'spaces/AAAA' },
    message: {
      text: '/capture-knowledge',
      thread: { name: 'spaces/AAAA/threads/BBBB' },
      slashCommand: { commandId: 2 },
    },
  } as any;

  it('writes the full thread to Google Sheets and returns success response', async () => {
    const res = await onSlashCommand(baseEvent);

    expect(res.text).toMatch(/captured context/i);

    // Wait for the micro-task in ChatBot that fires appendRows() without await.
    await new Promise((cb) => setImmediate(cb));

    expect(appendRowsMock).toHaveBeenCalledTimes(1);

    // The content string should include both question and AI answer.
    const [[row]] = appendRowsMock.mock.calls[0];
    const rowContent = row[2] as string;
    expect(rowContent).toMatch(/Original Question/);
    expect(rowContent).toMatch(/Paris is the capital/);
  });
});
