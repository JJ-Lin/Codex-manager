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
- Run `codex exec --json` in a per-task workspace.
- Persist Codex JSONL events so the run is inspectable after the process exits.
- Promote completed runs into `需要人工复核` when human review is required.
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
- `CodexRunner`: `codex exec --json` subprocess wrapper and event normalizer.
- `WorkspaceManager`: per-task workspace resolution, ready for remote worker support later.
- React console: three-panel operator cockpit with review-first task ordering.

Unlike the Symphony reference implementation, checklists, human review state, and Codex events are
not only stored in an external tracker comment. They are first-class local records.

## Tests

```bash
npm test
npm run build
```
