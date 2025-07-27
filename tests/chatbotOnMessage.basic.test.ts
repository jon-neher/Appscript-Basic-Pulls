import { onMessage } from '../src/server/ChatBot';

describe('ChatBot.onMessage – basic echo behaviour (LLM disabled)', () => {
  it('returns the echoed text for a standard threaded message', async () => {
    const event = {
      type: 'MESSAGE',
      message: {
        text: 'Hello bot!',
        thread: { name: 'spaces/AAA/threads/BBB' },
      },
    } as any;

    const response = await onMessage(event);

    expect(response).toEqual({ text: 'You said: "Hello bot!"' });
  });

  it('ignores slash-command events (returns null)', async () => {
    const response = await onMessage({
      type: 'MESSAGE',
      message: {
        text: '/ping',
        slashCommand: { commandId: 'ping' },
      },
    } as any);

    expect(response).toBeNull();
  });
});
