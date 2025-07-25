/**
* ChatBot.ts
* Google Chat bot handler exposing onMessage, onSlashCommand, and doPost
* entry points.
*
* NOTE: **Do not** add Node-specific imports at the top-level of this file.
* When the bundle is executed inside Google Apps Script (GAS) the runtime does
* not provide a Node.js standard library (`https`, `tls`, etc.).
*
* The Google Sheets integration that relies on `@googleapis/sheets` must therefore
* be loaded dynamically **only** when the code is running under a real Node.js
* environment (e.g. local CLI, Jest, or Cloud Functions test harness).
*
* This conditional-loading approach avoids bundling the heavy dependency tree
* into the `.gs` files pushed with `clasp` while preserving the same behaviour
* when the bot is executed in a pure Node context.
*/

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Runtime detection helpers
// ---------------------------------------------------------------------------

/**
* Very small feature-flag that tells us whether we are executing inside a
* Node.js process. When bundled for Apps Script the global `process` object is
* absent, so this check reliably discriminates between the two runtimes.
*/
const IS_NODE: boolean = typeof process !== 'undefined' && !!process?.versions?.node;

// ---------------------------------------------------------------------------
// Lazy Google Sheets integration (loaded only under Node.js)
// ---------------------------------------------------------------------------

type FormatCapturedKnowledgeFn = (entry: {
  timestamp: string;
  source: string;
  content: string;
  tags?: string[];
}) => string[];

type AppendRowsFn = (rows: string[][]) => Promise<void>;

let formatCapturedKnowledge: FormatCapturedKnowledgeFn | null = null;
let appendRows: AppendRowsFn | null = null;

/**
* Dynamically import the Google Sheets integration the first time we need it.
*
* Because `import()` is just an expression it will be parsed without being
* executed under GAS, but we still guard the call with `IS_NODE` to prevent
* accidental resolution attempts.
*/
/**
* Promise that resolves once the Google Sheets integration has been imported
* and the helpers have been cached. A `null` value means the import has not
* been attempted yet.
*/
let sheetsIntegrationPromise: Promise<unknown> | null = null;

/**
* Dynamically load the Google Sheets integration **exactly once** per process
* and expose the exported helpers via the module-level variables declared
* above. Subsequent calls return the same promise so that concurrent
* invocations can simply `await` the first import instead of triggering extra
* work.
*/
function ensureSheetsIntegration(): Promise<void> {
  if (!IS_NODE) {
    // In the Apps Script runtime the integration is never required.
    return Promise.resolve();
  }

  // If the helpers are already populated we can return a resolved promise
  // immediately. This is the fast-path for the common case where the module
  // has been imported once earlier in the process life-cycle.
  if (formatCapturedKnowledge && appendRows) {
    return Promise.resolve();
  }

  // Kick off the dynamic import exactly once.
  if (!sheetsIntegrationPromise) {
    sheetsIntegrationPromise = import('../integrations/googleSheets')
      .then((mod) => {
        formatCapturedKnowledge = mod.formatCapturedKnowledge as FormatCapturedKnowledgeFn;
        appendRows = mod.appendRows as AppendRowsFn;
      })
      .catch((err) => {
        // Surface the error so callers can decide whether to retry or ignore.
        console.error('Failed to load googleSheets integration', err);
        throw err;
      });
  }

  // Coerce to `Promise<void>` so that callers don't rely on the imported
  // module shape. The helpers are exposed via the cached variables.
  return sheetsIntegrationPromise.then(() => undefined);
}

// ---------------------------------------------------------------------------
// Types & basic helpers
// ---------------------------------------------------------------------------

type ChatEvent = any; // Inline type placeholder – Apps Script runtime provides dynamic payload.

/**
* Utility to build a simple text response payload for Chat.
*/
function createResponse({ text }: { text: string; event?: ChatEvent }): Record<string, unknown> {
  return { text };
}

/**
* Default onMessage handler – currently echoes a placeholder response.
*/
function onMessage(event: ChatEvent): Record<string, unknown> {
  const userText = event?.message?.text ?? '';
  return createResponse({ text: `You said: "${userText}"` });
}

// ---------------------------------------------------------------------------
// Slash-command handler
// ---------------------------------------------------------------------------

