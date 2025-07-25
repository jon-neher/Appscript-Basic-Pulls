/**
* contextWindow.ts
*
* Utility for preparing a subset of chat messages that fits inside a given
* token budget.
*
* Algorithm (MVP – VEN-45):
* 1. Always keep the original question (index 0).
* 2. Prefer the newest *up-to* 10 messages (excluding the first).
* 3. If the resulting selection still exceeds the `maxTokens` budget we drop
*    messages from the *middle* (i.e. older messages that are neither the
*    very first nor part of the latest ten) until the budget is respected.
* 4. As a last-ditch fallback (extremely rare) we trim from the oldest of the
*    preserved “latest 10” messages. The first message is **never** removed –
*    callers must choose an appropriate budget so that at least the original
*    question fits.
*
* The helper purposefully over-approximates the token count by equating one
* whitespace-separated word to one token. This is good enough for the MVP and
* keeps the implementation lightweight and dependency-free.
*/

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
* Minimal shape we expect for a chat message. Both Google ChatMessage objects
* (VEN-26) and OpenAI chat messages have either a `text` or `content` string.
* We remain permissive here so the function can operate on any message type
* the caller passes in without unnecessary generics or type narrowing.
*/
export interface MessageLike {
  text?: string;
  content?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Rough token estimator – 1 word ≈ 1 token
// ---------------------------------------------------------------------------

function wordCountToTokens(text: string): number {
  // Fast path for empty / whitespace-only strings.
  if (!text) return 0;

  // Split on consecutive whitespace. `\s+` also matches newlines which is
  // handy for multi-line messages.
  const words = text.trim().split(/\s+/);
  return words.filter(Boolean).length;
}

function estimateMessageTokens(msg: MessageLike): number {
  const raw = typeof msg.text === 'string' ? msg.text : msg.content ?? '';
  return wordCountToTokens(raw);
}

// ---------------------------------------------------------------------------
// Public API – buildContextWindow
// ---------------------------------------------------------------------------

/**
* Build a context window that respects the given `maxTokens` budget.
*
* The returned array preserves chronological order (oldest → newest).
*/
export function buildContextWindow<T extends MessageLike>(
  fullMessages: T[],
  maxTokens: number,
): T[] {
  // ---------------------------------------------------------------------
  // Budget guards
  // ---------------------------------------------------------------------

  // 0. Treat positive Infinity as *unlimited* budget – return a shallow copy
  //    so callers cannot mutate the input array.
  if (maxTokens === Infinity) {
    // Unlimited budget: return all messages in chronological order.
    return fullMessages.slice();
  }

  // 1. Guard against non-positive or non-finite budgets (NaN, -Infinity) –
  //    treat as “no room for any messages”. Positive Infinity is handled
  //    above.
  if (maxTokens <= 0 || !Number.isFinite(maxTokens)) {
    return [];
  }

  const totalMessages = fullMessages.length;
  if (totalMessages === 0) return [];

  // Shortcut – when the conversation is a single message just return it (it
  // must be the original question by definition).
  if (totalMessages === 1) {
    return fullMessages;
  }

  // Compute token cost for every message once up-front – O(n) instead of re-
  // estimating on every removal iteration.
  const tokenCosts = fullMessages.map(estimateMessageTokens);

  // -----------------------------------------------------------------------
  // 1. Seed the selection with *all* messages so we can progressively prune
  //    the middle when the budget is exceeded.
  // -----------------------------------------------------------------------

  const selected = new Set<number>();
  for (let i = 0; i < totalMessages; i += 1) selected.add(i);

  // -----------------------------------------------------------------------
  // 2. Ensure the very first message (index 0) always stays.
  // -----------------------------------------------------------------------

  const firstIndex = 0;

  // -----------------------------------------------------------------------
  // 3. Identify the indices of the newest ≤10 messages (excluding index 0).
  // -----------------------------------------------------------------------

  const newest10Start = Math.max(totalMessages - 10, 1); // ensure >0 so we don’t capture the first again
  const newest10Indices: number[] = [];
  for (let i = newest10Start; i < totalMessages; i += 1) {
    newest10Indices.push(i);
  }

  // -----------------------------------------------------------------------
  // 4. Compute the initial token usage.
  // -----------------------------------------------------------------------

  let currentTokens = tokenCosts.reduce((sum, t) => sum + t, 0);

  // Fast exit when we already fit inside the budget – nothing to remove.
  if (currentTokens <= maxTokens) {
    return fullMessages.slice(); // shallow copy to protect caller from mutability
  }

  // -----------------------------------------------------------------------
  // 5. Remove messages from the *middle* (indices between first and newest10)
  //    oldest-to-newest until we fit.
  // -----------------------------------------------------------------------

  const middleStart = 1; // immediately after the first message
  const middleEnd = newest10Start; // exclusive upper bound

  for (let idx = middleStart; idx < middleEnd && currentTokens > maxTokens; idx += 1) {
    // Skip if the index is already not selected (shouldn’t happen but safe).
    if (!selected.has(idx)) continue;
    selected.delete(idx);
    currentTokens -= tokenCosts[idx];
  }

  // -----------------------------------------------------------------------
  // 6. If *still* over budget we remove from the preserved newest 10 starting
  //    with the *oldest* of those (i.e. the earliest index).
  //    This step is not mentioned explicitly in the ticket but safeguards us
  //    against pathological cases where a single huge message could bust the
  //    budget even when only 11 messages are selected.
  // -----------------------------------------------------------------------

  for (const idx of newest10Indices) {
    if (currentTokens <= maxTokens) break;
    // Never remove the first message.
    if (!selected.has(idx)) continue;
    selected.delete(idx);
    currentTokens -= tokenCosts[idx];
  }

  // NOTE: If we are *still* above the budget here the only selectable message
  // left is the very first one (index 0). We cannot remove it per the spec –
  // choose to return just the first message as a last resort.
  if (currentTokens > maxTokens) {
    return [fullMessages[0]];
  }

  // -----------------------------------------------------------------------
  // Build the final array in chronological order.
  // -----------------------------------------------------------------------

  const result: T[] = [];
  for (let i = 0; i < totalMessages; i += 1) {
    if (selected.has(i)) {
      result.push(fullMessages[i]);
    }
  }

  return result;
}

export default buildContextWindow;
