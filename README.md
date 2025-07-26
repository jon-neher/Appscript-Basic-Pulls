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


1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Login to Google** (creates a local `.clasprc.json` *not* committed to Git):

   ```bash
   npm run login
   ```

3. **Push local code to the Apps Script project**

   ```bash
   npm run push
   ```

4. **Open the Apps Script editor in your browser**

   ```bash
   npm run open
   ```

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

### Required environment variables

Add the following variables to your `.env` (or export them in your CI/CD
environment):

```bash
# .env.example
GOOGLE_APPLICATION_CREDENTIALS="./config/google-sheets-credentials.json"
SHEETS_SPREADSHEET_ID="1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890"
```

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

environment variables required.
## Configuration

All secrets and runtime options are now resolved via a **single** helper:

```ts
import { getConfig } from './src/config';

const apiKey = getConfig('OPENAI_API_KEY');
```

The helper transparently looks up the key in:

1. `process.env` (Node/Jest)
2. `PropertiesService.getScriptProperties()` (Apps Script)

and throws a descriptive error when a *required* value is missing.

### Required keys

| Key | Purpose | Notes |
|-----|---------|-------|
| `OPENAI_API_KEY` | Authentication for OpenAI LLM calls | **Required** when using the OpenAI provider |
| `SHEETS_SPREADSHEET_ID` | Target spreadsheet id for captured knowledge | e.g. `1AbCdEf...` |
| `GOOGLE_CHAT_ACCESS_TOKEN` | OAuth token for Google Chat API *when running tests locally* | Not required in Apps Script (ScriptApp token is used) |

### Optional keys

| Key | Purpose | Default |
|-----|---------|---------|
| `OPENAI_ENDPOINT` | Override the HTTPS endpoint for OpenAI | `https://api.openai.com/v1/chat/completions` |
| `OPENAI_MODEL_ID` | Default model id | `gpt-4o-mini` |
| `AI_BOT_USER_ID` | Resource name for the AI bot user | — |
| `AI_BOT_DISPLAY_NAME` | Display name fallback for the AI bot | — |

> **Tip**: Any additional key accessed via `getConfig()` automatically inherits
> the same lookup semantics—no code changes required.


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



