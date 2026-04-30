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
- Choose between the visible local cockpit and a reversible Symphony-style blackbox view.
- Load model, sandbox, max-turn, prompt, and checklist policy from `WORKFLOW.symphony.md`.
- Run `codex app-server` in a per-task workspace and start a real Codex thread/turn.
- Persist app-server thread, turn, item, approval, tool, and output events so the run is inspectable.
- Promote completed runs into a visible review gate with the final answer and reviewable artifacts.
- Show a per-task workspace diff summary and a runtime Doctor panel.
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

## Workflow Profiles

`WORKFLOW.symphony.md` is the repo-owned workflow contract. It follows Symphony's YAML
front-matter plus Markdown prompt pattern, and currently defines two profiles:

- `local-cockpit`: the default operator cockpit with detailed checklist, event stream, review
  material, and workspace diff.
- `symphony-blackbox`: a closer Symphony daemon experience. It hides low-level Codex events in the
  UI and surfaces only lifecycle state, Human Review handoff, tracker sync, and workspace proof.

You can choose the profile when creating or importing a task. Existing tasks can be switched with
the detail-panel button without changing the underlying event store.

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
- On approval, external writeback is intentionally non-destructive: Codex Manager comments on the
  issue via `gh issue comment` or `glab issue note`. It does not close external issues yet; failed
  writeback marks the task as `sync_drift`.

## Architecture

The implementation follows Symphony's useful boundaries but changes the product center:

- `TaskStore`: persistent canonical tasks, checklist items, and event stream.
- `TaskSourceAdapter`: GitHub/GitLab import and future bidirectional sync boundary.
- `WorkflowLoader`: `WORKFLOW.symphony.md` parsing, profile selection, and prompt rendering.
- `ExternalSync`: non-destructive GitHub/GitLab writeback on review approval.
- `AppServerProtocolClient`: newline-delimited JSON-RPC client for `codex app-server`.
- `CodexRunner`: starts a Codex thread/turn, handles approval requests, and normalizes app-server events.
- Review gate: extracts the final assistant message and local workspace artifacts from app-server events.
- `WorkspaceManager`: per-task workspace resolution with an ASCII managed root, ready for remote worker support later.
- React console: three-panel operator cockpit with review-first task ordering. The left rail owns
  status filtering, so the task list does not duplicate the same queue counters.

## Symphony Alignment

The original Symphony service is a long-running scheduler around Linear: it polls active tracker
states, prepares a per-issue workspace, starts Codex app-server, and lets the agent move the tracker
to workflow states such as `Human Review`, `Rework`, `Merging`, or `Done`. It intentionally keeps
the rich business workflow in `WORKFLOW.md` and agent tools rather than in the orchestrator.

Codex Manager keeps several differences intentionally:

- Local-first task store: SQLite is the canonical local queue so you can create and review tasks
  without Linear.
- Browser review gate: final answers, local artifacts, checklist state, and review actions are
  visible in one place instead of relying only on tracker comments.
- GitHub/GitLab import boundary: external issues are mirrored into local tasks; full write-back is
  kept behind the sync boundary.

The parts that should remain aligned with Symphony are:

- Codex execution uses app-server threads and turns, not shell-only black-box runs.
- Continuations reuse the existing Codex thread and send only continuation guidance.
- A successful Codex turn can stop at a handoff state such as human review, not only final done.
- Completion semantics must distinguish "needs review", "local archive complete", and external
  tracker sync.

The app-server thread is persisted by Codex under `~/.codex/sessions/...` and its thread/turn ids are
stored on the task. It does not open a new visible Codex Desktop chat window automatically; the
manager records the detailed event stream locally and keeps the session identifiers for future resume
and steering features.

## Tests

```bash
npm test
npm run build
```
