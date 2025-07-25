import { onSlashCommand } from '../src/server/ChatBot';

describe('/capture-knowledge slash command', () => {
  const baseEvent = {
    type: 'MESSAGE',
    space: { name: 'spaces/AAAA' },
    message: {
      text: '/capture-knowledge',
      thread: { name: 'spaces/AAAA/threads/BBBB' },
      slashCommand: { commandId: 'capture-knowledge' },
    },
  } as any;

  it('returns success message with extracted IDs', () => {
    const response = onSlashCommand(baseEvent);
    expect(response.text).toContain('thread BBBB');
    expect(response.text).toContain('space AAAA');
  });

  it('returns friendly error when thread missing', () => {
    const event = JSON.parse(JSON.stringify(baseEvent));
    delete event.message.thread;
    const response = onSlashCommand(event);
    expect(response.text).toMatch(/sorry/i);
  });
});
