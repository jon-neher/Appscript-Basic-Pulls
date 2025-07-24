/**
* Configuration validation tests – updated for multi-site support.
*/

import { validateConfig } from '../src/config/nodeConfig.js';

// ---------------------------------------------------------------------------
// Helper – minimal valid base object we can clone & tweak per test.
// ---------------------------------------------------------------------------

function baseCfg() {
  return {
    DOCUMENTATION_SITES: [
      {
        id: 'dev-docs',
        type: 'developer docs',
        visibility: 'public',
        categories: ['api-reference', 'tutorial'],
      },
    ],
    PAGE_ANALYSIS_LIMIT: 10,
    LLM_PROVIDER: 'openai',
    OPENAI_API_KEY: 'sk-test',
  };
}

describe('validateConfig()', () => {
  test('throws when DOCUMENTATION_SITES array is missing', () => {
    const cfg = {
      PAGE_ANALYSIS_LIMIT: 10,
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
    };

    expect(() => validateConfig(cfg)).toThrow('DOCUMENTATION_SITES');
  });

  test('throws for duplicate site IDs', () => {
    const cfg = baseCfg();
    cfg.DOCUMENTATION_SITES.push({ ...cfg.DOCUMENTATION_SITES[0] }); // duplicate id
    expect(() => validateConfig(cfg)).toThrow('Duplicate site id');
  });

  test('passes with minimal valid openai config & multi-site', () => {
    const cfg = baseCfg();
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  test('passes when legacy DOCUMENTATION_BASE_URL is present in addition to sites', () => {
    const cfg = baseCfg();
    cfg.DOCUMENTATION_BASE_URL = 'https://docs.example.com';
    expect(() => validateConfig(cfg)).not.toThrow();
  });
});
