/**
* Node-side loader for the Apps Script configuration module (`Config.gs`).
*
* Google Apps Script uses the non-standard `.gs` extension.  Node does not have
* a built-in loader for this extension and historically the codebase patched
* `require.extensions['.gs']` so that `require('../Config.gs')` "just worked".
*
* Unfortunately `require.extensions` is deprecated and mutating it at runtime
* introduces global side-effects that can clash with other tooling (Jest
* workers, ts-node, etc.).  Instead of monkey-patching the CommonJS loader we
* compile the file ourselves using Node’s public `module` API.  This keeps the
* change completely local to this module – no global state is modified.
*
* The loader works synchronously so consumers can `import { CONFIG }` without
* having to deal with promises or top-level await.  Under the hood the file is
* read from disk once and executed inside a brand-new CommonJS `Module`
* instance which exposes the expected `module`, `exports`, and `require`
* globals.  `Config.gs` already populates `module.exports`, so we simply return
* `exports.CONFIG` from the compiled module.
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire, Module as NodeModule } from 'node:module';

/**
* Compiles a CommonJS file at `filename` and returns the `module.exports`.
*
* @param {string} filename Absolute path to a JavaScript/GS file.
* @returns {*} The `exports` object produced by executing the file.
*/
function compileCommonJs(filename) {
  const code = fs.readFileSync(filename, 'utf8');

  // Create a fresh CommonJS `Module` instance detached from the normal module
  // graph.  The public `Module` constructor takes an `id` and an optional
  // `parent` – we pass the absolute filename as the id and `null` for parent
  // to keep the new module fully isolated.
  const mod = new NodeModule(filename, null);

  // Populate `module.paths` so that nested `require()` calls inside the
  // compiled file resolve using Node’s standard lookup algorithm.  The
  // _resolveLookupPaths helper is internal/underscore-prefixed but *far* less
  // volatile than `_nodeModulePaths` and is what Node itself calls under the
  // hood.  We fall back to an empty array on runtimes that remove it.
  /* eslint-disable no-underscore-dangle */
  if (typeof NodeModule._resolveLookupPaths === 'function') {
    try {
      // Node ≤20 returned `[request, paths]` while newer versions return just
      // `paths`.  Normalise to an array of paths either way.
      const lookup = NodeModule._resolveLookupPaths('', { id: filename, filename, paths: [] });
      mod.paths = Array.isArray(lookup)
        ? (Array.isArray(lookup[0]) ? lookup[0] : (Array.isArray(lookup[1]) ? lookup[1] : lookup))
        : [];
    } catch {
      mod.paths = [];
    }
  } else {
    mod.paths = [];
  }
  /* eslint-enable no-underscore-dangle */

  // Inject a local `require` that resolves relative to the config file itself.
  mod.require = createRequire(pathToFileURL(filename));

  // `_compile` is the only officially documented escape-hatch for executing
  // CommonJS code programmatically.  It wraps the source and provides the
  // expected CommonJS globals (`module`, `exports`, `require`, etc.).  Using it
  // avoids touching any deprecated extension hooks or global state.
  /* eslint-disable no-underscore-dangle */
  mod._compile(code, filename);
  /* eslint-enable no-underscore-dangle */

  return mod.exports;
}

/**
* Attempts to locate and load the configuration module.
*
* 1. Prefer a sibling `Config.js` file if one exists – this allows future
*    migration away from `.gs` without touching this loader again.
* 2. Fallback to `Config.gs` (current implementation).
*/
function loadConfigModule() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  const jsPath = path.resolve(__dirname, '../Config.js');
  if (fs.existsSync(jsPath)) {
    return compileCommonJs(jsPath);
  }

  const gsPath = path.resolve(__dirname, '../Config.gs');
  if (fs.existsSync(gsPath)) {
    return compileCommonJs(gsPath);
  }

  throw new Error('Unable to locate Config.gs or Config.js next to nodeConfig.js');
}

const { CONFIG } = /** @type {{ CONFIG: any }} */ (loadConfigModule());

export { CONFIG };
