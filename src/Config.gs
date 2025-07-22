/**
* Central configuration file for the knowledge-bot Apps Script project.
*
* The 80 % solution:
*   – A single, immutable `CONFIG` object declared in plain JavaScript/GS.
*   – **No** external file parsing, network checks, or environment merging.
*   – Runtime validation guarding against the most common operator errors.
*
* To change a value, edit this file and push with `clasp push`. If a required
* field is missing or invalid the script will throw on start-up, surfacing the
* problem before the bot can receive any Chat events.
*
* This module is Apps Script-first but remains importable from Jest by
* conditionally exporting the values when `module.exports` is available.
*
* @typedef {'openai' | 'gemini'} LlmProvider
*
* @typedef {Object} AppConfig
* @property {string} DOCUMENTATION_BASE_URL Absolute base URL of the public documentation site.
* @property {number} PAGE_ANALYSIS_LIMIT Max number of pages the crawler will analyse (1-1000).
* @property {LlmProvider} LLM_PROVIDER Which LLM backend to use.
* @property {string=} OPENAI_API_KEY Secret key for OpenAI – required iff `LLM_PROVIDER === 'openai'`.
* @property {string=} GEMINI_API_KEY  Secret key for Gemini – required iff `LLM_PROVIDER === 'gemini'`.
*/

(function (global) {
  'use strict';

  /**
   * Edit the values below to match your environment.
   * All validations run immediately after the declaration.
   *
   * IMPORTANT: Do **not** mutate `CONFIG` at runtime. Rely on Apps Script
   * properties or a proper configuration service if you need dynamic changes.
   *
   * @type {Readonly<AppConfig>}
   */
  const CONFIG = Object.freeze({
    // Required – absolute URL starting with http(s)://
    DOCUMENTATION_BASE_URL: 'https://docs.example.com',

    // Required – integer 1-1000 inclusive
    PAGE_ANALYSIS_LIMIT: 50,

    // Required – choose one provider
    LLM_PROVIDER: 'openai', // 'openai' | 'gemini'

    // Conditionally required based on LLM_PROVIDER
    OPENAI_API_KEY: 'replace-with-real-key',
    // GEMINI_API_KEY: 'replace-with-real-key',
  });

  /**
   * Validate configuration object.
   *
   * Throws an `Error` (plain) describing the first problem encountered.
   * Extend with additional validations as new keys are added.
   *
   * @param {AppConfig} cfg
   */
  function validateConfig(cfg) {
    // DOCUMENTATION_BASE_URL – required, must start with http:// or https://
    if (!cfg.DOCUMENTATION_BASE_URL || typeof cfg.DOCUMENTATION_BASE_URL !== 'string') {
      throw new Error('DOCUMENTATION_BASE_URL is required and must be a string.');
    }
    if (!/^https?:\/\//i.test(cfg.DOCUMENTATION_BASE_URL)) {
      throw new Error('DOCUMENTATION_BASE_URL must start with "http://" or "https://".');
    }

    // PAGE_ANALYSIS_LIMIT – required integer 1-1000
    if (
      typeof cfg.PAGE_ANALYSIS_LIMIT !== 'number' ||
      !Number.isInteger(cfg.PAGE_ANALYSIS_LIMIT) ||
      cfg.PAGE_ANALYSIS_LIMIT < 1 ||
      cfg.PAGE_ANALYSIS_LIMIT > 1000
    ) {
      throw new Error('PAGE_ANALYSIS_LIMIT must be an integer between 1 and 1000.');
    }

    // LLM_PROVIDER – required enum
    if (cfg.LLM_PROVIDER !== 'openai' && cfg.LLM_PROVIDER !== 'gemini') {
      throw new Error('LLM_PROVIDER must be either "openai" or "gemini".');
    }

    // Conditional API keys
    if (cfg.LLM_PROVIDER === 'openai' && !cfg.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER is "openai".');
    }
    if (cfg.LLM_PROVIDER === 'gemini' && !cfg.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER is "gemini".');
    }
  }

  // Run validation immediately so a bad deploy fails fast.
  validateConfig(CONFIG);

  // Attach to global for Apps Script usage.
  // eslint-disable-next-line no-param-reassign
  global.CONFIG = CONFIG;

  // Export for Node/Jest if the CommonJS `module` global exists.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG, validateConfig };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
