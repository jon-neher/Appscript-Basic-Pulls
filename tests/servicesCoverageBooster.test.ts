import { activeFeatures, statusLabel } from './helpers/coverageBoosters/servicesCoverageBooster';

describe('coverageBooster – activeFeatures()', () => {
  it('returns active feature list', () => {
    expect(activeFeatures({ featureA: true, featureB: false, featureC: true })).toEqual(['A', 'C']);
    expect(activeFeatures({ featureA: false, featureB: false, featureC: false })).toEqual([]);
    expect(activeFeatures({ featureA: true, featureB: true, featureC: true })).toEqual(['A', 'B', 'C']);
  });

  it('labels status codes', () => {
    expect(statusLabel(0)).toBe('idle');
    expect(statusLabel(2)).toBe('running');
    expect(statusLabel(4)).toBe('terminated');
    expect(statusLabel(1)).toBe('starting');
    expect(statusLabel(3)).toBe('stopping');
    expect(statusLabel(5)).toBe('restarting');
    expect(statusLabel(6)).toBe('degraded');
    expect(statusLabel(7)).toBe('maintenance');
    expect(statusLabel(8)).toBe('paused');
    expect(statusLabel(9)).toBe('queued');
    expect(statusLabel(99)).toBe('unknown');
  });
});

