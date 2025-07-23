/**
* Core Google Chat bot message handling framework.
*
* This file implements the basic handlers and helpers required to receive
* Google Chat events in an Apps Script deployment. It purposefully keeps
* logic minimal and synchronous so that it can run in the Chat execution
* environment without additional build steps.
*
* Event reference:
* https://developers.google.com/workspace/chat/receive-respond-interactions#event
*/

// Note: We previously surfaced the bot’s display name as a constant for
// mention‐detection.  The logic now relies on the stable `event.bot.name`
// resource identifier instead, so the constant has been removed to avoid
// confusion and unused-code clutter.

/**
* ---------------------------------------------------------------------------
* Keyword triggers — temporarily disabled
* ---------------------------------------------------------------------------
* We initially experimented with a handful of generic trigger words ("help",
* "kb", "knowledge") so that users could simply type a keyword instead of a
* full slash-command.  In practice this proved far too noisy: the bot would
* respond to casual conversation where those words naturally appear.  Until
* we design a more targeted keyword strategy, the bot will rely *exclusively*
* on explicit slash-commands.  Uncomment the constant below **and** the
* corresponding block in `shouldProcessMessage()` when you are ready to
* re-enable keyword detection.
*
* @type {string[]}
*/
// const TRIGGER_KEYWORDS = ['help', 'kb', 'knowledge'];

/**
* Entrypoint for MESSAGE events coming from Google Chat.
*
* @param {GoogleAppsScript.Events.ChatMessageEvent} event Raw Chat event
*   (https://developers.google.com/workspace/chat/api/reference/rest/v1/Event)
* @return {GoogleAppsScript.ChatV1.Schema.Message|undefined} Chat message
*   response or undefined to send no response.
*/
function onMessage(event) {
  try {
    // Basic sanity check – only process MESSAGE events.
    if (event.type !== 'MESSAGE') {
      console.info('Ignoring non-MESSAGE event', event.type);
      return;
    }

    console.info('Incoming MESSAGE event', JSON.stringify(event));

    // If the message is a slash-command invocation, hand off to the
    // dedicated handler.
    if (event.message && event.message.slashCommand) {
      return onSlashCommand(event);
    }

    // Filter out messages we shouldn’t react to.
    if (!shouldProcessMessage(event)) {
      console.info('Message skipped – did not meet processing criteria');
      return;
    }

    const userText = event.message?.argumentText ?? event.message?.text ?? '';

    /* -------------------------------------------------------------------
     * Thread understanding via LLM (VEN-8)
     * ------------------------------------------------------------------- */
    // Collect a sliding window of messages.  The Chat API does not expose a
    // convenient "get thread" endpoint inside Apps Script, so for now we
    // include **only** the current message plus the immediate parent if this
    // message is part of a thread.  Expand this once the REST wrapper is in
    // place.
    /** @type {string[]} */
    var threadMessages = [];
    threadMessages.push(userText);

    // Optionally include the quoted parent when present (Google Chat sends
    // `message.threadReply` events that reference the parent message in
    // `message.thread.replyMessage`).  The shape is undocumented for Apps
    // Script; guard defensively.
    if (event.message?.thread?.replyMessage?.text) {
      threadMessages.unshift(event.message.thread.replyMessage.text);
    }

    // Call the cross-runtime wrapper.  The function is attached to the global
    // scope by `src/llm/apiWrapper.js`, so we can reference it directly.
    /** @type {Object} */
    var llmAnalysis;
    try {
      llmAnalysis = sendThreadForUnderstanding(threadMessages);

      // In the unlikely event this handler runs in an environment that
      // returns a Promise (e.g. Node-based integration tests) we *blockingly*
      // wait for resolution so the rest of the code can treat the result as a
      // plain object.
      if (llmAnalysis && typeof llmAnalysis.then === 'function') {
        var resolved = false;
        var error;
        var value;
        llmAnalysis
          .then(function (v) {
            resolved = true;
            value = v;
          })
          .catch(function (err) {
            resolved = true;
            error = err;
          });
        // Yield CPU while waiting for the Promise to settle.  In production
        // Apps Script this loop should rarely iterate because UrlFetchApp
        // calls are synchronous, but defensive mocks in tests may return an
        // unresolved Promise.  Sleeping prevents a tight spin-loop from
        // consuming runtime quota.
        while (!resolved) {
          // Google Apps Script provides the `Utilities.sleep()` API which
          // blocks the current thread but yields CPU back to the runtime so we
          // don’t hog our execution quota.  When this code runs in other
          // runtimes (e.g. Node inside Jest) the global `Utilities` object is
          // *undefined* which would raise a ReferenceError.  Guard the call so
          // tests keep running cross-runtime.

          if (typeof Utilities !== 'undefined' && typeof Utilities.sleep === 'function') {
            // Apps Script → cooperative blocking sleep.
            Utilities.sleep(50); // ≈50 ms
          } else if (typeof Atomics !== 'undefined' && typeof SharedArrayBuffer !== 'undefined') {
            // Node / other JS → light blocking sleep using Atomics.wait().  This
            // yields the event loop long enough for Promises to settle without
            // introducing async/await into this synchronous handler.
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
          } else {
            // Fallback – last resort tight spin (should be extremely rare).
            var start = Date.now();
            while (Date.now() - start < 50) {
              /* noop */
            }
          }
        }
        if (error) throw error;
        llmAnalysis = value;
      }
    } catch (analysisErr) {
      console.error('Thread understanding failed', analysisErr, analysisErr.stack);
      llmAnalysis = null;
    }

    // Build a user-friendly reply summarising the analysis.
    var responseText;
    if (llmAnalysis) {
      responseText =
        '*Topic:* ' + llmAnalysis.topic + '\n' +
        '*Question type:* ' + llmAnalysis.questionType + '\n' +
        '*Technical level:* ' + llmAnalysis.technicalLevel + '\n' +
        '*Urgency:* ' + llmAnalysis.urgency + '\n' +
        '*Key concepts:* ' + llmAnalysis.keyConcepts.join(', ');
    } else {
      responseText = `You said: "${userText.trim()}".`;
    }

    return createResponse({
      text: responseText,
      event,
    });
  } catch (err) {
    // Log stack for debugging and send a generic error to the user.
    console.error('onMessage error', err, err.stack);
    return createResponse({
      text: 'Sorry – something went wrong processing your message.',
      event,
    });
  }
}

