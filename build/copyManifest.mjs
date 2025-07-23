// build/copyManifest.mjs
// Simple helper that copies the Apps Script manifest into the `dist/`
// directory and ensures the "rootDir" and "filePushOrder" fields are set so
// that `clasp push` treats the bundled output as the entry file.

import fs from 'node:fs';
import path from 'node:path';

const srcPath = path.resolve('src/appsscript.json');
const dstDir = path.resolve('dist');
const dstPath = path.join(dstDir, 'appsscript.json');

if (!fs.existsSync(srcPath)) {
   console.error('apps script manifest not found at', srcPath);
   process.exit(1);
}

// Ensure dist directory exists.
fs.mkdirSync(dstDir, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(srcPath, 'utf8'));

manifest.rootDir = 'dist';
manifest.filePushOrder = ['bundle.gs', 'appsscript.json'];

fs.writeFileSync(dstPath, JSON.stringify(manifest, null, 2));
console.info('Copied manifest to', dstPath);
