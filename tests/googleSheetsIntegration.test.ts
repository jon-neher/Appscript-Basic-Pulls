// ---------------------------------------------------------------------------
// Mocks – must be declared *before* importing the module under test so the
// internal import of @googleapis/sheets resolves to this stub.
// ---------------------------------------------------------------------------

const appendMock = jest.fn().mockResolvedValue({});

jest.mock('googleapis', () => {
  return {
    google: {
      auth: {
        GoogleAuth: jest.fn().mockImplementation(() => ({})),
      },
      sheets: jest.fn().mockReturnValue({
        spreadsheets: {
          values: {
            append: appendMock,
          },
        },
      }),
    },
  };
});

// After mocks are in place we can import the module.
import { formatCapturedKnowledge, appendRows, HEADER_ROW } from '../src/integrations/googleSheets';

// ---------------------------------------------------------------------------
// formatCapturedKnowledge
// ---------------------------------------------------------------------------

describe('googleSheets.formatCapturedKnowledge()', () => {
  it('converts a captured knowledge object into the expected row array', () => {
    const entry = {
      timestamp: '2025-07-25T12:34:56.000Z',
      source: 'spaces/AAAA/threads/BBBB',
      content: 'Example content',
      tags: ['foo', 'bar'],
    };

    const row = formatCapturedKnowledge(entry);
    expect(row).toEqual([
      '2025-07-25T12:34:56.000Z',
      'spaces/AAAA/threads/BBBB',
      'Example content',
      'foo, bar',
    ]);
  });
});

// ---------------------------------------------------------------------------
// appendRows
// ---------------------------------------------------------------------------

describe('googleSheets.appendRows()', () => {
  beforeEach(() => {
    appendMock.mockClear();
  });

  it('invokes the Sheets API with the expected parameters', async () => {
    const rows = [HEADER_ROW as unknown as string[]];

    await appendRows(rows, { spreadsheetId: 'test-spreadsheet-id', retries: 1 });

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'test-spreadsheet-id',
        requestBody: { values: rows },
      })
    );
  });
});
