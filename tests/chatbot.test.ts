import { onSlashCommand } from '../src/server/ChatBot';

describe('/capture-knowledge slash command', () => {
  const baseEvent = {
    type: 'MESSAGE',
    space: { name: 'spaces/AAAA' },
    message: {
      text: '/capture-knowledge',
      thread: { name: 'spaces/AAAA/threads/BBBB' },
      slashCommand: { commandId: 2 },
    },
  } as any;

  it('returns success message with extracted IDs', async () => {
    const response = await onSlashCommand(baseEvent as any);
    expect(response.text).toContain('thread BBBB');
    expect(response.text).toContain('space AAAA');
  });

  it('returns friendly error when thread missing', async () => {
    const event = JSON.parse(JSON.stringify(baseEvent));
    delete event.message.thread;
    const response = await onSlashCommand(event);
    expect(response.text).toMatch(/sorry/i);
  });
});
