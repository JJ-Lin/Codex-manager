# Codex Manager

Codex Manager is a local, Symphony-inspired control plane for managing Codex work as observable
tasks instead of black-box runs.

It keeps a local canonical task model, then syncs external sources such as GitHub and GitLab into
that model. The UI is optimized for the operator loop: see what is running, what needs human
review, where a task is in its checklist, and which Codex events were produced while it ran.

## What It Does

- Create local Codex tasks from the browser.
- Import GitHub and GitLab issue URLs into local tasks.
- Detect the local Git identities configured for GitHub and GitLab.
- Track a structured checklist for each task.
- Run `codex app-server` in a per-task workspace and start a real Codex thread/turn.
- Persist app-server thread, turn, item, approval, tool, and output events so the run is inspectable.
- Promote completed runs into a visible review gate with the final answer and reviewable artifacts.
- Approve, request changes, block, stop, or continue tasks from the UI.

## Run Locally

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The API listens on:

```text
http://127.0.0.1:8787
```

Persistent local state is stored under:

```text
.codex-manager/
```

Managed task workspaces default to an ASCII path to avoid Codex websocket metadata issues when the
project directory itself contains non-ASCII characters:

```text
~/.codex-manager/workspaces/
```

The default model is `gpt-5.5`. Override the workspace root or runner model with:

```bash
CODEX_MANAGER_WORKSPACE_ROOT=/tmp/codex-manager-workspaces CODEX_MANAGER_MODEL=gpt-5.4 npm start
```

## Production Build

```bash
npm run build
npm start
```

Then open:

```text
http://127.0.0.1:8787
```

## GitHub and GitLab Accounts

Codex Manager uses your existing machine-local Git identity setup. On this machine that normally
means:

- GitHub commits use `~/.config/git/identity-github`
- GitLab commits use `~/.config/git/identity-gitlab`

Issue detail enrichment is best-effort:

- GitHub issue import uses `gh issue view` when `gh` is installed and authenticated.
- GitLab issue import uses `glab issue view` when `glab` is installed and authenticated.
- If either CLI is missing, the issue URL is still imported as a local task with a source binding.

## Architecture

The implementation follows Symphony's useful boundaries but changes the product center:

- `TaskStore`: persistent canonical tasks, checklist items, and event stream.
- `TaskSourceAdapter`: GitHub/GitLab import and future bidirectional sync boundary.
- `AppServerProtocolClient`: newline-delimited JSON-RPC client for `codex app-server`.
- `CodexRunner`: starts a Codex thread/turn, handles approval requests, and normalizes app-server events.
- Review gate: extracts the final assistant message and local workspace artifacts from app-server events.
- `WorkspaceManager`: per-task workspace resolution with an ASCII managed root, ready for remote worker support later.
- React console: three-panel operator cockpit with review-first task ordering.

Unlike the Symphony reference implementation, checklists, human review state, and Codex events are
not only stored in an external tracker comment. They are first-class local records.

The app-server thread is persisted by Codex under `~/.codex/sessions/...` and its thread/turn ids are
stored on the task. It does not open a new visible Codex Desktop chat window automatically; the
manager records the detailed event stream locally and keeps the session identifiers for future resume
and steering features.

## Tests

```bash
npm test
npm run build
```
