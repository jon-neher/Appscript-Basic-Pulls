# Deployment Guide

This document describes **two** ways to ship the _AppScript-Chat-Knowledge_ bot to Google Apps Script so that it can be used as a Google Chat app:

1. **Manual MVP deployment** – copy-and-paste friendly commands that work on any machine.
2. **Semi-automated deployment script** (`scripts/deploy.sh`) – a thin wrapper around the same commands with a few safety checks.

> The manual path is the **source of truth**. The bash script is optional and mirrors the exact steps below.

---

## 1  Prerequisites

- **Google account** with permission to create Apps Script projects **and** access the target Google Cloud project.
- **Node.js ≥ 18** (tested with v22) and **npm ≥ 9**.
- **clasp CLI ≥ 3.0** – either globally (`npm i -g @google/clasp`) or the project-local binary (`npx clasp`).
- **Git** – only required if you want to clone the repository.
- **GCP service account key** (JSON) _or_ regular OAuth login for clasp.
- **OpenAI / Gemini API keys** if the bot calls external LLMs (configured inside `src/config`).

Environment variables used during deployment:

| Variable | Purpose | Required |
|----------|---------|----------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a service-account key used by `clasp` in CI. | No (you can log in interactively instead) |
| `CHAT_GCP_PROJECT_NUMBER` | 12-digit GCP project number that will own the Chat API. | Yes |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | Forwarded into the bot config if you use those providers. | Conditional |

---

## 2  Manual MVP deployment (local workstation)

### 2.1  Clone & install

```bash
git clone https://github.com/jon-neher/AppScript-Chat-Knowledge.git
cd AppScript-Chat-Knowledge
npm install
```

### 2.2  Authenticate clasp once per workstation

```bash
# Opens a browser window – follow the Google OAuth flow.
npm run login           # equivalent to: npx clasp login --no-localhost
# Creates ~/.clasprc.json containing your refresh token.
```

> **Tip**: In CI you would instead export `GOOGLE_APPLICATION_CREDENTIALS` and run
> `clasp login --creds $GOOGLE_APPLICATION_CREDENTIALS`.

### 2.3  Build the Apps Script bundle

```bash
npm run build           # esbuild bundles TypeScript -> dist/bundle.gs
```

The build step executes two node scripts:

1. `build/esbuild.config.js` – bundles `src/server/index.ts` → `dist/bundle.gs`.
2. `build/copyManifest.mjs` – copies `src/appsscript.json` to `dist/` and rewrites:

```json
{
  "rootDir": "dist",
  "filePushOrder": ["bundle.gs", "appsscript.json"]
}
```

### 2.4  Push the code

```bash
# Uploads **only** the `dist/` directory to the linked Apps Script project.
clasp push --rootDir dist
```

If this is the first time you push from your account clasp prompts to create a new version of the script. Subsequent pushes overwrite the _head_ deployment.

### 2.5  Create (or update) a _head_ deployment in the Apps Script UI

1. In the Apps Script editor click **Deploy → Test deployments**.
2. Select **Web app** as the deployment type.
3. Accept the default settings (`Execute as: User deploying`, `Access: Anyone`).
4. Click **Deploy** and copy the **Head deployment ID** – you will paste it into the Chat API config in the next section.

> You only need **one** head deployment. Each subsequent `clasp push` automatically updates it.

---

## 3  Google Chat API configuration

The Chat API lives in **Google Cloud**, not Apps Script. You must link the two projects and then tell Chat which Apps Script deployment to call.

### 3.1  Link your Apps Script project to a dedicated Cloud project

1. Open the Apps Script editor.
2. Click **Project Settings → Google Cloud Platform (GCP) project → Change project**.
3. Enter your **12-digit** project number (`$CHAT_GCP_PROJECT_NUMBER`) and click **Set project**.

> This step _cannot_ be done with clasp – it is a one-time manual action.

### 3.2  Enable & configure the Chat API

1. In the GCP console switch to the linked project.
2. Navigate to **APIs & Services → Library** and enable **Google Chat API**.
3. Under **Google Chat API → Configuration** choose **Apps Script** integration.
4. Paste the **Head deployment ID** you copied earlier and click **Save**.
5. Optional: add an **avatar**, display name, and description.

### 3.3  Grant yourself permission to add the Chat app to spaces

The easiest path during MVP is to **turn on Google Chat API in test mode**:

- Open **APIs & Services → OAuth Consent Screen**.
- Choose _Internal_ (if you are in a Workspace domain) or leave as _External_ + **Testing mode**.
- Add your email as a **test user**.

---

## 4  Verifying the bot

1. In Google Chat open **Browse apps**.
2. Search for the display name you configured and click **Add**.
3. Send a private DM with `/ping` (or any slash command you implemented).
4. If the bot responds you are done – congrats 🎉.

---

## 5  Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|------|
| `clasp push` prints `401 Unauthorized` | Missing or expired OAuth token. | Run `npm run login` again or set `GOOGLE_APPLICATION_CREDENTIALS`. |
| Bot replies `401 PERMISSION_DENIED` | Chat API not enabled _or_ wrong deployment ID. | Enable the API, double-check the **Head deployment ID** under _Configuration → Apps Script_. |
| `npm run build` fails with `node: bad option --watch` | Node < 18. | Upgrade Node or use `nvm install 22`.
| Bot returns `Error: OPENAI_API_KEY is required` | Missing LLM credentials in `src/config`. | Edit `src/config` and push again. |
| The bot does not appear in **Browse apps** | You forgot to add yourself as a test user or the app is set to **In production** and requires admin approval. | Add your email under **OAuth consent screen → Test users** or ask an admin to allow the app domain-wide. |

---

## 6  CI / CD notes (optional)

`clasp` supports non-interactive service-account auth:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=$PWD/sa-key.json
clasp login --creds "$GOOGLE_APPLICATION_CREDENTIALS"
npm run build
clasp push --rootDir dist
```

You can plug the three commands above into GitHub Actions after adding the service-account key as a secret.

---

## 7  Quick reference commands

```bash
# One-liner alias for local iteration
npm run deploy      # = build + clasp push --rootDir dist

# Frequent clasp helpers
clasp pull          # download the remote code (rarely needed – the repo is source-of-truth)
clasp versions      # list script versions
clasp deployments   # list web-app deployments
```

---

## Appendix A – Required OAuth scopes

The manifest already includes the only scope needed for a Google Chat bot:

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/chat.bot"
]
```

No additional scopes are required unless you extend the bot to call other Google APIs.
