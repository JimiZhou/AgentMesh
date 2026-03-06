# AgentMesh

Self-hosted agent coding mesh (gateway + runners) for Codex, Claude Code, Gemini CLI.

MVP goal: browser -> gateway -> runner -> persistent tmux session.

## Runtime Requirement

- Node.js 22+
- tmux 3+ on runner hosts

## Security Baseline

- Gateway password is stored as `scrypt` hash (`web.passwordHash`), not plaintext.
- First boot requires `AGENTMESH_BOOTSTRAP_PASSWORD` (unless `passwordHash` is already present in `gateway/data/config.json`).
- `/setup` TOTP enrollment now requires an authenticated session and CSRF token.
- Runner and terminal WS tokens are no longer sent via URL query by default.
- Runtime secrets are kept in local data files and should not be committed.

## Quick Start (Secure)

1. Start gateway with bootstrap password:
   `AGENTMESH_BOOTSTRAP_PASSWORD='replace-with-strong-password' npm --prefix gateway run dev`
2. Log in via web UI, then open `/setup` to bind TOTP.
3. Issue enroll code from gateway UI/API.
4. Start runner with enroll code:
   `AGENTMESH_ENROLL_CODE='<enroll-code>' npm --prefix runner run dev`

## Tool Support

- Runner now auto-detects local CLI availability for `codex`, `claude`, and `gemini`.
- Runner session backend is tmux-first to avoid PTY runtime incompatibilities on some hosts.
- Gemini resolution order: `AGENTMESH_GEMINI_CMD` -> `gemini` -> `npx -y @google/gemini-cli`.
- Gateway enforces runner-reported tool capabilities when creating/starting sessions.
- UI tool selector is driven by runner capabilities (priority: `codex`, `claude`, `gemini`).
- Runner capability payload includes per-tool details (`command/source/available/reason`) for diagnostics.

Environment overrides (runner):

- Force enable/disable tools:
  - `AGENTMESH_TOOL_CODEX=1|0`
  - `AGENTMESH_TOOL_CLAUDE=1|0`
  - `AGENTMESH_TOOL_GEMINI=1|0`
- Override executable command names:
  - `AGENTMESH_CODEX_CMD`
  - `AGENTMESH_CLAUDE_CMD`
  - `AGENTMESH_GEMINI_CMD`

## Repository Hygiene

- Tracked examples:
  - `gateway/data/config.example.json`
  - `runner/data/identity.example.json`
- Local runtime files (gitignored):
  - `gateway/data/config.json`
  - `gateway/data/state.json`
  - `runner/data/identity.json`

## Tests

- Build both services then run:
  - `node --test tests/*.test.mjs`
