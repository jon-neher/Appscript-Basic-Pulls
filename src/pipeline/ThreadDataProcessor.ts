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
