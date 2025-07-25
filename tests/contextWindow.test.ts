import { buildContextWindow } from '../src/llm/contextWindow';

interface TestMsg {
  text: string;
}

function makeMsg(text: string): TestMsg {
  return { text };
}

describe('buildContextWindow', () => {
  it('returns all messages when under the token budget', () => {
    const msgs = [makeMsg('hello world'), makeMsg('how are you')];
    const result = buildContextWindow(msgs, 100);
    expect(result).toEqual(msgs);
  });

  it('drops middle messages when over budget preserving first + latest 10', () => {
    // Build a thread with 1 (first) + 25 middle + 10 latest = 36 total
    const first = makeMsg('first question'); // 2 tokens approx

    const middle = Array.from({ length: 25 }, (_, i) => makeMsg(`mid ${i}`)); // 2 tokens each

    const latest = Array.from({ length: 10 }, (_, i) => makeMsg(`latest ${i}`)); // 2 tokens each

    const full = [first, ...middle, ...latest];

    // Budget enough for first + latest10 = 2 + (10*2) = 22 tokens but not for middles (additional 50)
    const budget = 25;
    const result = buildContextWindow(full, budget);

    // Must always include the first message.
    expect(result[0]).toBe(first);

    // The tail of the selection must be the latest 10 messages in order.
    expect(result.slice(-10)).toEqual(latest);

    // Total estimated tokens must not exceed the budget.
    const estTokens = result.reduce((sum, m) => sum + m.text.trim().split(/\s+/).length, 0);
    expect(estTokens).toBeLessThanOrEqual(budget);
  });

  it('handles exact budget', () => {
    const first = makeMsg('first');
    const latest = Array.from({ length: 10 }, () => makeMsg('a')); // 1 token each

    const full = [first, ...latest];
    const result = buildContextWindow(full, 11); // 1 (first) + 10 = 11
    expect(result).toEqual(full);
  });

  it('handles single-message input', () => {
    const single = [makeMsg('only')];
    expect(buildContextWindow(single, 5)).toEqual(single);
  });

  it('returns empty array when given none', () => {
    expect(buildContextWindow([], 10)).toEqual([]);
  });
});
