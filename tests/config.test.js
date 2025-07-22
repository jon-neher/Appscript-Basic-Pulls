/**
* Unit tests for the simplified Apps Script configuration module.
*/

// Tell Node how to handle ".gs" files (treat them like plain JS).
require.extensions['.gs'] = require.extensions['.js']; // eslint-disable-line no-extend-native

const { validateConfig } = require('../src/Config.gs');

describe('validateConfig()', () => {
  test('throws when DOCUMENTATION_BASE_URL is missing', () => {
    const cfg = {
      PAGE_ANALYSIS_LIMIT: 10,
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
    };

    expect(() => validateConfig(cfg)).toThrow('DOCUMENTATION_BASE_URL');
  });

  test('throws when PAGE_ANALYSIS_LIMIT is out of range', () => {
    const cfg = {
      DOCUMENTATION_BASE_URL: 'https://docs.example.com',
      PAGE_ANALYSIS_LIMIT: 0,
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
    };

    expect(() => validateConfig(cfg)).toThrow('PAGE_ANALYSIS_LIMIT');
  });

  test('throws for invalid LLM_PROVIDER value', () => {
    const cfg = {
      DOCUMENTATION_BASE_URL: 'https://docs.example.com',
      PAGE_ANALYSIS_LIMIT: 10,
      LLM_PROVIDER: 'bard',
      OPENAI_API_KEY: 'sk-test',
    };

    expect(() => validateConfig(cfg)).toThrow('LLM_PROVIDER');
  });

  test('throws when required OPENAI_API_KEY is missing', () => {
    const cfg = {
      DOCUMENTATION_BASE_URL: 'https://docs.example.com',
      PAGE_ANALYSIS_LIMIT: 10,
      LLM_PROVIDER: 'openai',
      // OPENAI_API_KEY missing
    };

    expect(() => validateConfig(cfg)).toThrow('OPENAI_API_KEY');
  });

  test('passes with minimal valid openai config', () => {
    const cfg = {
      DOCUMENTATION_BASE_URL: 'https://docs.example.com',
      PAGE_ANALYSIS_LIMIT: 10,
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
    };

    expect(() => validateConfig(cfg)).not.toThrow();
  });
});