/**
* Handler for slash-command invocations.
*
* @param {GoogleAppsScript.Events.ChatMessageEvent} event Chat event that
*   contains a `message.slashCommand` payload.
* @return {GoogleAppsScript.ChatV1.Schema.Message} Chat app response.
*/
function onSlashCommand(event) {
  try {
    console.info('Incoming SLASH_COMMAND', JSON.stringify(event));

    const slash = event.message.slashCommand; // Guaranteed by caller.
    const commandName = slash.commandName; // Text after the leading “/”.

    // Simple dispatch – extend with real commands as needed.
    switch (commandName) {
      case 'help':
        return createResponse({
          text: 'Hi! I\'m Knowledge Bot. Mention me or type /kb to search the knowledge base.',
          event,
        });

      case 'ping':
        return createResponse({ text: 'pong', event });

      default:
        return createResponse({
          text: `Unknown command "/${commandName}". Try /help for a list of commands.`,
          event,
        });
    }
  } catch (err) {
    console.error('onSlashCommand error', err, err.stack);
    return createResponse({
      text: 'Sorry – something went wrong while running that command.',
      event,
    });
  }
}

/**
* Determines whether the incoming message should be processed by the bot.
* Rules:
*   1. Always process direct (1:1) messages.
*   2. In spaces/rooms, process when the bot is explicitly mentioned.
*   3. (Temporarily disabled) Keyword triggers — will process when text starts
*      with a configured trigger keyword once the strategy is finalized.
*
* @param {GoogleAppsScript.Events.ChatMessageEvent} event Chat message event.
* @return {boolean} True if the bot should respond.
*/
function shouldProcessMessage(event) {
  // Direct messages (singleUserBotDm) always go through.
  if (event.space?.singleUserBotDm) {
    return true;
  }



  // Check for an @mention directed at this bot.
  // A mention annotation is considered addressed to this app when:
  //   • The annotation type is the Chat enum value `USER_MENTION`.
  //   • The mentioned entity is a bot (`user.type === 'BOT'`).
  //   • The stable resource name (`user.name`, e.g. "users/AAAA...") matches
  //     the current bot’s `event.bot.name`.
  // Using the resource name avoids brittle comparisons against the mutable
  // `displayName` property.
  if (event.message?.annotations && event.bot?.name) {
    const isMentioned = event.message.annotations.some(function (annotation) {
      if (annotation.type !== 'USER_MENTION') return false;

      const mentionedUser = annotation.userMention?.user;
      if (!mentionedUser) return false;

      return (
        mentionedUser.type === 'BOT' &&
        mentionedUser.name === event.bot.name
      );
    });

    if (isMentioned) return true;
  }

  // Keyword trigger detection disabled — see rationale at the TRIGGER_KEYWORDS
  // constant definition.  When keyword triggers are re-enabled, restore the
  // block below and ensure the constant is uncommented as well.
  //
  // const firstWord = text.split(/\s+/)[0];
  // if (TRIGGER_KEYWORDS.includes(firstWord)) {
  //   return true;
  // }

  return false;
}

/**
* Creates a response object compatible with the Google Chat API.
* Accepts plain-text responses and (optionally) Cards v2.
* Automatically threads the response in spaces by re-using the incoming
* thread; in DMs threading is omitted so the message is shown inline.
*
* @param {{ text: string, card?: GoogleAppsScript.ChatV1.Schema.CardWithId, event?: Object }} params
* @return {GoogleAppsScript.ChatV1.Schema.Message}
*/
function createResponse(params) {
  const { text, card, event } = params;

  /** @type {GoogleAppsScript.ChatV1.Schema.Message} */
  const response = { text: text || '' };

  if (card) {
    response.cardsV2 = [card];
  }

  // Preserve threading context when responding in spaces.
  if (event && !event.space?.singleUserBotDm && event.message?.thread?.name) {
    response.thread = { name: event.message.thread.name };
  }

  return response;
}

// Attach trigger handlers to the global object so that Apps Script can invoke
// them directly when the bundle is executed.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – global assignment for GAS runtime.
(globalThis as any).onMessage = onMessage;
// @ts-ignore
(globalThis as any).onSlashCommand = onSlashCommand;

// Re-export for other TypeScript modules / esbuild entry point.
export { onMessage, onSlashCommand };
