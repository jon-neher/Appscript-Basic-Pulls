/**
* Centralised configuration loader that abstracts access to environment
* variables (Node.js / Jest) **and** Google Apps Script `Script Properties`.
*
* Usage examples:
*
* ```ts
* import { getConfig } from '../config';
*
* // Throws when the key is missing
* const apiKey = getConfig('OPENAI_API_KEY');
*
* // Optional key with fallback + custom validation
* const endpoint = getConfig('OPENAI_ENDPOINT', {
*   required: false,
*   fallback: 'https://api.openai.com/v1/chat/completions',
*   validate: (url) =>
*     /^https?:\/\//.test(url) || 'OPENAI_ENDPOINT must be an absolute URL',
* });
* ```
*
* The helper is deliberately **runtime-guarded** so the compiled bundle can run
* in both environments without leaking Node globals into Apps Script.
*/

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Type declarations – safely reference GAS globals so the code compiles under
// `ts-node`/Jest **and** the Apps Script TypeScript compiler.
// ---------------------------------------------------------------------------

// Only declare a minimal slice – we do not depend on the full typings here.
declare const PropertiesService: {
  getScriptProperties(): { getProperty(key: string): string | null };
} | undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GetConfigOptions {
  /**
   * Throw when the key is missing or an empty string. Defaults to `true`.
   */
  required?: boolean;

  /**
   * Fallback value when the key is undefined/empty. **Ignored** when the key
   * is present – even when present but empty.
   */
  fallback?: string;

  /**
   * Optional validator. Return `true` for valid inputs or a **string** with a
   * custom error message when invalid.
   */
  validate?: (value: string) => boolean | string;
}

/**
* Retrieve a configuration value.
*
* 1. When running inside Node (inc. Jest) we read from `process.env`.
* 2. When running inside Apps Script we read from
*    `PropertiesService.getScriptProperties()`.
*
* The lookup order deliberately prioritises **process.env** so local overrides
* (e.g. in Jest) take effect even when the scriptProperties cache is also
* available via clasp’s push/pull workflow.
*/
export function getConfig(key: string, opts: GetConfigOptions = {}): string | undefined {
  const { required = true, fallback, validate } = opts;

  let val: string | undefined;

  // 1) Node / browser-like environment where `process` is defined
  if (typeof process !== 'undefined' && (process as any)?.env && key in (process as any).env) {
    val = (process as any).env[key] as string | undefined;
  }

  // 2) Apps Script – guarded to avoid ReferenceError when compiled for Node.
  if (val === undefined || val === '') {
    try {
      if (
        typeof PropertiesService !== 'undefined' &&
        PropertiesService?.getScriptProperties
      ) {
        val = PropertiesService.getScriptProperties().getProperty(key) ?? undefined;
      }
    } catch (_) {
      /* swallow – likely running outside GAS */
    }
  }

  // 3) Fallback literal
  if ((val === undefined || val === '') && typeof fallback === 'string') {
    val = fallback;
  }

  // Validation – execute **only** when the key is present (undefined handled earlier)
  if (val !== undefined && validate) {
    const result = validate(val);
    if (result !== true) {
      const msg = typeof result === 'string' ? result : `Invalid value for config key "${key}"`;
      throw new Error(msg);
    }
  }

  // Enforce presence when required
  if ((val === undefined || val === '') && required) {
    throw new Error(
      `Missing required configuration key "${key}" – set it as an environment variable or Script Property.`,
    );
  }

  return val;
}

// ---------------------------------------------------------------------------
// Convenience helpers (optional)
// ---------------------------------------------------------------------------

/** Shortcut for `getConfig(key, { required: false })`. */
export function getOptionalConfig(key: string, fallback?: string): string | undefined {
  return getConfig(key, { required: false, fallback });
}

export default {
  getConfig,
  getOptionalConfig,
};
