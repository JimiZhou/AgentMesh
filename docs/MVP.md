# AgentMesh MVP (Prototype 0)

## Goal
A self-hosted **gateway + runners** system for AI agent coding CLIs (Codex / Claude Code / Gemini CLI today, extensible tomorrow), with **persistent project sessions** that survive disconnects.

## Core Concepts
- **Gateway**: Web UI + API server. Owns auth, project registry, session registry, routing.
- **Runner**: A daemon that connects to the gateway (preferably via Tailscale). It advertises capabilities (installed tools), can host multiple project sessions.
- **Project**: A working directory (git repo) with persistent storage.
- **Session**: A long-lived tool instance bound to a project (e.g., tmux window/pane running `codex`), with logs streamed back.

## Non-goals (first prototype)
- Multi-user RBAC
- Billing / quotas
- Multi-runner scheduling heuristics
- Web-based full IDE (we can start with terminal + file tree)

## MVP User Story
From browser:
Create project -> attach runner -> start Codex session -> see terminal output -> disconnect -> reconnect -> continue same session.

## Minimal API
- POST /api/runners/register (runner initiates, gets token)
- WS /ws/runner (runner <-> gateway stream)
- POST /api/projects (create metadata)
- POST /api/sessions (create session on runner)
- GET /api/sessions/:id (status)
- WS /ws/sessions/:id/logs (stream logs)
- POST /api/sessions/:id/input (send stdin)

## Data to Persist
- Gateway: runners.json, projects.json, sessions.json (or sqlite later)
- Runner: per-session state (tmux session name, cwd, tool type, createdAt)

## Security Baseline
- Gateway binds to tailnet only.
- Runner authenticates with a shared token; later rotate.
- Per-session sandboxing later.