/**
* Handle slash-command events from Google Chat.
*/
function onSlashCommand(event: ChatEvent): Record<string, unknown> {
  // `commandId` is a numeric literal (per manifest) but we allow string literals
  // for legacy internal commands such as "ping".
  const commandId = event?.message?.slashCommand?.commandId as number | string;

  switch (commandId) {
    // ---------------------------------------------------------------------
    // VEN-25 – /capture-knowledge
    // ---------------------------------------------------------------------
    case 2: {
      try {
        const spaceName: string | undefined = event?.space?.name;
        const threadName: string | undefined = event?.message?.thread?.name;

        if (!spaceName) {
          throw new Error('Missing space identifier in event.');
        }
        if (!threadName) {
          throw new Error(
            'Missing thread identifier – run /capture-knowledge inside a threaded conversation.'
          );
        }

        const spaceId = spaceName.split('/').pop() || spaceName;
        const threadId = threadName.split('/').pop() || threadName;

        // Only attempt the Sheets write when running under Node.js.
        if (IS_NODE) {
          const maybeWrite = (): void => {
            if (!formatCapturedKnowledge || !appendRows) {
              // Integration not ready yet – this should not happen after
              // awaiting `ensureSheetsIntegration()` but we guard just in case.
              return;
            }

            try {
              const knowledgeRow = formatCapturedKnowledge({
                timestamp: new Date().toISOString(),
                source: `${spaceId}/${threadId}`,
                content: `Thread captured via /capture-knowledge (thread ${threadId})`,
                tags: ['chat'],
              });

              // Fire-and-forget to keep the Chat latency low – errors are logged
              // asynchronously and do NOT affect the immediate user response.
              void appendRows([knowledgeRow]).catch((err) =>
                console.error('Sheets append error', err)
              );
            } catch (sheetErr) {
              // Don’t fail the command for Sheets errors – just log them.
              console.error('googleSheets integration error', sheetErr);
            }
          };

          // Kick off an async task so we can await the integration promise
          // without turning the entire slash-command handler into an async
          // function (which would break the synchronous Apps Script contract).
          void (async () => {
            try {
              await ensureSheetsIntegration();
              maybeWrite();
            } catch (loadErr) {
              // Import failed – already logged inside ensureSheetsIntegration().
              console.error('Sheets integration initialisation failed', loadErr);
            }
          })();
        }

        return createResponse({
          text: `Got it – captured context for thread ${threadId} in space ${spaceId}.`,
        });
      } catch (err: any) {
        console.error('/capture-knowledge error', err); // Log for Stackdriver.
        return createResponse({
          text:
            'Sorry – I couldn’t capture the conversation context. ' +
            (err?.message || 'Unexpected error.'),
        });
      }
    }

    // ------------------------------------------------------------------
    // Example placeholder command – responds with pong.
    // ------------------------------------------------------------------
    case 'ping':
      return createResponse({ text: 'pong' });

    default:
      // Unknown command.
      return createResponse({
        text: `Unknown command "${commandId}".`,
      });
  }
}

// ---------------------------------------------------------------------------
// HTTP Web-app POST entry point (for Chat events)
// ---------------------------------------------------------------------------

/**
* Apps Script `doPost` entry-point. Accepts raw HTTP POST data from Chat.
* Converts it to JSON and dispatches to the appropriate handler.
*/
function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  try {
    const raw = e?.postData?.contents;
    if (!raw) {
      return ContentService.createTextOutput( // eslint-disable-line no-undef
        JSON.stringify({ text: 'No payload received.' })
      ).setMimeType(ContentService.MimeType.JSON); // eslint-disable-line no-undef
    }

    const event: ChatEvent = JSON.parse(raw);

    let response: Record<string, unknown> | null = null;
    if (event?.message?.slashCommand) {
      response = onSlashCommand(event);
    } else if (event?.type === 'MESSAGE') {
      response = onMessage(event);
    }

    return ContentService.createTextOutput(
      JSON.stringify(response ?? { text: 'Unsupported event.' })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error('doPost error', err);
    return ContentService.createTextOutput(
      JSON.stringify({ text: 'Internal error handling event.' })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ---------------------------------------------------------------------------
// Export top-level functions for the Apps Script runtime
// ---------------------------------------------------------------------------

(globalThis as any).onMessage = onMessage;
(globalThis as any).onSlashCommand = onSlashCommand;
(globalThis as any).doPost = doPost;

export { onMessage, onSlashCommand, doPost };
