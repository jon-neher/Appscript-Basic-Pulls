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
    if (event.type !== 'MESSAGE') {
      console.info('Ignoring non-MESSAGE event', event.type);
      return;
    }

    console.info('Incoming MESSAGE event', JSON.stringify(event));

    if (event.message && event.message.slashCommand) {
      return onSlashCommand(event);
    }

    if (!shouldProcessMessage(event)) {
      console.info('Message skipped – did not meet processing criteria');
      return;
    }

    const userText = event.message?.argumentText ?? event.message?.text ?? '';

    // -------------------------------------------------------------------
    // Thread understanding via LLM (VEN-8)
    // -------------------------------------------------------------------

    const threadMessages = collectThreadMessages(event, userText);

    let llmAnalysis;
    try {
      llmAnalysis = sendThreadForUnderstanding(threadMessages);

      // Some test environments stub the wrapper with an async function. We
      // synchronously resolve the promise so the rest of the handler can stay
      // sync-friendly for Apps Script.
      if (llmAnalysis && typeof llmAnalysis.then === 'function') {
        llmAnalysis = resolvePromiseSync(llmAnalysis);
      }
    } catch (analysisErr) {
      console.error('Thread understanding failed', analysisErr, analysisErr.stack);
      llmAnalysis = null;
    }

    const responseText = llmAnalysis
      ? [
          `*Topic:* ${llmAnalysis.topic}`,
          `*Question type:* ${llmAnalysis.questionType}`,
          `*Technical level:* ${llmAnalysis.technicalLevel}`,
          `*Urgency:* ${llmAnalysis.urgency}`,
          `*Key concepts:* ${llmAnalysis.keyConcepts.join(', ')}`,
        ].join('\n')
      : `You said: "${userText.trim()}".`;

    return createResponse({ text: responseText, event });
  } catch (err) {
    console.error('onMessage error', err, err.stack);
    return createResponse({
      text: 'Sorry – something went wrong processing your message.',
      event,
    });
  }
}

// ---------------------------------------------------------------------------
// Extracted helpers – keep the main handler readable.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared sleep buffer – reused by resolvePromiseSync().
// ---------------------------------------------------------------------------

// Apps Script (and many JS runtimes) expose Atomics & SharedArrayBuffer which
// allow a cooperative, blocking sleep without a tight busy-wait.  Creating a
// **new** SharedArrayBuffer on every 50 ms tick however quickly balloons into
// thousands of tiny allocations during a long wait.  We allocate a single
// 4-byte buffer at module scope and reuse its Int32Array view for every
// `Atomics.wait()` call.

const _sleepSab: SharedArrayBuffer | undefined =
  typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined'
    ? new SharedArrayBuffer(4)
    : undefined;
// The typed view is undefined when SharedArrayBuffer is unavailable so that
// the branch in `sleep()` can simply check for truthiness.
const _sleepI32: Int32Array | undefined = _sleepSab
  ? new Int32Array(_sleepSab)
  : undefined;

/**
* Builds the `threadMessages` array used by the LLM analysis wrapper.
*
* @param {*} event Google Chat event.
* @param {string} userText Current user message text (already extracted).
* @returns {string[]} Ordered list of messages (oldest → newest).
*/
function collectThreadMessages(event, userText) {
  /** @type {string[]} */
  const messages = [userText];

  if (event.message?.thread?.replyMessage?.text) {
    messages.unshift(event.message.thread.replyMessage.text);
  }

  return messages;
}

/**
* Synchronously resolves a Promise in environments (like Jest) where the
* cross-runtime wrapper returns one. Uses environment-specific methods to
* yield execution without blocking CPU where possible.
*
* @template T
* @param {Promise<T>} promise
* @returns {T}
* @throws {*} Re-throws the original rejection reason if the promise rejects.
*/
function resolvePromiseSync(promise) {
  let resolved = false;
  let value;
  let error;

  promise
    .then((v) => {
      resolved = true;
      value = v;
    })
    .catch((err) => {
      resolved = true;
      error = err;
    });

  // Busy-wait with cooperative sleeps to avoid burning CPU. Uses the reusable
  // SharedArrayBuffer view declared at module scope when available.
  const sleep = () => {
    if (
      typeof Utilities !== 'undefined' &&
      typeof Utilities.sleep === 'function'
    ) {
      // Apps Script – cooperative scheduler-friendly sleep.
      Utilities.sleep(50);
    } else if (_sleepI32) {
      // Node + many runtimes – block via Atomics.wait on a shared buffer.
      Atomics.wait(_sleepI32, 0, 0, 50);
    } else {
      // Fallback – busy-wait loop (worst-case but universally supported).
      const start = Date.now();
      while (Date.now() - start < 50) {
        /* noop */
      }
    }
  };

  // Absolute deadline (30 s safety net) to avoid hanging forever if the
  // promise never settles – e.g. faulty stub in a Jest test.
  const deadline = Date.now() + 30_000; // 30 seconds

  // Loop until the promise settles *or* we hit the safety timeout.
  while (!resolved) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for Promise to settle (30 s)');
    }
    sleep();
  }

  if (error) throw error;
  return value;
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
