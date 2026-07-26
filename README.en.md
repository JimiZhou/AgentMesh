# AgentMesh

> 中文版：[切换到 README.md](README.md)

**Run Codex, Claude Agent, and Gemini on any machine you own — from your browser, re-rendered as a native ACP session stream.**

AgentMesh brings powerful local AI coding agents into the browser. Deploy a lightweight gateway server, then connect any number of runner machines. Each runner acts as a local ACP client for the agents on that machine, converting `session/update`, tool calls, command output, and permission requests into structured events that the web UI re-renders into a mobile-friendly PWA experience. No SSH, no VNC.

```
Browser ──HTTPS──▶ Gateway ──WebSocket──▶ Runner (your Mac/Linux/server)
                                              └─▶ ACP agent (Codex / Claude / Gemini)
```

---

## ✨ Features

- **ACP-native session stream** — messages, plans, tool calls, command output, and permission requests are all transported as structured events
- **Mobile-first re-rendering** — no more squeezing a desktop TUI onto a phone screen; the PWA experience stays stable
- **Outbound-only runners** — runners dial out to the gateway over WebSocket, so no inbound ports are needed; works behind NAT, firewalls, and corporate networks
- **Multi-runner support** — connect any number of machines and switch between them in the web UI
- **Secure by default** — password + TOTP (Google Authenticator) two-factor login, scrypt password hashing, per-session terminal tokens, CSRF protection
- **Automatic tool discovery** — runners report available ACP agents; `codex`, `claude`, and `gemini` are supported out of the box
- **One-command enrollment** — register a new machine as a runner with a single `npx` command

---

## 🚀 Deploy the Gateway

### Option 1 — Docker (recommended for self-hosting)

```bash
git clone https://github.com/JimiZhou/AgentMesh.git
cd AgentMesh
AGENTMESH_BOOTSTRAP_PASSWORD='your-strong-password' docker compose up -d
```

Then open `http://localhost:8787`.

> After first startup the password is hashed and persisted, so you can drop the environment variable afterwards.
> For production, put a reverse proxy (nginx, Caddy, Cloudflare Tunnel, …) in front to terminate HTTPS.

```bash
# Manual build & run
docker build -t agentmesh-gateway ./gateway
docker run -d \
  -p 8787:8787 \
  -v "$PWD/gateway/data:/app/data" \
  -e AGENTMESH_BOOTSTRAP_PASSWORD='your-strong-password' \
  --name agentmesh-gateway \
  --restart unless-stopped \
  agentmesh-gateway
```

### Option 2 — Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/JimiZhou/AgentMesh)

1. Click **Deploy on Railway**
2. Set the `AGENTMESH_BOOTSTRAP_PASSWORD` environment variable
3. Copy the public URL Railway assigns and paste it into Gateway Settings → Public URLs

### Option 3 — Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/JimiZhou/AgentMesh)

1. Click **Deploy to Render**, follow the wizard, and fill in `AGENTMESH_BOOTSTRAP_PASSWORD`
2. Render automatically mounts a 1 GB persistent disk at `/app/data`

### Option 4 — Bare Node.js

Requires **Node.js 22+**.

```bash
git clone https://github.com/JimiZhou/AgentMesh.git
cd AgentMesh
npm --prefix gateway install
npm --prefix gateway run build

AGENTMESH_BOOTSTRAP_PASSWORD='your-strong-password' npm --prefix gateway run start
```

---

## ⚡ Connect a Runner

Requires **Node.js 22+** and at least one usable ACP agent. Supported out of the box:

- `codex-acp`, or `npx -y @zed-industries/codex-acp`
- `claude-agent-acp`, or `npx -y @zed-industries/claude-agent-acp`
- `gemini --experimental-acp`, or `npx -y @google/gemini-cli --experimental-acp`

### Step 1 — Generate an enrollment code

Log into the gateway web UI → click a runner (or create one) → **Generate enrollment code**.
The code embeds the gateway URL and a one-time token valid for 10 minutes.

### Step 2 — Enroll with npx (no global install)

```bash
npx agentmesh-runner --gateway https://your-gateway.example.com --enroll eyJ...your-code...
```

Done. The runner registers itself, stores its identity credentials, and keeps a persistent connection. It reconnects automatically after restarts — no re-enrollment needed.

### Reconnect after a restart (already enrolled)

```bash
npx agentmesh-runner --gateway https://your-gateway.example.com
```

### Optional flags

| Flag | Environment variable | Default | Description |
|---|---|---|---|
| `--gateway <url>` | `AGENTMESH_GATEWAY_HTTP` | `http://127.0.0.1:8787` | Gateway HTTP address |
| `--enroll <code>` | `AGENTMESH_ENROLL_CODE` | — | One-time enrollment code |
| `--name <name>` | `AGENTMESH_RUNNER_NAME` | hostname | Runner display name |
| `--debug` | `AGENTMESH_RUNNER_DEBUG=1` | off | Verbose logging |

### Tool environment variables (runner side)

```bash
# Force-enable or disable a tool
AGENTMESH_TOOL_CODEX=1   # or 0
AGENTMESH_TOOL_CLAUDE=1
AGENTMESH_TOOL_GEMINI=1

# Override the executable name/path
AGENTMESH_CODEX_CMD=my-codex
AGENTMESH_CLAUDE_CMD=/usr/local/bin/claude
AGENTMESH_GEMINI_CMD=gemini
```

---

## 🔒 Security

- Passwords are stored as `scrypt` hashes — plaintext never touches disk
- TOTP two-factor authentication (Google Authenticator), configurable under **Settings → TOTP**
- Every terminal connection requires a one-time authorization token bound to the login session
- All mutating APIs are CSRF-protected
- Runner tokens are long-lived credentials scoped to a single runner identity

> **Important:** run behind HTTPS/WSS in production. When using a reverse proxy, set `AGENTMESH_TRUST_PROXY=1` so real client IPs and protocols are detected correctly.

---

## 🛠️ Tool support

| Tool | Auto-detected | How |
|---|---|---|
| Codex | ✅ | Prefers `codex-acp`, falls back to `npx -y @zed-industries/codex-acp` |
| Claude Agent | ✅ | Prefers `claude-agent-acp`, falls back to `npx -y @zed-industries/claude-agent-acp` |
| Gemini CLI | ✅ | Prefers `gemini --experimental-acp`, falls back to `npx -y @google/gemini-cli --experimental-acp` |

Runners report their discovered ACP agent capabilities on connect; the web UI only shows tools that are actually available on the selected runner.

---

## 📦 Repository layout

```
AgentMesh/
├── gateway/        # Fastify HTTP/WS server + web console
├── runner/         # Node.js runner daemon (npm package: agentmesh-runner)
├── tests/          # Integration tests
├── docker-compose.yml
├── railway.json
└── render.yaml
```

---

## 🧪 Development

```bash
# Start the gateway in dev mode (hot reload)
AGENTMESH_BOOTSTRAP_PASSWORD=dev npm --prefix gateway run dev

# Start a runner in dev mode
AGENTMESH_ENROLL_CODE='<enrollment code>' npm --prefix runner run dev

# Run tests (build first)
npm --prefix gateway run build && npm --prefix runner run build
node --test tests/*.test.mjs
```

---

## License

MIT
