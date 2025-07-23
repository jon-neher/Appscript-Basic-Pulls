#!/usr/bin/env node
/* eslint-disable no-console */
import { CONFIG } from '../src/config/nodeConfig.js';
import { analysePage } from '../src/pipeline/pageAnalysis.js';
import { FileVectorStore } from '../src/store/FileVectorStore.js';
import path from 'node:path';

// Lite crawler – pulls site map XML or scrapes anchor hrefs from home page.
// For brevity, this implementation reads a simple newline-delimited list
// of paths from stdin. Example usage:
//   cat paths.txt | bin/crawl-and-analyse.js

async function main() {
  /** @type {string[]} */
  const lines = (await getStdin())
    .split(/\r?\n/) // newlines
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    console.error('Error: No page paths provided on stdin.');
    process.exit(1);
  }

  const base = CONFIG.DOCUMENTATION_BASE_URL.replace(/\/$/, '');

  for (const relPath of lines) {
    const pageId = relPath.replace(/^\//, '');
    const url = base + (relPath.startsWith('/') ? relPath : `/${relPath}`);

    console.log(`• Analysing ${url}`);
    try {
      const { summary } = await analysePage(pageId, url);
      console.log(`  ↳ Summary: ${summary.substring(0, 80)}…`);
    } catch (err) {
      console.error('  ✖ Failed:', err.message);
    }
  }

  const store = new FileVectorStore();
  console.log(`Embeddings persisted to ${path.relative(process.cwd(), store.filename)}`);
}

// ---- helpers ----

async function getStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

main();
