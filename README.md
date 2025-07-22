# AppScript Chat Knowledge Bot

This repository contains the source code and configuration for a Google Apps Script powered Google Chat bot that helps teams surface and manage knowledge right inside Chat.

The project uses the [Google clasp CLI](https://github.com/google/clasp) for local development and deployment.

## Prerequisites

- Node.js ≥ 18
- Google Apps Script access with permission to create a project
- Google Cloud project with Chat API enabled (for production deployments)
- `npm install -g @google/clasp` (or use the local version via `npm run`)

## Getting started

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

- `src/` – All Apps Script `.js/gs/ts` files and the `appsscript.json` manifest.
- `docs/` – Additional project documentation.

## Manifest highlights (`src/appsscript.json`)

- Uses the modern **V8** runtime.
- Declares the OAuth scope `https://www.googleapis.com/auth/chat.bot` required for Chat bots.
- Configured as a **web app** so the published URL can be added to Google Chat.

## License

This project is licensed under the MIT License – see the [LICENSE](LICENSE) file for details.
