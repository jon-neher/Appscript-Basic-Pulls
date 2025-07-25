# AppScript Chat Knowledge Bot

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

## Configuration Options

All configuration now lives in a single file: `src/Config.gs`. Edit the
constants in that file and push with `clasp push`—no JSON, YAML, or
environment variables required.

| Key | Type | Required | Constraints |
|-----|------|----------|-------------|
| DOCUMENTATION_BASE_URL | string (URL) | ✅ | Must start with `http://` or `https://`. |
| PAGE_ANALYSIS_LIMIT | integer | ✅ | 1 ≤ value ≤ 1000 |
| LLM_PROVIDER | `'openai' \| 'gemini'` | ✅ | — |
| OPENAI_API_KEY | string | conditional | Required when `LLM_PROVIDER === 'openai'`. |
| GEMINI_API_KEY | string | conditional | Required when `LLM_PROVIDER === 'gemini'`. |
| OPENAI_ENDPOINT | `'chat' \| 'responses'` | optional | Defaults to `'chat'`. `'responses'` routes all requests to the OpenAI **Responses** v1 endpoint instead of Chat Completions. |
| OPENAI_MODEL_ID | string | optional | Defaults to `'gpt-3.5-turbo'`. |
| GEMINI_MODEL_ID | string | optional | Defaults to `'gemini-pro'`. |
| RESPONSES_BETA | boolean | optional | Include `OpenAI-Beta: responses=v1` header when using responses endpoint. Defaults to `false`. |

Validation runs at **load-time**—a bad value throws an Error before the bot can
process any Chat events. Because configuration is checked synchronously there
is no need for network reachability tests or external file parsing.


### Quick-start: Switch to the OpenAI *Responses* API

If you want every LLM call to hit the brand-new [Responses v1 endpoint](https://platform.openai.com/docs/api-reference/responses/create) simply tweak two keys in `src/Config.gs`:

```js
const CONFIG = {
  // …existing required keys…

  OPENAI_ENDPOINT: 'responses', // route traffic to /v1/responses
  RESPONSES_BETA: true,        // add the required beta header (only while the endpoint is in beta)
};
```

No code changes are necessary—`sendThreadForUnderstanding()` will automatically
convert the chat history into a single prompt string and call the new
endpoint.


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



