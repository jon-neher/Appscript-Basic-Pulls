/**
* GoogleChatService.ts
*
* Wrapper utilities for interacting with the Google Chat REST API.
* Implements getThreadMessages() for VEN-26.
*
* The function is designed to run in both:
*   1. Apps Script runtime – uses UrlFetchApp + ScriptApp.getOAuthToken().
*   2. Node.js (for local Jest tests) – uses global fetch and reads the access
*      token from the environment variable GOOGLE_CHAT_ACCESS_TOKEN.
*
* Returned messages are sorted in ascending chronological order (oldest first)
* and each message has an additional `isAiBot` boolean indicating whether the
* sender matches the configured AI-bot identity.
*/

// NOTE: We previously disabled `@typescript-eslint/no-explicit-any` for the entire
// file.  That blanket disable hid potentially unsafe `any` usages and could allow
// accidental regressions. We now scope the rule to the handful of intentional
// places where `any` is truly necessary (dynamic JSON parsing, unknown
// third-party payloads, etc.) by inserting `eslint-disable-next-line
// @typescript-eslint/no-explicit-any` comments immediately before each
// occurrence.

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface ChatMessage {
  name: string;
  text?: string;
  createTime?: string; // RFC3339 timestamp string
  sender?: {
    name?: string; // e.g. "users/123456789"
    displayName?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;

  /**
   * True when the sender matches the configured AI-bot identity.
   */
  isAiBot: boolean;
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/**
* Attempt to retrieve the OAuth access token for Google Chat API requests.
*
* – In Apps Script we can call ScriptApp.getOAuthToken().
* – In Node/CI the token must be supplied via the env var GOOGLE_CHAT_ACCESS_TOKEN.
*/
function getAccessToken(): string {
  // Apps Script runtime
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – ScriptApp is only defined in Apps Script
  if (typeof ScriptApp !== 'undefined' && typeof ScriptApp.getOAuthToken === 'function') {
    // @ts-ignore – ScriptApp typings only available in GAS
    return ScriptApp.getOAuthToken();
  }

  const token = process.env.GOOGLE_CHAT_ACCESS_TOKEN;
  if (token) return token;

  throw new Error('No Google Chat OAuth token found. Set GOOGLE_CHAT_ACCESS_TOKEN.');
}

/**
* Determine whether a given sender object represents the AI bot.
*
* This checks against two optional configuration sources:
*   – AI_BOT_USER_ID     → matches sender.name
*   – AI_BOT_DISPLAY_NAME → matches sender.displayName
*
* Both values can be provided via:
*   – Script Properties  (for production Apps Script):
*       PropertiesService.getScriptProperties().getProperty('AI_BOT_USER_ID')
*   – Environment variables (for local tests / CI):
*       process.env.AI_BOT_USER_ID, process.env.AI_BOT_DISPLAY_NAME
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isAiBotSender(sender: any): boolean {
  if (!sender) return false;

  // Try Apps Script properties first (no-ops in Node)
  let botUserId: string | undefined;
  let botDisplayName: string | undefined;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – PropertiesService only exists in GAS
  if (typeof PropertiesService !== 'undefined') {
    // @ts-ignore
    const props = PropertiesService?.getScriptProperties?.();
    botUserId = props?.getProperty?.('AI_BOT_USER_ID') as string | undefined;
    botDisplayName = props?.getProperty?.('AI_BOT_DISPLAY_NAME') as string | undefined;
  }

  // Fallback to env vars for Node/tests – guard access in case `process` is
  // undefined (e.g. Apps Script runtime). Accessing `process` unconditionally
  // would throw a ReferenceError in that environment.
  if (typeof process !== 'undefined') {
    botUserId = botUserId || process.env.AI_BOT_USER_ID;
    botDisplayName = botDisplayName || process.env.AI_BOT_DISPLAY_NAME;
  }

  return (
    (!!botUserId && sender.name === botUserId) ||
    (!!botDisplayName && sender.displayName === botDisplayName)
  );
}

// ---------------------------------------------------------------------------
// HTTP helper – abstracts UrlFetchApp vs fetch()
// ---------------------------------------------------------------------------

interface HttpResponse<T = unknown> {
  status: number;
  data: T;
}

async function httpGet<T = unknown>(url: string, headers: Record<string, string>): Promise<HttpResponse<T>> {
  // Apps Script branch – synchronous UrlFetchApp
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – UrlFetchApp only in GAS
  if (typeof UrlFetchApp !== 'undefined') {
    try {
      // @ts-ignore – UrlFetchApp typings only in GAS
      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers,
        muteHttpExceptions: true,
      });

      const status = response.getResponseCode();
      const text = response.getContentText();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsed: any = undefined;
      try {
        parsed = JSON.parse(text);
      } catch (jsonErr) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parsed = text as any;
      }

      return { status, data: parsed } as HttpResponse<T>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      throw err;
    }
  }

  // Node.js / fetch branch
  // Use axios in Node.js for compatibility with nock (easier to mock).
  // Dynamically require to avoid bundling axios into GAS output unnecessarily.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const axios = require('axios');

  const res = await axios.get(url, { headers, validateStatus: () => true });
  return { status: res.status, data: res.data } as HttpResponse<T>;
}

// ---------------------------------------------------------------------------
// getThreadMessages implementation
// ---------------------------------------------------------------------------

/**
* Fetch all messages for a given Google Chat thread.
*
* @param threadResourceName Full resource name – e.g. "spaces/AAA/threads/BBB".
* @returns Array of ChatMessage sorted oldest → newest.
*/
/**
* Fetch messages for a given Google Chat thread.
*
* When `limit` is provided the function retrieves **at most** that many most-recent
* messages and therefore issues fewer network requests than fetching the entire
* thread. Internally it requests pages in **descending** order (`orderBy=DESC`)
* so that the first page already contains the newest messages.
*
* When `limit` is omitted the behaviour is unchanged – the full thread is fetched
* in ascending order just like the original implementation.
*
* @param threadResourceName Full resource name – e.g. "spaces/AAA/threads/BBB".
* @param limit Optional maximum number of messages to return (latest ⟶ oldest).
*              Pass `Infinity` or omit for no limit.
* @returns Array of ChatMessage sorted oldest → newest.
*/
export async function getThreadMessages(
  threadResourceName: string,
  limit: number = Infinity
): Promise<ChatMessage[]> {
  const accessToken = getAccessToken();
  // Do not URI-encode the threadResourceName wholesale – Google APIs expect the
  // literal path (e.g. "spaces/AAA/threads/BBB"). Individual path segments are
  // already URL-safe. Encoding the `/` characters would break the endpoint.
  const baseUrl = `https://chat.googleapis.com/v1/${threadResourceName}/messages`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  } as Record<string, string>;

  const allMessages: ChatMessage[] = [];

  // If the caller requested a finite limit we can optimise the number of
  // network round-trips by:
  //   1. Asking the API for `orderBy=DESC` (newest first).
  //   2. Requesting pages sized to the limit (≤100) so the first page already
  //      contains all we need in the common case.

  const hasLimit = Number.isFinite(limit);
  const MAX_API_PAGE = 100;
  const pageSize = hasLimit ? Math.min(Math.trunc(limit as number), MAX_API_PAGE) : MAX_API_PAGE;

  let pageToken: string | undefined = undefined;

  try {
    do {
      const url = new URL(baseUrl);
      url.searchParams.set('pageSize', String(pageSize));
      // Use descending order when limiting so the newest messages arrive first.
      if (hasLimit) {
        url.searchParams.set('orderBy', 'DESC');
      }
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { status, data } = await httpGet<{ messages?: any[]; nextPageToken?: string }>(
        url.toString(),
        headers
      );

      if (status >= 400) {
        console.error('Google Chat API error', {
          status,
          payload: data,
        });
        throw new Error(`Google Chat API returned HTTP ${status}`);
      }

      const messages = data?.messages ?? [];
      // Augment with isAiBot flag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages.forEach((msg: any) => {
        const fullMsg: ChatMessage = {
          ...msg,
          isAiBot: isAiBotSender(msg?.sender),
        } as ChatMessage;
        allMessages.push(fullMsg);
      });

      // Stop early if we have enough recent messages.
      if (hasLimit && allMessages.length >= limit) {
        break;
      }

      pageToken = data?.nextPageToken;
    } while (pageToken);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    // Attempt to include status & payload if available
    if (err?.status) {
      console.error('Google Chat API fetch error', {
        status: err.status,
        message: err?.message,
        payload: err?.data,
      });
    } else {
      console.error('Google Chat API fetch error', err);
    }

    throw err; // re-throw so caller knows it failed
  }

  // Helper to safely convert an ISO/RFC3339 timestamp string to milliseconds.
  // Returns 0 when the input is missing or unparsable so the comparator always
  // yields a finite number (Array.sort comparator must not return NaN).
  const toMillis = (iso?: string): number => {
    const parsed = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  };

  // Sort chronologically (oldest → newest). Using `toMillis` guarantees the
  // comparator never returns `NaN`, which could otherwise throw a runtime
  // error or lead to inconsistent ordering in V8.
  allMessages.sort((a, b) => toMillis(a.createTime) - toMillis(b.createTime));

  if (hasLimit) {
    // Return the last `limit` items (oldest → newest) – slicing guards against
    // the final page being larger than the requested limit.
    return allMessages.slice(-limit as number);
  }

  return allMessages;
}
