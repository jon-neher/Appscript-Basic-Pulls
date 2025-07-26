import { onMessage, onSlashCommand } from '../src/server/ChatBot';

describe('ChatBot additional command & edge-case coverage', () => {
  it('echoes back non-threaded user messages', async () => {
    const response = await onMessage({
      type: 'MESSAGE',
      message: { text: 'Just saying hi!' },
    } as any);

    expect(response).toEqual({ text: 'You said: "Just saying hi!"' });
  });

  it('falls back to error message when LLM provider fails', async () => {
    jest.resetModules(); // ensure fresh import & mock isolation

    // Dynamically mock the LLM module **before** re-importing ChatBot so the
    // internal `import()` picks up our stub.
    jest.doMock('../src/llm/index', () => ({
      generateText: jest.fn().mockRejectedValue(new Error('LLM outage')),
    }));

    const { onMessage: mockedOnMessage } = await import('../src/server/ChatBot');

    const res = await mockedOnMessage({
      type: 'MESSAGE',
      message: {
        text: 'Hi',
        thread: { name: 'spaces/AAA/threads/BBB' },
      },
    } as any);

    expect(res!.text).toMatch(/encountered an error/i);
  });

  it('responds to the built-in ping command', async () => {
    const res = await onSlashCommand({
      message: { slashCommand: { commandId: 'ping' } },
    } as any);

    expect(res).toEqual({ text: 'pong' });
  });

  it('handles unknown slash commands gracefully', async () => {
    const res = await onSlashCommand({
      message: { slashCommand: { commandId: 999 } },
    } as any);

    expect(res.text).toMatch(/Unknown command/);
  });

  it('/capture-knowledge returns error when thread is missing', async () => {
    const res = await onSlashCommand({
      space: { name: 'spaces/AAAA' },
      message: {
        text: '/capture-knowledge',
        slashCommand: { commandId: 2 },
      },
    } as any);

    expect(res.text).toMatch(/couldn’t capture/i);
  });
});
