/* -------------------------------------------------------------------------- */
/*                          Unit tests – Structured logger                    */
/* -------------------------------------------------------------------------- */

import { debug, info, warn, error } from '../src/utils/logger';

// Helper to parse the *single* JSON argument passed to a console spy.
function getLoggedObject(spy: jest.SpyInstance): any {
  expect(spy).toHaveBeenCalledTimes(1);
  const [[arg]] = spy.mock.calls as unknown[][];
  // All logger methods stringify the object – parse back so we can assert.
  return JSON.parse(arg as string);
}

describe('logger util', () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('debug() writes JSON with expected shape', () => {
    debug('hello debug', { foo: 1 });

    const obj = getLoggedObject(logSpy);

    expect(obj).toEqual(
      expect.objectContaining({
        severity: 'DEBUG',
        message: 'hello debug',
        metadata: { foo: 1 },
      }),
    );

    // Ensure timestamp is valid ISO string
    expect(new Date(obj.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('info() writes JSON with expected shape', () => {
    info('info msg');

    const obj = getLoggedObject(logSpy);

    expect(obj.severity).toBe('INFO');
    expect(obj.message).toBe('info msg');
  });

  it('warn() uses console.warn and embeds severity', () => {
    warn('warn msg', { bar: 'baz' });

    const obj = getLoggedObject(warnSpy);

    expect(obj.severity).toBe('WARNING');
    expect(obj.metadata).toEqual({ bar: 'baz' });
  });

  it('error() uses console.error and embeds severity', () => {
    const meta = { code: 123 };
    error('oops', meta);

    const obj = getLoggedObject(errSpy);

    expect(obj.severity).toBe('ERROR');
    expect(obj.message).toBe('oops');
    expect(obj.metadata).toEqual(meta);
  });

  it('normalises Error instances in metadata to plain objects', () => {
    const err = new Error('test error');

    error('problem happened', { err });

    const obj = getLoggedObject(errSpy);

    expect(obj.metadata.err).toEqual(
      expect.objectContaining({
        name: err.name,
        message: err.message,
        stack: expect.any(String),
      }),
    );
  });
});
