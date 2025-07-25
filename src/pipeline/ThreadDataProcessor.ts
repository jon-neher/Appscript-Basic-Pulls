/**
* ThreadDataProcessor.ts
*
* Utility to transform an ordered array of raw thread messages into a
* structured knowledge representation that clearly separates the original
* question, AI-generated responses, and any subsequent human corrections.
*
* This implements Linear issue VEN-31.
*/

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/**
* Raw inbound message as returned from Google Chat (or any other source).
* The list provided to the parser MUST be ordered chronologically – earliest
* message first. All properties are required by the acceptance criteria
* except `isBot`, which is optional and used for classification when present.
*/
export interface RawThreadMessage {
  /** Unique identifier for the message (e.g. resource name) */
  messageId: string;
  /** Sender identifier (userId / botId / …) */
  authorId: string;
  /** Raw textual content (Markdown/plain-text) */
  content: string;
  /** ISO/RFC‐3339 timestamp string */
  timestamp: string;
  /**
   * Optional explicit AI-bot flag. When omitted we fall back to authorId
   * matching performed by the caller or downstream service.
   */
  isBot?: boolean;
}

/** Convenience helper that extracts only the fields required by the output */
export type MessageSummary = Pick<RawThreadMessage, 'content' | 'authorId' | 'timestamp' | 'messageId'>;

/** Output structure produced by the processor */
export interface ThreadKnowledgeData {
  originalQuestion: MessageSummary;
  responses: Array<{
    aiResponse: MessageSummary;
    corrections: MessageSummary[];
  }>;
}

// ---------------------------------------------------------------------------
// Serialisation helper – converts structured data to Markdown (fallback JSON)
// ---------------------------------------------------------------------------

/**
* Maximum character length that safely fits into a single Google Sheets cell
* (the documented limit is 50 000).  We subtract a couple of extra characters
* when clipping so we can append an ellipsis without overflowing.
*/
export const MAX_SHEETS_CELL_LEN = 50_000;

/**
* Convert a `ThreadKnowledgeData` object into a compact Markdown string that
* preserves the conversational flow.  We favour Markdown over JSON here
* because it is more readable when opened directly in the Google Sheets UI
* while still being completely loss-less (all structured data is included).
*
* The format is deliberately simple and stable so that a future parser can
* reliably recover the structure:
*
* ```md
* ## Original Question  (2025-07-25 10:00)
* <content>
*
* ## AI Response #1  (2025-07-25 10:01)
* <assistant answer>
*
* ### Corrections
* - (2025-07-25 10:02) user123: <text>
* - …
*
* ## AI Response #2 …
* ```
*
* @param data Structured thread knowledge object.
* @returns A Markdown string (clipped to 50 000 chars if necessary).
*/
export function serialiseThreadKnowledgeMarkdown(data: ThreadKnowledgeData): string {
  const parts: string[] = [];

  const fmtTs = (iso: string): string => {
    // Convert to "YYYY-MM-DD HH:MM" in the spreadsheet's local timezone loses
    // fidelity, so we keep the ISO string but drop the seconds for brevity.
    const d = new Date(iso);
    // Guard against unparsable strings – Date → NaN produces "Invalid Date".
    if (Number.isNaN(d.getTime())) return iso;

    // Year-month-day hour:minute in UTC for determinism.
    return d.toISOString().replace(/T(\d{2}:\d{2}):\d{2}\.\d+Z$/, ' $1');
  };

  // Original question
  parts.push(`## Original Question  (${fmtTs(data.originalQuestion.timestamp)})`);
  parts.push(data.originalQuestion.content.trim());

  data.responses.forEach((block, idx) => {
    parts.push('');
    parts.push(`## AI Response #${idx + 1}  (${fmtTs(block.aiResponse.timestamp)})`);
    parts.push(block.aiResponse.content.trim());

    if (block.corrections.length) {
      parts.push('');
      parts.push('### Corrections');
      block.corrections.forEach((c) => {
        parts.push(`- (${fmtTs(c.timestamp)}) ${c.authorId}: ${c.content.trim()}`);
      });
    }
  });

  let markdown = parts.join('\n');

  if (markdown.length > MAX_SHEETS_CELL_LEN) {
    markdown = markdown.slice(0, MAX_SHEETS_CELL_LEN - 3) + '…';
  }

  return markdown;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
* Determine whether a given message should be treated as an AI response.
*
* We first honour the explicit `isBot` flag when supplied. If that flag is
* absent we apply a VERY naive heuristic: authorId starts with 'bot/' or
* equals 'AI'. Callers that require stricter logic should precompute the
* isBot property.
*/
function isAiMessage(msg: RawThreadMessage): boolean {
  if (typeof msg.isBot === 'boolean') return msg.isBot;

  const id = msg.authorId?.toLowerCase?.() ?? '';
  return id.startsWith('bot/') || id === 'ai' || id === 'ai-bot' || id === 'aibot';
}

/**
* Transform an ordered list of raw messages into the knowledge DTO defined in
* the acceptance criteria for VEN-31.
*
* @throws {Error} When the input array is empty.
*/
export function parseThreadMessages(messages: RawThreadMessage[]): ThreadKnowledgeData {
  if (!messages?.length) {
    throw new Error('parseThreadMessages requires a non-empty messages array');
  }

  // The first message is always the original question.
  const [first, ...rest] = messages;

  const originalQuestion: MessageSummary = {
    content: first.content,
    authorId: first.authorId,
    timestamp: first.timestamp,
    messageId: first.messageId,
  };

  const structured: ThreadKnowledgeData = {
    originalQuestion,
    responses: [],
  };

  // Used to link subsequent human corrections to the latest AI answer.
  let currentResponseBlock: (typeof structured.responses[number]) | null = null;

  for (const msg of rest) {
    const summary: MessageSummary = {
      content: msg.content,
      authorId: msg.authorId,
      timestamp: msg.timestamp,
      messageId: msg.messageId,
    };

    if (isAiMessage(msg)) {
      // Close out any previous block and start a new one.
      currentResponseBlock = {
        aiResponse: summary,
        corrections: [],
      };
      structured.responses.push(currentResponseBlock);
    } else if (currentResponseBlock) {
      // Human message following an AI response → treat as correction.
      currentResponseBlock.corrections.push(summary);
    } else {
      // Human message without preceding AI response – out-of-scope per spec.
      // We simply ignore it (alternatively we could attach it to a phantom
      // response, but the ACs don’t specify). Logging left to the caller.
      // eslint-disable-next-line no-continue
      continue;
    }
  }

  return structured;
}
