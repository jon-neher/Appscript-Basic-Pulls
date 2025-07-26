import { tokenize, parenDepth, labelFifty } from './helpers/coverageBoosters/llmCoverageBooster';

describe('coverageBooster – tokenize()', () => {
  it('classifies tokens correctly', () => {
    const result = tokenize('hello 123 !');
    expect(result).toEqual(['word', 'number', 'other']);
  });

  it('computes parenthesis depth', () => {
    expect(parenDepth('((a)')).toBe(1);
    expect(parenDepth('(())')).toBe(0);
    expect(parenDepth('()()')).toBe(0);
  });

  it('labels 0-49 correctly', () => {
    for (let i = 0; i < 50; i++) {
      const label = labelFifty(i);
      expect(typeof label).toBe('string');
      expect(label).not.toBe('other');
    }
    expect(labelFifty(999)).toBe('other');
  });
});


