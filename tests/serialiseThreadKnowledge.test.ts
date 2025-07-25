import {
  serialiseThreadKnowledgeMarkdown,
  ThreadKnowledgeData,
} from '../src/pipeline/ThreadDataProcessor';

describe('serialiseThreadKnowledgeMarkdown', () => {
  it('produces markdown including question, responses, and corrections', () => {
    const data: ThreadKnowledgeData = {
      originalQuestion: {
        messageId: 'm1',
        authorId: 'user1',
        content: 'What is the capital of France?',
        timestamp: '2025-07-25T10:00:00Z',
      },
      responses: [
        {
          aiResponse: {
            messageId: 'm2',
            authorId: 'bot/ai',
            content: 'Paris is the capital of France.',
            timestamp: '2025-07-25T10:01:00Z',
          },
          corrections: [
            {
              messageId: 'm3',
              authorId: 'user2',
              content: 'Please add more details.',
              timestamp: '2025-07-25T10:02:00Z',
            },
          ],
        },
      ],
    };

    const md = serialiseThreadKnowledgeMarkdown(data);

    expect(md).toMatch(/Original Question/);
    expect(md).toMatch(/AI Response #1/);
    expect(md).toMatch(/Corrections/);
    expect(md).toMatch(/What is the capital/);
    expect(md).toMatch(/Paris is the capital/);
  });
});
