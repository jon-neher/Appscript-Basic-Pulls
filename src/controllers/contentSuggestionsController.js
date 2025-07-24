/**
* Integration layer (controller/route handlers) for the Intelligent Content
* Suggestions service.  The handlers operate on simple POJOs so they can be
* plugged into different runtimes (Google Apps Script, Express, unit tests).
*
* Runtime shape mirrors a *very* small subset of the Express request/response
* contract to keep things familiar:
*   - The handler receives `{ body: <payload> }`.
*   - It returns `{ statusCode: 200, body: <response> }`.
*
* Additional HTTP metadata (headers, query params, etc.) can be added later
* without changing the public API of the underlying service functions.
*/

import {
  generateContentOutline,
  suggestImprovements,
  provideWritingPrompts,
  identifyConsolidationOrSplit,
  generateExampleSnippets,
} from '../services/contentSuggestions.js';

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
* Builds a successful JSON response envelope.
* @template T
* @param {T} payload
* @return {{ statusCode: number, body: T }}
*/
function ok(payload) {
  return { statusCode: 200, body: payload };
}

// ---------------------------------------------------------------------------
// Handler functions (exported)
// ---------------------------------------------------------------------------

/**
* @param {{ body: import('../services/contentSuggestions.js').ConversationContext }} req
*/
export function generateContentOutlineHandler(req) {
  // Early validation – ensure `messages` array exists for a safe service call.
  if (
    !req ||
    typeof req !== 'object' ||
    !req.body ||
    typeof req.body !== 'object' ||
    !Array.isArray(req.body.messages)
  ) {
    return {
      statusCode: 400,
      body: { error: 'Missing or invalid "messages" array' },
    };
  }

  const outline = generateContentOutline(req.body);
  return ok(outline);
}

/**
* @param {{ body: { pageContent: string } }} req
*/
export function suggestImprovementsHandler(req) {
  // Early validation – ensure a body object with a string `pageContent` exists.
  if (!req || !req.body || typeof req.body.pageContent !== 'string') {
    return {
      statusCode: 400,
      body: { error: 'Missing or invalid "pageContent" field' },
    };
  }

  const suggestions = suggestImprovements(req.body.pageContent);
  return ok(suggestions);
}

/**
* @param {{ body: { topic: string } }} req
*/
export function provideWritingPromptsHandler(req) {
  // Early validation – ensure a body object with a string `topic` exists.
  if (!req || !req.body || typeof req.body.topic !== 'string') {
    return {
      statusCode: 400,
      body: { error: 'Missing or invalid "topic" field' },
    };
  }

  const prompts = provideWritingPrompts(req.body.topic);
  return ok(prompts);
}

/**
* @param {{ body: import('../services/contentSuggestions.js').CorpusMetadata }} req
*/
export function identifyConsolidationOrSplitHandler(req) {
  const result = identifyConsolidationOrSplit(req.body);
  return ok(result);
}

/**
* @param {{ body: { topic: string } }} req
*/
export function generateExampleSnippetsHandler(req) {
  // Early validation – ensure a body object with a string `topic` exists.
  if (!req || !req.body || typeof req.body.topic !== 'string') {
    return {
      statusCode: 400,
      body: { error: 'Missing or invalid "topic" field' },
    };
  }

  const snippets = generateExampleSnippets(req.body.topic);
  return ok(snippets);
}

// ---------------------------------------------------------------------------
// Global exposure for Apps Script builds
// ---------------------------------------------------------------------------

if (typeof globalThis !== 'undefined') {
  globalThis.generateContentOutlineHandler = generateContentOutlineHandler;
  globalThis.suggestImprovementsHandler = suggestImprovementsHandler;
  globalThis.provideWritingPromptsHandler = provideWritingPromptsHandler;
  globalThis.identifyConsolidationOrSplitHandler = identifyConsolidationOrSplitHandler;
  globalThis.generateExampleSnippetsHandler = generateExampleSnippetsHandler;
}
