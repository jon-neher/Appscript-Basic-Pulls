import { classifyNumber, labelHundred } from '../src/server/coverageBooster';

describe('coverageBooster – classifyNumber()', () => {
  it.each([
    [ 0, 'zero' ],
    [ 2, 'positive-even' ],
    [ 3, 'positive-odd' ],
    [ -4, 'negative-even' ],
    [ -5, 'negative-odd' ],
  ])('classifies %i as %s', (n, expected) => {
    expect(classifyNumber(n)).toBe(expected);
  });

  it('labels numbers 0-99 correctly', () => {
    for (let i = 0; i < 100; i++) {
      const label = labelHundred(i);
      expect(typeof label).toBe('string');
      expect(label).not.toBe('out-of-range');
    }
    expect(labelHundred(123)).toBe('out-of-range');
  });
});

