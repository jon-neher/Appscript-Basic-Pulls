// build/esbuild.config.js
// Esbuild configuration for bundling the server-side Apps Script code into a
// single IIFE-formatted bundle that is compatible with the V8 runtime.
//
// Run via:
//   npx esbuild --config build/esbuild.config.js
// or using the predefined npm scripts (see package.json).
//
// The "esbuild-gas-plugin" strips unsupported Node globals, rewrites
// `globalThis` to the Apps Script global scope, and ensures the output file
// ends with a ".gs" extension so that `clasp push` treats it as a valid Apps
// Script file.

import { GasPlugin } from 'esbuild-gas-plugin';

/** @type {import('esbuild').BuildOptions} */
const options = {
   entryPoints: ['src/server/index.ts'],
   bundle: true,
   target: 'es2020',
   format: 'iife',
   outfile: 'dist/bundle.gs',
   plugins: [GasPlugin],
   sourcemap: false,
};

// When executed directly via `node build/esbuild.config.js` run the build.
if (import.meta.url === `file://${process.argv[1]}`) {
  // eslint-disable-next-line no-console
  console.info('[esbuild] Bundling Apps Script…');
  import('esbuild').then(async ({ build, context }) => {
    try {
      if (process.argv.includes('--watch')) {
        const ctx = await context(options);
        await ctx.watch();
      } else {
        await build(options);
      }
    } catch {
      process.exit(1);
    }
  });
}

export default options;
