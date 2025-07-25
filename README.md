# Knowledge Capture Bot for Google Chat

Capture human corrections and additions surfaced in Google Chat threads so your documentation never falls behind.

This Google Apps Script–powered Chat bot lets support and engineering teams quickly save valuable context when an AI assistant gives an incomplete or wrong answer. The `/capture-knowledge` slash-command extracts the full thread, identifies what the AI said versus what humans corrected, and writes any gaps to a Google Sheet for later documentation updates.

## 👉 Project Purpose

- **Surface missing or outdated docs** – every human correction is treated as a documentation gap.
- **Keep context where the conversation happened** – invoke a single slash-command, no copy-paste.
- **Built entirely with Google Apps Script** – zero servers to run or bills to pay.

## MVP Feature List

- `/capture-knowledge` slash-command
- Thread extraction (messages + metadata)
- Storage in Google Sheets (one row per captured thread)
- Identification of AI- vs human-authored messages

## Setup Instructions (local dev)

1. Clone repo → `git clone https://github.com/jon-neher/AppScript-Chat-Knowledge.git && cd AppScript-Chat-Knowledge`
2. Install clasp + deps → `npm install -g @google/clasp && npm install`
3. `clasp login`
4. `clasp create --type standalone --title "Knowledge Capture Bot"` then copy the Script ID into `.clasp.json`
5. Create a Google Sheet and put its ID in `src/SheetsManager.js` (`const SHEET_ID = '...'`)
6. `clasp push` to deploy.

## Usage

Type `/capture-knowledge` in any Chat thread. The bot confirms and stores the thread in Sheets.

## Architecture

| Layer            | Responsibility                                           |
| ---------------- | --------------------------------------------------------- |
| Google Chat App  | Receives slash-commands and routes events to Apps Script |
| Apps Script      | Parses thread and writes data to Sheets                  |
| Google Sheets    | Lightweight review queue / knowledge base               |

## Development commands

- `clasp push` – deploy code
- `clasp pull` – sync down latest script
- `clasp logs` – view execution logs

## Contributing
