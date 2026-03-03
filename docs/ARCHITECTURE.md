# AgentMesh Architecture (Draft)

## Components
Gateway:
- HTTP API for browser + CLI
- WebSocket endpoints for runner control and session log streaming
- State store (start with JSON files; upgrade to SQLite)

Runner:
- Long-lived daemon
- Maintains an outbound WS connection to Gateway
- Spawns/attaches tool sessions (tmux)
- Streams stdout/stderr + accepts stdin

## Control Flow
Runner boots -> connects -> advertises capabilities.
User creates a project -> chooses runner.
Gateway asks runner to start a session for a tool.
Runner creates tmux session/window, attaches tool, streams output.
Browser sends input -> gateway -> runner -> tmux send-keys.

## Capability Model
runner.capabilities.tools = ["codex", "claude", "gemini"]
runner.capabilities.features = ["tmux", "git", "docker?"]

## Session Model
session.tool: codex|claude|gemini
session.projectPath: string
session.runnerId: string
session.tmux: { sessionName, window, pane }

## Extensibility
Add new tools by implementing a runner adapter:
- start()
- stop()
- sendInput()
- tailLogs()

## Failure Modes
- Runner disconnect: gateway keeps session metadata; runner reconnect resumes.
- Tool exits: runner reports ended state; gateway shows logs.
