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
* @property {('chat'|'responses')=} OPENAI_ENDPOINT  Optional – which OpenAI endpoint to use (`'chat'` or `'responses'`). Defaults to `'chat'`.
* @property {string=} OPENAI_MODEL_ID Optional – model ID used for OpenAI calls. Defaults to `'gpt-3.5-turbo'`.
* @property {string=} GEMINI_MODEL_ID Optional – model ID used for Gemini calls. Defaults to `'gemini-pro'`.
* @property {boolean=} RESPONSES_BETA Optional – when `true` includes the `OpenAI-Beta: responses=v1` header for responses endpoint. Defaults to `false`.
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

    // Optional overrides – safe defaults maintain existing behaviour
    OPENAI_ENDPOINT: 'chat', // 'chat' | 'responses'
    OPENAI_MODEL_ID: 'gpt-3.5-turbo',
    GEMINI_MODEL_ID: 'gemini-pro',
    RESPONSES_BETA: false,
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

    // OPENAI_ENDPOINT – optional but if provided must be 'chat' or 'responses'
    if (
      typeof cfg.OPENAI_ENDPOINT !== 'undefined' &&
      cfg.OPENAI_ENDPOINT !== 'chat' &&
      cfg.OPENAI_ENDPOINT !== 'responses'
    ) {
      throw new Error('OPENAI_ENDPOINT, if provided, must be either "chat" or "responses".');
    }

    // OPENAI_MODEL_ID – optional but if provided must be non-empty string
    if (
      typeof cfg.OPENAI_MODEL_ID !== 'undefined' &&
      (typeof cfg.OPENAI_MODEL_ID !== 'string' || cfg.OPENAI_MODEL_ID.trim() === '')
    ) {
      throw new Error('OPENAI_MODEL_ID, if provided, must be a non-empty string.');
    }

    // GEMINI_MODEL_ID – optional but if provided must be non-empty string
    if (
      typeof cfg.GEMINI_MODEL_ID !== 'undefined' &&
      (typeof cfg.GEMINI_MODEL_ID !== 'string' || cfg.GEMINI_MODEL_ID.trim() === '')
    ) {
      throw new Error('GEMINI_MODEL_ID, if provided, must be a non-empty string.');
    }

    // RESPONSES_BETA – optional, must be boolean when provided
    if (
      typeof cfg.RESPONSES_BETA !== 'undefined' &&
      typeof cfg.RESPONSES_BETA !== 'boolean'
    ) {
      throw new Error('RESPONSES_BETA, if provided, must be a boolean.');
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
