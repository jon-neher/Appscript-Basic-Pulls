/**
* ChatBot.ts
* Google Chat bot handler exposing onMessage, onSlashCommand, and doPost
* entry points.
*
* NOTE: **Do not** add Node-specific imports at the top-level of this file.
* When the bundle is executed inside Google Apps Script (GAS) the runtime does
* not provide a Node.js standard library (`https`, `tls`, etc.).
*
* The Google Sheets integration that relies on `@googleapis/sheets` must
* therefore be loaded dynamically **only** when the code is running under a
* real Node.js environment (e.g. local CLI, Jest, or Cloud Functions test
* harness).
*
* This conditional-loading approach avoids bundling the heavy dependency tree
* into the `.gs` files pushed with clasp while preserving the same behaviour
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

// Cached promise used to ensure the dynamic import happens at most once per
// process. Subsequent callers of `ensureSheetsIntegration()` await the same
// promise, guaranteeing idempotent initialisation.
let sheetsIntegrationPromise: Promise<void> | null = null;

/**
* Dynamically import the Google Sheets integration the first time we need it.
*
* Because `import()` is just an expression it will be parsed without being
* executed under GAS, but we still guard the call with `IS_NODE` to prevent
* accidental resolution attempts.
*/
function ensureSheetsIntegration(): Promise<void> {
  // Fast-exit when running under Apps Script / non-Node environments.
  if (!IS_NODE) return Promise.resolve();

  // If the helpers are already populated we have nothing to do. Prefer the
  // cached promise (if any) so that concurrent callers share the same state.
  if (formatCapturedKnowledge && appendRows) {
    return sheetsIntegrationPromise ?? Promise.resolve();
  }

  // First caller kicks off the dynamic import and stores the resulting promise
  // so that all other callers await the same work.
  if (!sheetsIntegrationPromise) {
    sheetsIntegrationPromise = import('../integrations/googleSheets')
      .then((mod) => {
        formatCapturedKnowledge = mod.formatCapturedKnowledge as FormatCapturedKnowledgeFn;
        appendRows = mod.appendRows as AppendRowsFn;
      })
      .catch((err) => {
        // Surface the error to all awaiters but keep a rejected promise cached
        // so that future calls don’t repeatedly attempt to import.
        console.error('Failed to load googleSheets integration', err);
        throw err;
      });
  }

  return sheetsIntegrationPromise;
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
* onMessage – entry point for non slash-command MESSAGE events.
*
* Fetches recent thread context, builds a prompt, calls the LLM abstraction
* to generate a helpful and concise reply, and returns the response in the
* format expected by Google Chat.
*/
async function onMessage(event: ChatEvent): Promise<Record<string, unknown>> {
  // Ignore slash-command events entirely.
  if (event?.message?.slashCommand) {
    return createResponse({ text: '' });
  }

  const threadName: string | undefined = event?.message?.thread?.name;

  // If we somehow receive a non-threaded message, fallback to simple echo.
  if (!threadName) {
    const userText = event?.message?.text ?? '';
    return createResponse({ text: `You said: "${userText}"` });
  }

  try {
    // Dynamically import heavy deps so that the Apps Script bundle stays slim.
    const { getThreadMessages } = await import('../services/GoogleChatService');
    const { generateText } = await import('../llm/index');

    const allMessages = await getThreadMessages(threadName);
    const contextWindow = 10;
    const recent = allMessages.slice(-contextWindow);

    const SYSTEM_INST = 'You are a helpful and concise AI assistant.';

    const lines: string[] = [];
    for (const msg of recent) {
      if (!msg.text) continue;
      const speaker = msg.isAiBot ? 'Assistant' : msg.sender?.displayName || 'User';
      lines.push(`${speaker}: ${msg.text}`);
    }

    const prompt = `${SYSTEM_INST}\n\n${lines.join('\n')}\nAssistant:`;

    const aiReply = await generateText(prompt);

    return createResponse({ text: aiReply });
  } catch (err) {
    console.error('onMessage AI reply error', err);
    return createResponse({ text: 'Sorry - I encountered an error while replying.' });
  }
}

// ---------------------------------------------------------------------------
// Slash-command handler
// ---------------------------------------------------------------------------

/**
* Handle slash-command events from Google Chat.
*/
async function onSlashCommand(event: ChatEvent): Promise<Record<string, unknown>> {
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
          // Kick off (and await) the dynamic import so that helpers are ready
          // before we attempt to build the row.
          await ensureSheetsIntegration();

          const maybeWrite = (): void => {
            if (!formatCapturedKnowledge || !appendRows) {
              // Integration not ready (shouldn’t happen because we awaited, but
              // guard defensively so GAS runs safely when IS_NODE is falsy).
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

          // Execute immediately now that helpers are present.
          maybeWrite();
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
async function doPost(
  e: GoogleAppsScript.Events.DoPost
): Promise<GoogleAppsScript.Content.TextOutput> {
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
      response = await onSlashCommand(event);
    } else if (event?.type === 'MESSAGE') {
      response = await onMessage(event);
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
