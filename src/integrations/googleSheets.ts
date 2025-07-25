/**
* googleSheets.ts
*
* Lightweight wrapper around the Google Sheets API (v4) that provides two
* helper functions used by the capture-knowledge pipeline:
*   - `formatCapturedKnowledge()` → converts an arbitrary captured knowledge
*     object into a flat array of cell values that matches the fixed column
*     layout in the target sheet.
*   - `appendRows()` → appends one or more rows to the configured spreadsheet
*     with retry logic for simple rate-limit handling.
*
* The implementation relies on the "@googleapis/sheets" client library and
* authenticates using Application Default Credentials. In local development
* and CI this is normally provided by setting the env var
* `GOOGLE_APPLICATION_CREDENTIALS` to point at a service-account JSON file.
*
* The spreadsheet to write to is read from the env var
* `SHEETS_SPREADSHEET_ID` **or** can be supplied explicitly via the optional
* `spreadsheetId` argument on `appendRows()` – useful for unit tests.
*/

import { google, sheets_v4 } from 'googleapis';

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

export const HEADER_ROW = ['Timestamp', 'Source', 'Content', 'Tags'] as const;

/**
* Minimal representation of a captured knowledge item.
*/
export interface CapturedKnowledge {
  /** ISO-8601 / RFC-3339 timestamp string */
  timestamp: string;
  /** Human-readable source identifier (thread ID, URL, ...) */
  source: string;
  /** Raw content – markdown or plain-text */
  content: string;
  /** Optional list of tags (will be joined with a comma + space) */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let cachedClient: sheets_v4.Sheets | null = null;

async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (cachedClient) return cachedClient;

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  cachedClient = google.sheets({ version: 'v4', auth });
  return cachedClient;
}

function defaultSpreadsheetId(): string {
  const id = process.env.SHEETS_SPREADSHEET_ID;
  if (!id) {
    throw new Error(
      'Missing spreadsheet id – set SHEETS_SPREADSHEET_ID in the environment or pass it explicitly.'
    );
  }
  return id;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
* Convert a `CapturedKnowledge` object into a flat array matching
* `[Timestamp, Source, Content, Tags]`.
*/
export function formatCapturedKnowledge(entry: CapturedKnowledge): string[] {
  return [
    entry.timestamp,
    entry.source,
    entry.content,
    (entry.tags ?? []).join(', '),
  ];
}

/**
* Append one or more rows to the spreadsheet.
*
* Basic exponential-backoff retry handling is included for 429/5xx responses.
*/
export async function appendRows(
  rows: string[][],
  opts: {
    /** Override the spreadsheet id instead of using the env var. */
    spreadsheetId?: string;
    /** Provide a pre-configured sheets client (primarily for tests). */
    sheetsClient?: sheets_v4.Sheets;
    /** Maximum retry attempts (default 3). */
    retries?: number;
  } = {}
): Promise<void> {
  if (!rows?.length) return; // Nothing to do.

  const spreadsheetId = opts.spreadsheetId ?? defaultSpreadsheetId();
  const sheets = opts.sheetsClient ?? (await getSheetsClient());

  const maxAttempts = Math.max(opts.retries ?? 3, 1);

  // Simple exponential-backoff loop – 1s, 2s, 4s ...
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'A1', // Start cell is irrelevant – API infers next row.
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows },
      });
      return; // Success!
    } catch (err: any) {
      attempt += 1;

      // Allow caller to see a contextualised error after final attempt.
      if (attempt >= maxAttempts) {
        const details = {
          spreadsheetId,
          rows,
          attempts: attempt,
        };
        const enrichedErr = new Error(
          `appendRows failed after ${attempt} attempts – ${err?.message || err}`
        );
        (enrichedErr as any).details = details; // eslint-disable-line @typescript-eslint/no-explicit-any
        throw enrichedErr;
      }

      // Only retry on rate limits (429) or server errors (>=500).
      const code: number | undefined = err?.response?.status ?? err?.code ?? err?.status;
      if (code && (code === 429 || code >= 500)) {
        const delayMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s ...
        await new Promise((res) => setTimeout(res, delayMs));
        // eslint-disable-next-line no-continue
        continue;
      }

      // Non-retryable error.
      throw err;
    }
  }
}

export default {
  HEADER_ROW,
  formatCapturedKnowledge,
  appendRows,
};
