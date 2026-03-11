# AgentMesh

**Run Codex, Claude Code, and Gemini CLI from your browser — on any machine you own.**

AgentMesh bridges the gap between powerful local AI coding agents and the convenience of a web interface. Deploy a lightweight gateway server, then connect any number of runner machines to it. Each runner exposes its local tools (Codex, Claude, Gemini) through a full-featured browser terminal with real PTY passthrough — no SSH, no VNC, no compromise on UX.

```
Browser ──HTTPS──▶ Gateway ──WebSocket──▶ Runner (your Mac/Linux/server)
                                              └─▶ Codex / Claude / Gemini TUI
```

---

## ✨ Features

- **Full PTY passthrough** — ANSI colors, cursor keys, TUI apps (Codex full-screen UI works as-is)
- **Outbound-only runner connections** — runners dial out to the gateway over WebSocket; no inbound ports needed, works behind NAT/firewalls/VPNs
- **Multi-runner fleet** — connect as many machines as you want, pick the runner from the web UI
- **Secure by default** — password + TOTP (Google Authenticator) login, scrypt-hashed credentials, per-session terminal tokens, CSRF protection
- **Tool auto-detection** — runner automatically reports which of `codex`, `claude`, `gemini` are installed
- **One-line runner join** — enroll new machines with a single `npx` command

---

## 🚀 Deploy the Gateway

### Option 1 — Docker (recommended for self-hosting)

```bash
# Clone and start with a strong bootstrap password
git clone https://github.com/JimiZhou/AgentMesh.git
cd AgentMesh
AGENTMESH_BOOTSTRAP_PASSWORD='your-strong-password' docker compose up -d
```

Gateway will be available at `http://localhost:8787`.

> On first boot the password is hashed and persisted — you can remove the env var afterwards.  
> Put a reverse proxy (nginx, Caddy, Cloudflare Tunnel…) in front for HTTPS.

```bash
# Build & run manually
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
2. Set the `AGENTMESH_BOOTSTRAP_PASSWORD` environment variable to a strong password
3. Copy the public URL Railway assigns, then set it as the gateway URL in Settings → Public URLs

### Option 3 — Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/JimiZhou/AgentMesh)

1. Click **Deploy to Render**, follow the wizard, set `AGENTMESH_BOOTSTRAP_PASSWORD`
2. Render attaches a 1 GB persistent disk at `/app/data` for config/state

### Option 4 — Bare Node.js

Requirements: **Node.js 22+**

```bash
git clone https://github.com/JimiZhou/AgentMesh.git
cd AgentMesh
npm --prefix gateway install
npm --prefix gateway run build

AGENTMESH_BOOTSTRAP_PASSWORD='your-strong-password' npm --prefix gateway run start
```

---

## ⚡ Connect a Runner

Requirements: **Node.js 22+**, **tmux 3+**, and at least one of: `codex`, `claude`, `gemini` in your `PATH`.

### Step 1 — Generate an enroll code

Log in to your gateway UI → click a runner (or add a new one) → **Generate Enroll Code**.  
The code encodes the gateway URL and a one-time token valid for 10 minutes.

### Step 2 — Join with npx (no install needed)

```bash
npx agentmesh-runner --gateway https://your-gateway.example.com --enroll eyJ...YOUR_CODE...
```

That's it. The runner will enroll, save its identity, and stay connected. On restart, it reconnects automatically — no need to re-enroll.

### Re-connecting after first enrollment

```bash
npx agentmesh-runner --gateway https://your-gateway.example.com
```

### Optional flags

| Flag | Env var | Default | Description |
|---|---|---|---|
| `--gateway <url>` | `AGENTMESH_GATEWAY_HTTP` | `http://127.0.0.1:8787` | Gateway HTTP URL |
| `--enroll <code>` | `AGENTMESH_ENROLL_CODE` | — | One-time enroll code |
| `--name <name>` | `AGENTMESH_RUNNER_NAME` | hostname | Runner display name |
| `--debug` | `AGENTMESH_RUNNER_DEBUG=1` | off | Verbose logging |

### Tool overrides (runner)

```bash
# Force-enable or disable specific tools
AGENTMESH_TOOL_CODEX=1  # or 0
AGENTMESH_TOOL_CLAUDE=1
AGENTMESH_TOOL_GEMINI=1

# Override the executable name/path
AGENTMESH_CODEX_CMD=my-codex
AGENTMESH_CLAUDE_CMD=/usr/local/bin/claude
AGENTMESH_GEMINI_CMD=gemini
```

---

## 🔒 Security

- Passwords stored as `scrypt` hashes — plaintext is never persisted
- TOTP (Google Authenticator) two-factor auth — configure under **Settings → TOTP**
- Per-session terminal tokens — terminal WebSocket requires a one-time grant tied to your login session
- CSRF protection on all write APIs
- Runner tokens are long-lived credentials scoped to a single runner identity

> **Important:** always run the gateway behind HTTPS in production. Runners communicate over WebSocket (wss://). The `AGENTMESH_TRUST_PROXY=1` flag enables correct IP/protocol detection when behind a reverse proxy.

---

## 🛠️ Tool Support

| Tool | Auto-detected | How |
|---|---|---|
| Codex | ✅ | Checks for `codex` in PATH (or `AGENTMESH_CODEX_CMD`) |
| Claude Code | ✅ | Checks for `claude` in PATH (or `AGENTMESH_CLAUDE_CMD`) |
| Gemini CLI | ✅ | `gemini` → `npx -y @google/gemini-cli` fallback |

The runner reports its discovered capabilities to the gateway on connect. The web UI only shows tools actually available on the selected runner.

---

## 📦 Repository Layout

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
# Start gateway in dev mode (hot-reload)
AGENTMESH_BOOTSTRAP_PASSWORD=dev npm --prefix gateway run dev

# Start runner in dev mode
AGENTMESH_ENROLL_CODE='<code>' npm --prefix runner run dev

# Run tests (build first)
npm --prefix gateway run build && npm --prefix runner run build
node --test tests/*.test.mjs
```

---

## License

MIT
