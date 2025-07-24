# Ack → Action Flow for Google Chat Bots

> **Why this matters** — Google Chat HTTP callbacks must complete within ~30 seconds.  Any operation that might exceed that window (LLM calls, GitHub/Linear API hits, CI checks, etc.) **must run after the initial HTTP response**.  The *ack → action* flow lets the bot feel snappy while still performing heavy work.

---

## 1. Overview

- **Pattern purpose:** reply *immediately* to user messages so Chat’s UI shows a quick acknowledgement (✅ *“Got it – working…”*) and then post a **follow-up** message once analysis / external actions finish.
- **Entry points:** `src/server/ChatBot.ts` exposes two Apps Script global functions that receive Google Chat events:  
  - `onMessage(e)` – regular messages  
  - `onSlashCommand(e)` – slash-commands (e.g. `/help`)
- Both handlers call `createResponse()` to craft the synchronous HTTP reply.

<details>
<summary>Sequence diagram</summary>

```text
User            Chat                     Apps Script runtime                    GitHub
│  "@bot do X"   │                               │                               │
│───────────────▶│ HTTP POST event               │                               │
│                │─────────────────────────────▶│ onMessage(e)                  │
│                │                               │  createResponse('👌 …')       │
│                │                               │  ╰─ returns HTTP 200 (≤30 s) │
│                │◀─────────────────────────────│                               │
│ ACK rendered   │                               │                               │
│────────────────▶│                               │                               │
│                │                               │ doActionInBackground(e)      │
│                │                               │  ├─ callOpenAI(...)          │
│                │                               │  ├─ call GitHub API          │
│                │                               │  ╰─ Chat.Spaces.Messages.create│
│                │                               │            "✅ PR created …" │
│                │◀─────────────────────────────│                               │
│ Follow-up in thread                              │                               │
```
</details>

---

## 2. HTTP Timeout Constraint (≈ 30 s)

Google Chat waits ~30 seconds for the bot’s webhook to respond; after that the request is aborted and the user sees **no message**. See *Receive & respond to Chat interactions* in the Workspace Chat docs.

```txt
Your service must send an HTTP 200 response within 30 seconds, otherwise the message
is dropped.
```

¹ *Source: developers.google.com/workspace/chat/receive-respond-interactions*

---

## 3. Immediate acknowledgement

```ts
// src/server/ChatBot.ts
export function onMessage(e: ChatEvent): ChatV1.Schema$Message {
  // … decide whether to process …

  // 1️⃣ Quick ACK — **must** finish <30 s
  const ack = createResponse({
    text: '👌 Got your request – working on it…',
    event: e,
  });

  // 2️⃣ Trigger async work (fire-and-forget)
  void doActionInBackground(e);

  return ack;
}
```

> ⚠️ **Apps Script quirk** — The V8 runtime **waits for every pending Promise to settle** before it serialises the return value and sends the HTTP 200. In other words, even though we don’t `await` `doActionInBackground(e)`, any network calls inside that function still eat into the same ≈30-second window. If the combined work is likely to exceed the limit, offload it to a time-driven trigger, Pub/Sub topic, or an external Cloud Function and respond immediately.

**Key points**
- `createResponse()` automatically threads the ACK when `event.message.thread?.name` is present.
- `void` before `doActionInBackground` tells TypeScript we intentionally ignore the returned Promise — we don’t await it.

---

## 4. Background work invocation

```ts
async function doActionInBackground(evt: ChatEvent): Promise<void> {
  const space = evt.space?.name ?? '';
  const thread = evt.message?.thread?.name ?? undefined; // undefined ⇒ DM

  const analysis = await sendThreadForUnderstanding(buildThreadHistory(evt));

  // Example side-effect: create a GitHub PR
  const prUrl = await createPullRequest(analysis);

  // …then post the outcome back to Chat
  await postFollowUp({
    space,
    thread,
    text: `✅ Pull request opened: ${prUrl}`,
  });
}
```

Persist `space` and `thread` IDs early; they are required later to address the follow-up message.

---

## 5. Deferred follow-up message

- Use **Advanced Chat service** in Apps Script (`Chat.Spaces.Messages.create`) **or** raw `UrlFetchApp.fetch()` against `https://chat.googleapis.com/v1/spaces/{space}/messages`.
- Always supply `thread.name` when replying in a room; omit it for DMs.

```ts
function postFollowUp(opts: { space: string; thread?: string; text: string }) {
  const body: GoogleAppsScript.Chat_v1.Schema$Message = {
    text: opts.text,
    thread: opts.thread ? { name: opts.thread } : undefined,
  };

  Chat.Spaces.Messages.create(body, opts.space);
}
```

---

## 6. OAuth & advanced service configuration

1. **Enable** the Google Chat API in the Cloud project tied to your Apps Script.
2. Toggle the Advanced Service inside the Apps Script editor (Resources → Advanced Google services).
3. Add the necessary scopes in `appsscript.json`:

```json
{
  "timeZone": "America/Chicago",
  "exceptionLogging": "STACKDRIVER",
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/chat.bot",              // read events & send basic messages
    "https://www.googleapis.com/auth/chat.messages.create"   // post follow-ups
  ]
}
```

Apps Script automatically re-uses the script’s own service account; no manual token handling is needed when you call the Advanced Service.

---

## 7. Quotas & retry strategies

- **Write limits:** ~60 messages per space per minute and ~3 000 per project per minute.
- If an action might burst writes (e.g., batch PR updates) apply exponential back-off (`Utilities.sleep()`) or queueing.
- Network failures: wrap `Chat.Spaces.Messages.create` in a retry helper with jittered back-off.

---

## 8. Error handling

Catch and log **all** errors inside `doActionInBackground()`.  On failure, post an error message so the user is not left waiting:

```ts
try {
  // …do work…
} catch (err) {
  console.error(err);
  await postFollowUp({
    space,
    thread,
    text: `⚠️ Sorry – I hit a problem: ${(err as Error).message}`,
  });
}
```

---

## 9. Thread vs. DM behaviour

| Scenario | `thread.name` to pass | Result |
|----------|----------------------|--------|
| DM       | *omit*               | Message appears inline in the DM |
| Space     (reply in thread) | `event.message.thread.name` | Follow-up is grouped under the user’s thread |
| Space, *new* thread | *omit* | Starts a brand-new thread in the space |

---

## 10. Discoverability & links

- Include canonical URLs (e.g., GitHub PR, Linear issue, internal dashboard) in the follow-up text so they are indexed by Chat search.
- For critical flows you can also store a mapping in Firestore / Properties `{threadMessageId → resourceUrl}` to power a *“My requests”* slash-command later.

---

### TL;DR implementation checklist

1. Return `createResponse({ text: '👌 …', event })` **within 30 s**.  
2. If the follow-up work might run longer than ~30 s **delegate it** to a time-driven trigger, Pub/Sub, or Cloud Function instead of running it inline.  
3. `void doActionInBackground(e)` only for lightweight tasks that finish quickly.  
4. Inside the async helper: perform work → `Chat.Spaces.Messages.create()` follow-up.  
5. Add `https://www.googleapis.com/auth/chat.messages.create` to `appsscript.json`.  
6. Handle errors & respect write quotas.
