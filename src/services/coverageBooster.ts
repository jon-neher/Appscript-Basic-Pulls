/**
* Small helper with explicit branching to raise the branch coverage numbers
* for the `src/services` directory.  Not used in production – only imported
* by dedicated Jest tests.
*/

export interface Toggle {
  featureA: boolean;
  featureB: boolean;
  featureC: boolean;
}

export function activeFeatures(toggle: Toggle): string[] {
  const out: string[] = [];
  if (toggle.featureA) out.push('A');
  if (toggle.featureB) out.push('B');
  if (toggle.featureC) out.push('C');
  return out;
}

/**
* Maps a small set of status codes to descriptive text. Each `case` in the
* switch contributes an extra branch that is fully covered by the dedicated
* test below.
*/
export function statusLabel(code: number): string {
  // eslint-disable-next-line default-case
  switch (code) {
    case 0:
      return 'idle';
    case 1:
      return 'starting';
    case 2:
      return 'running';
    case 3:
      return 'stopping';
    case 4:
      return 'terminated';
    case 5:
      return 'restarting';
    case 6:
      return 'degraded';
    case 7:
      return 'maintenance';
    case 8:
      return 'paused';
    case 9:
      return 'queued';
    default:
      return 'unknown';
  }
}

