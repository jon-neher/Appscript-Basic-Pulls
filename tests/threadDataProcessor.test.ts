import {
  parseThreadMessages,
  RawThreadMessage,
  ThreadKnowledgeData,
} from '../src/pipeline/ThreadDataProcessor';

describe('parseThreadMessages', () => {
  const baseTime = '2025-07-25T10:00:00Z';

  const mkMsg = (
    idx: number,
    partial: Partial<RawThreadMessage>
  ): RawThreadMessage => ({
    messageId: `m${idx}`,
    authorId: `user${idx}`,
    content: `msg${idx}`,
    timestamp: new Date(Date.parse(baseTime) + idx * 60_000).toISOString(),
    ...partial,
  });

  it('creates structured knowledge data with responses and corrections', () => {
    const messages: RawThreadMessage[] = [
      mkMsg(1, { content: 'What is the capital of France?' }), // original question
      mkMsg(2, { authorId: 'bot/ai', content: 'The capital is Paris.', isBot: true }), // AI answer
      mkMsg(3, { authorId: 'userAlice', content: 'Actually, add some context.' }), // human correction
      mkMsg(4, { authorId: 'bot/ai', content: 'Paris is the capital city of France.', isBot: true }), // second AI answer
      mkMsg(5, { authorId: 'userBob', content: 'Thanks, that helps!' }), // human correction to second AI answer
    ];

    const result: ThreadKnowledgeData = parseThreadMessages(messages);

    // Original question
    expect(result.originalQuestion.content).toBe('What is the capital of France?');
    expect(result.originalQuestion.messageId).toBe('m1');

    // Two AI responses
    expect(result.responses).toHaveLength(2);

    const [firstResp, secondResp] = result.responses;

    expect(firstResp.aiResponse.content).toBe('The capital is Paris.');
    expect(firstResp.corrections).toHaveLength(1);
    expect(firstResp.corrections[0].content).toBe('Actually, add some context.');

    expect(secondResp.aiResponse.content).toBe('Paris is the capital city of France.');
    expect(secondResp.corrections).toHaveLength(1);
    expect(secondResp.corrections[0].content).toBe('Thanks, that helps!');
  });

  it('ignores leading human replies before any AI answer', () => {
    const msgs: RawThreadMessage[] = [
      mkMsg(1, { content: 'Question' }),
      mkMsg(2, { authorId: 'user2', content: 'Some follow-up.' }), // human before AI – should be ignored
      mkMsg(3, { authorId: 'bot/ai', content: 'Bot answer', isBot: true }),
      mkMsg(4, { authorId: 'user3', content: 'Correction to bot' }),
    ];

    const res = parseThreadMessages(msgs);
    expect(res.responses).toHaveLength(1);
    expect(res.responses[0].corrections).toHaveLength(1);
    expect(res.responses[0].corrections[0].content).toBe('Correction to bot');
  });

  it('throws when given an empty array', () => {
    expect(() => parseThreadMessages([])).toThrow();
  });
});
