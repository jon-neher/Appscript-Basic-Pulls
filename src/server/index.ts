// Entry point for Apps Script bundle
//
// We re-export the public trigger handlers so that esbuild’s tree-shaker can
// detect and hoist them to the IIFE’s top-level scope. Each export is also
// copied onto the global object because Google Chat expects these exact
// function names to exist at runtime.

export { onMessage, onSlashCommand } from './ChatBot';
