# AppScript Chat Knowledge Bot

[![Branch coverage](https://img.shields.io/badge/coverage-80%25-brightgreen)](https://github.com/jon-neher/Appscript-Basic-Pulls/actions/workflows/ci.yml)

This repository contains the source code and configuration for a Google Apps Script powered Google Chat bot that helps teams surface and manage knowledge right inside Chat.

The project uses the [Google clasp CLI](https://github.com/google/clasp) for local development and deployment.

## Prerequisites

- Node.js ≥ 18
- Google Apps Script access with permission to create a project
- Google Cloud project with Chat API enabled (for production deployments)
- `npm install -g @google/clasp` (or use the local version via `npm run`)

## Getting started

### Clasp CLI setup (first time only)

1. **Install clasp globally (optional)** – if you prefer a global binary:

   ```bash
   npm install -g @google/clasp
   ```

   _Tip: the repo already includes a local copy under `node_modules/.bin/clasp`, so you can also run it via the provided npm scripts without a global install._

2. **Authenticate with Google**:

   ```bash
   npm run login
   ```

   This opens a browser window so you can grant clasp access to your Google account. The OAuth token is stored in `~/.clasprc.json`.

3. **Create your local `.clasp.json`**:

   ```bash
   cp .clasp.json.example .clasp.json
   # then edit .clasp.json and paste your Script ID
   ```

   You can find the Script ID in the Apps Script editor under **Project Settings → Script ID**. Keep this file out of public repos if it points to a private project!

4. **Verify connectivity**:

   ```bash
   npm run logs -- --help  # should print the clasp logs help text
   ```

Once `.clasp.json` is in place the following convenience scripts are available:

| Script   | What it does                                               |
|----------|------------------------------------------------------------|
| `push`   | Upload the contents of `src/` (or `dist/` after a build)   |
| `pull`   | Download the latest remote files into your local tree      |
| `deploy` | Create **or update** a versioned deployment                |
| `logs`   | Stream execution logs in real-time                         |

All scripts are thin wrappers around their equivalent `clasp <command>` counterparts to avoid memorizing flags.

## Connecting to the shared script

This repository is already wired up to the *team-shared* Google Apps Script project. The real `scriptId` lives in the root-level `.clasp.json` file and is version-controlled, so you don’t need to copy it around or set any environment variables.

Typical first-time workflow:

1. `npm install` – install dependencies (including the local `@google/clasp` binary)
2. `npm run login` – open a browser window so clasp can authorize your Google account and write the token to `~/.clasprc.json`
3. `npm run push` – upload the contents of `src/` to the shared script

After that you can iterate with the usual `push` / `pull` / `open` commands as documented below.

## NPM scripts

| Script  | Purpose                             |
|---------|-------------------------------------|
| `login` | Authenticate clasp with your Google account |
| `push`  | Upload the contents of `src/` to the linked Apps Script project |
| `pull`  | Download the latest project files into `src/` |
| `deploy`| Create/override a deployment for the web app (used by the Chat bot) |
| `open`  | Open the project in the browser |

## Project layout

- `src/` – All Apps Script `.gs` (and plain `.js`) files plus the `appsscript.json` manifest.
- `docs/` – Additional project documentation.

## Usage – interacting with the bot in Google Chat

### 1  Ask the bot for help

Mention the bot directly in any Chat space or DM and append the keyword `help`:

```text
@Knowledge Bot help
```

The bot responds with a concise capability overview so that first-time users know what is available:

```text
Need a hand? Here’s what I can do:
- `/capture-knowledge` — archive the current conversation context in the team knowledge spreadsheet.
- `/ping` — quick connectivity check (returns "pong").
```

> **Tip**: If you address the bot outside a thread it simply echoes back your
> text (e.g. `You said: "help"`).

### 2  Capture conversation context (`/capture-knowledge`)

Run the slash-command inside **a threaded conversation** to save the entire
thread into the configured Google Sheets knowledge base:

```text
/capture-knowledge
```

Successful response:

```text
Got it – captured context for thread <threadId> in space <spaceId>.
```

Behind the scenes the bot:

- Calls the Google Chat REST API to fetch every message in the thread (handles
  pagination beyond 100 messages).
- Converts the raw messages into Markdown and stores a single row in the sheet
  whose ID is provided via `SHEETS_SPREADSHEET_ID`.

If you run the command outside a thread the bot replies with a helpful error
message explaining that the command must be executed inside a threaded
conversation.

## Manifest highlights (`src/appsscript.json`)

- Uses the modern **V8** runtime.
- Declares the OAuth scope `https://www.googleapis.com/auth/chat.bot` required for Chat bots.
- Configured as a **web app** so the published URL can be added to Google Chat.

## License

This project is licensed under the MIT License – see the [LICENSE](LICENSE) file for details.


## Google Sheets integration (VEN-36)

The `/capture-knowledge` command stores a small metadata entry for each captured
thread in a dedicated Google Sheets spreadsheet. A more detailed conversation
snapshot pipeline will be added in future issues, but the current minimal
integration already provides a searchable audit trail for all captured
conversations.

### Service-account credentials

1. In Google Cloud Console create a **service account** with at least the
   _Editor_ role for the target spreadsheet (or grant the account direct edit
   permissions in the Sheet’s **Share** dialog).
2. Generate a **JSON key** and download the file.
3. Move the JSON file to `config/google-sheets-credentials.json` (or any other
   path outside version control) and make sure
   `GOOGLE_APPLICATION_CREDENTIALS` points at that file.

> The default `.gitignore` already excludes
> `config/google-sheets-credentials.json` so you won’t accidentally commit the
> secret. **Never** commit the raw key to a public repo.

### Spreadsheet layout

The first worksheet of the spreadsheet must have **A1:D1** set to the exact
header titles below. The integration will *append* new rows under this header:

| A          | B      | C       | D   |
| ---------- | ------ | ------- | --- |
| Timestamp  | Source | Content | Tags |

The `Tags` column receives a comma-separated string when multiple tags are
present.

Feel free to adjust column widths, enable text wrapping, or add filters – the
integration uses the `USER_ENTERED` valueInputOption so formatting is
preserved.

## Configuration

All secrets and runtime options are now resolved via a **single** helper:

```ts
import { getConfig } from './src/config';

const sheetId = getConfig('SHEETS_SPREADSHEET_ID');
```

The helper transparently looks up the key in:

1. `process.env` (Node/Jest)
2. `PropertiesService.getScriptProperties()` (Apps Script)

and throws a descriptive error when a *required* value is missing.

### Required runtime keys

| Key | Purpose | Notes |
|-----|---------|-------|
| `SHEETS_SPREADSHEET_ID` | Target spreadsheet id for captured knowledge | e.g. `1AbCdEf...` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Absolute or relative path to a **service-account key JSON** that has **Editor** access to the spreadsheet | Used by Google Sheets integration when the bot runs in Node/CI |

### Optional / advanced keys

| Key | Purpose | Default |
|-----|---------|---------|
| `GOOGLE_CHAT_ACCESS_TOKEN` | OAuth token for Google Chat API **only** when running integration tests outside Apps Script | Not required in production |
| `ENABLE_AI` | When set to **`true`** the bot re-enables its AI-generated *assistant* replies for normal `MESSAGE` events. Leave unset or set to any other value to keep the MVP placeholder (`"AI reply path disabled for MVP."`). | Disabled |

### GitHub Actions secrets (CI / CD)

The default **CI / Test → Deploy** workflow expects **four** additional secrets – they are **only used by the GitHub runner**, not at runtime:

| Secret | Why it’s needed |
|--------|-----------------|
| `CLASP_CLIENT_ID` | OAuth client id for the Apps Script API (see Google Cloud Console credentials page) |
| `CLASP_CLIENT_SECRET` | OAuth client secret matching the above client id |
| `CLASP_REFRESH_TOKEN` | Long-lived refresh token generated via `clasp login --no-localhost` |
| `SCRIPT_ID` | The Script ID of the linked Apps Script project (found under **Project Settings → Script ID**) |

> **Tip**: Any additional key accessed via `getConfig()` automatically
> inherits the same lookup semantics—no code changes required.


### Enabling the AI reply flow (opt-in)

The MVP ships with the AI-generated reply path **disabled by default**. To try
it locally or in a staging deployment simply set the environment variable:

```bash
# in your shell or `.env` file
export ENABLE_AI=true

# then run the server / tests / `clasp push` as usual
```

When the flag is **not** `true` the bot responds to non-command messages with
the placeholder text `AI reply path disabled for MVP.`. Slashes commands such
as `/capture-knowledge` are unaffected.


## TypeScript & esbuild build pipeline (2025-07)

The Apps Script portion of the repo is now written in **TypeScript** and bundled
with [esbuild](https://esbuild.github.io/) into a single `bundle.gs` file. The
workflow is completely driven by npm scripts:

| Script | What it does |
| ------ | ------------ |
| `npm run build`  | Executes esbuild (`build/esbuild.config.js`) then copies an updated manifest to `dist/`. |
| `npm run watch`  | Same as build but starts esbuild in **watch** mode for sub-100 ms incremental rebuilds. |
| `npm run deploy` | Runs the build and immediately `clasp push --rootDir dist`, ensuring only the bundled output is uploaded. |

The `appsscript.json` manifest in `dist/` automatically sets:

```json
{
  "rootDir": "dist",
  "filePushOrder": ["bundle.gs", "appsscript.json"]
}
```

so that Google’s clasp tool uploads your code first, followed by the manifest.

> **Heads-up**: The original `.gs` files have been migrated to TypeScript under
> `src/server/`. Tests now import the configuration through
> `src/config/nodeConfig.js`, so `npm test` still works out-of-the-box.


## Architecture & UX Patterns

- [Ack → Action Flow](docs/ack-action-flow.md)



