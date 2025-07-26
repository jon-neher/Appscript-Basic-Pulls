# Deployment guide – GitHub Actions CI (MVP)

This document shows **the quickest path to production** using the pre-built
`CI / Test → Clasp push → Deploy` workflow that lives in
`.github/workflows/ci.yml`.

If you prefer a **click-by-click walkthrough** (including manual local
deployments) have a look at `docs/deployment.md`.  That original guide is still
valid, but the steps below are **all you need** for a fully automated
continuous deployment setup.

---

## 1  Prerequisites

- A fork or clone of this repository with the default branch named **`main`**.
- **Google Apps Script project** already created and linked to the code base
  (see `docs/deployment.md` §3.1 for one-time linking instructions).
- A **Google Cloud OAuth client** (`Web application` type) – the client id,
  secret and refresh token will be used by `clasp` in CI.
- A **service-account key JSON** that has *Editor* access to the target Google
  Sheets spreadsheet (required only when you run the Sheets capture pipeline
  from `npm test` in CI).

### 1.1  Required GitHub secrets

| Name | Why it’s needed |
|------|-----------------|
| `CLASP_CLIENT_ID` | OAuth client id for the Apps Script API |
| `CLASP_CLIENT_SECRET` | OAuth client secret (pairs with the id above) |
| `CLASP_REFRESH_TOKEN` | Long-lived refresh token generated via `clasp login --no-localhost` |
| `SCRIPT_ID` | Script ID of the linked Apps Script project (found under **Project settings → Script ID**) |

Optional – only needed when the build (or tests) require them:

| Name | When to add |
|------|-------------|
| `OPENAI_API_KEY` | Bot calls OpenAI during the Jest integration test |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to an uploaded service-account key JSON used by the Sheets API |

> **Tip**: Secrets are added under **Repository → Settings → Secrets and
> variables → Actions**.  Keep the names *exactly* as shown above – the
> workflow reads them verbatim.

---

## 2  Workflow overview

The file `.github/workflows/ci.yml` defines **two jobs**:

1. **test** – installs dependencies and runs the full Jest suite.  Runs on *all*
   pushes and pull-requests.
2. **deploy** – builds the TypeScript bundle, configures `clasp` using the
   secret credentials, pushes the code to Apps Script and creates/updates the
   _production_ deployment.

Key characteristics:

- The **deploy** job only runs when the commit is on the `main` branch:  
  ```yaml
  if: github.ref == 'refs/heads/main'
  ```
- A **concurrency group** (`clasp-deploy`) prevents multiple deployments from
  running at the same time, keeping well below Google’s 20 deploys/min quota.
- Test failures block deployment – merges must be **green** before they reach
  production.

---

## 3  First-time setup

1. Push a branch that adds the four secrets above.
2. Open a pull request – the **test** job will run and should pass.
3. Merge the PR into `main`.  On merge the **deploy** job kicks off:
   - Builds the project (`npm ci` → `npm run build`).
   - Writes the temporary `~/.clasprc.json` with the OAuth credentials.
   - Generates a `.clasp.json` that contains your `SCRIPT_ID`.
   - Executes `clasp push --rootDir dist` followed by `clasp deploy`.
4. When the workflow finishes you’ll see a **Head deployment** in the Apps
   Script UI and the bot is instantly reachable in Google Chat.

---

## 4  How to roll back

Apps Script keeps every deployment you ever create.  To roll back:

1. Open the Apps Script editor.
2. Click **Deploy → Manage deployments**.
3. Locate an older deployment in the list and click **Edit → Update**.

Alternatively, revert/rollback the bad commit in Git and push to `main`.  CI
will build a new version that overwrites the previous (buggy) head deployment.

---

## 5  Troubleshooting CI failures

| Symptom | Likely cause | Fix |
|---------|--------------|------|
| `401 Unauthorized` in `clasp push` step | Incorrect or expired `CLASP_REFRESH_TOKEN` | Run `clasp login --no-localhost` again and update the secret |
| `Error: Script ID is invalid` | Copy/paste error in the `SCRIPT_ID` secret | Copy the id from **Project Settings → Script ID** |
| Jest test fails with `OPENAI_API_KEY is required` | Key not added to secrets | Add `OPENAI_API_KEY` or skip the failing test suite |

---

## 6  Manual deploy from a laptop (optional)

The CI workflow is usually enough, but you can run the *exact* same steps
locally:

```bash
npm ci
npm test
npm run build
npx clasp push --rootDir dist --force
npx clasp deploy --description "Manual deploy $(git rev-parse --short HEAD)"
```

The push command updates the _head_ deployment; `clasp deploy` creates a new
versioned deployment so that rollbacks remain possible.
