/**
* logger.ts
* Lightweight wrapper that outputs **structured JSON** log lines compatible
* with Google Cloud Logging (Stackdriver).
*
* Each exported method serialises a canonical object containing:
*   – `timestamp` → ISO-8601 string in UTC (to millisecond precision).
*   – `severity`  → one of DEBUG | INFO | WARNING | ERROR (uppercase).
*   – `message`   → human-readable message string.
*   – `metadata`  → optional arbitrary JSON payload providing additional context.
*
* The resulting object is `JSON.stringify()`-ed and written to the
* corresponding native console method so existing log routing continues to
* work in *both* Node.js and Google Apps Script runtimes while still being
* automatically parsed by Cloud Logging.
*
* The wrapper intentionally avoids external dependencies and fancy features –
* it is a **minimal shim** designed to enforce a consistent log format across
* the codebase.
*/

/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export interface LogMetadata {
  // Generic JSON payload – we deliberately do *not* attempt to constrain the
  // shape so callers can attach arbitrary structured data.
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface LogEntry {
  timestamp: string; // RFC-3339 / ISO-8601 (UTC) – e.g. 2025-07-26T02:33:12.123Z
  severity: LogSeverity;
  message: string;
  metadata?: LogMetadata;
}

// ---------------------------------------------------------------------------
// Error / value normalisation helpers
// ---------------------------------------------------------------------------

/**
* Recursively walk a value converting `Error` instances into plain objects with
* enumerable `name`, `message`, and `stack` properties so they survive
* `JSON.stringify()`.
*
* Arrays and plain objects are traversed depth-first; all other values are
* returned as-is.
*/
function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = normalizeValue(v);
    }
    return result;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Internal helper – single implementation funneled through by the public API
// ---------------------------------------------------------------------------

function emit(severity: LogSeverity, message: string, metadata?: LogMetadata): void {
  const normalizedMetadata = metadata
    ? (normalizeValue(metadata) as LogMetadata)
    : undefined;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    severity,
    message,
    ...(normalizedMetadata && Object.keys(normalizedMetadata).length ? { metadata: normalizedMetadata } : {}),
  };

  const serialized = JSON.stringify(entry);

  switch (severity) {
    case 'DEBUG':
    case 'INFO':
      console.log(serialized);
      break;
    case 'WARNING':
      console.warn(serialized);
      break;
    case 'ERROR':
      console.error(serialized);
      break;
    // No default so TS exhaustiveness check protects future changes.
  }
}

// ---------------------------------------------------------------------------
// Public API – severity-specific wrappers
// ---------------------------------------------------------------------------

export const debug = (msg: string, meta?: LogMetadata): void => emit('DEBUG', msg, meta);
export const info = (msg: string, meta?: LogMetadata): void => emit('INFO', msg, meta);
export const warn = (msg: string, meta?: LogMetadata): void => emit('WARNING', msg, meta);
export const error = (msg: string, meta?: LogMetadata): void => emit('ERROR', msg, meta);

export default { debug, info, warn, error } as const;
