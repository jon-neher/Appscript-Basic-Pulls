/**
* ChatBot.ts
* Basic Google Chat bot handler exposing onMessage, onSlashCommand, and doPost entry points.
* Implements VEN-25 `/capture-knowledge` slash-command logic.
*/

/* eslint-disable @typescript-eslint/no-explicit-any */

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
function onMessage(event: ChatEvent) {
  const userText = event?.message?.text ?? '';
  return createResponse({ text: `You said: "${userText}"` });
}

/**
* Handle slash-command events from Google Chat.
*/
function onSlashCommand(event: ChatEvent) {
  const commandId: number = event?.message?.slashCommand?.commandId as number;

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

        // In future this context will be persisted (VEN-26). For now, just acknowledge.
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
* Apps Script `doPost` entrypoint. Accepts raw HTTP POST data from Chat.
* Converts it to JSON and dispatches to the appropriate handler.
*/
function doPost(e: GoogleAppsScript.Events.DoPost) {
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
// Export functions for Apps Script runtime
// ---------------------------------------------------------------------------

(globalThis as any).onMessage = onMessage;
(globalThis as any).onSlashCommand = onSlashCommand;
(globalThis as any).doPost = doPost;

export { onMessage, onSlashCommand, doPost };
