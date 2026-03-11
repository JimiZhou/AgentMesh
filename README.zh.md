# AgentMesh

**通过浏览器在任意你拥有的机器上运行 Codex、Claude Code 和 Gemini CLI。**

AgentMesh 把强大的本地 AI 编程 Agent 搬进了浏览器。部署一个轻量 Gateway 服务端，再把任意数量的 Runner 机器连接上来——每台 Runner 都通过完整的 PTY 透传把本地工具（Codex、Claude、Gemini）的全屏 TUI 暴露在浏览器里。无需 SSH，无需 VNC，体验 1:1。

```
浏览器 ──HTTPS──▶ Gateway ──WebSocket──▶ Runner（你的 Mac/Linux/服务器）
                                              └─▶ Codex / Claude / Gemini TUI
```

---

## ✨ 特性

- **完整 PTY 透传** — ANSI 色彩、光标键、全屏 TUI（Codex 全屏界面完整呈现）
- **Runner 出站连接** — Runner 主动拨号连接 Gateway（WebSocket），无需开放入站端口，NAT/防火墙/企业网均可用
- **多 Runner 支持** — 连接任意数量的机器，在 Web 界面按需切换
- **默认安全** — 密码 + TOTP（Google Authenticator）双因素登录、scrypt 哈希存储、会话级终端 Token、CSRF 防护
- **工具自动识别** — Runner 自动上报已安装的 `codex`、`claude`、`gemini`，UI 只展示实际可用的工具
- **一行命令接入** — 用 `npx` 一键将新机器注册为 Runner

---

## 🚀 部署 Gateway

### 方式一 — Docker（自建推荐）

```bash
git clone https://github.com/JimiZhou/AgentMesh.git
cd AgentMesh
AGENTMESH_BOOTSTRAP_PASSWORD='你的强密码' docker compose up -d
```

Gateway 启动后访问 `http://localhost:8787`。

> 首次启动后密码会哈希持久化，之后可以去掉该环境变量。  
> 生产环境建议在前面加反代（nginx、Caddy、Cloudflare Tunnel 等）来启用 HTTPS。

```bash
# 手动 build & run
docker build -t agentmesh-gateway ./gateway
docker run -d \
  -p 8787:8787 \
  -v "$PWD/gateway/data:/app/data" \
  -e AGENTMESH_BOOTSTRAP_PASSWORD='你的强密码' \
  --name agentmesh-gateway \
  --restart unless-stopped \
  agentmesh-gateway
```

### 方式二 — Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/JimiZhou/AgentMesh)

1. 点击 **Deploy on Railway**
2. 设置环境变量 `AGENTMESH_BOOTSTRAP_PASSWORD`
3. 复制 Railway 分配的公网 URL，在 Gateway 设置 → Public URLs 中填入

### 方式三 — Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/JimiZhou/AgentMesh)

1. 点击 **Deploy to Render**，按向导操作，填写 `AGENTMESH_BOOTSTRAP_PASSWORD`
2. Render 会自动挂载 1 GB 持久磁盘到 `/app/data`

### 方式四 — 裸 Node.js

依赖：**Node.js 22+**

```bash
git clone https://github.com/JimiZhou/AgentMesh.git
cd AgentMesh
npm --prefix gateway install
npm --prefix gateway run build

AGENTMESH_BOOTSTRAP_PASSWORD='你的强密码' npm --prefix gateway run start
```

---

## ⚡ 接入 Runner

依赖：**Node.js 22+**、**tmux 3+**，以及至少一个已安装并在 PATH 中的：`codex`、`claude`、`gemini`。

### 第一步 — 生成绑定码

登录 Gateway Web 界面 → 点击某个 Runner（或新建）→ **生成绑定码**。  
绑定码内含 Gateway URL 和一个有效期 10 分钟的一次性 Token。

### 第二步 — 用 npx 一键接入（无需全局安装）

```bash
npx agentmesh-runner --gateway https://your-gateway.example.com --enroll eyJ...你的绑定码...
```

完成。Runner 自动完成注册、保存身份凭证，并保持长连接。重启后自动重连，无需重新绑定。

### 重启后重连（已注册过）

```bash
npx agentmesh-runner --gateway https://your-gateway.example.com
```

### 可选参数

| 参数 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `--gateway <url>` | `AGENTMESH_GATEWAY_HTTP` | `http://127.0.0.1:8787` | Gateway HTTP 地址 |
| `--enroll <code>` | `AGENTMESH_ENROLL_CODE` | — | 一次性绑定码 |
| `--name <name>` | `AGENTMESH_RUNNER_NAME` | 主机名 | Runner 显示名称 |
| `--debug` | `AGENTMESH_RUNNER_DEBUG=1` | 关闭 | 详细日志 |

### 工具环境变量（Runner 侧）

```bash
# 强制开启或关闭某个工具
AGENTMESH_TOOL_CODEX=1   # 或 0
AGENTMESH_TOOL_CLAUDE=1
AGENTMESH_TOOL_GEMINI=1

# 覆盖可执行文件名/路径
AGENTMESH_CODEX_CMD=my-codex
AGENTMESH_CLAUDE_CMD=/usr/local/bin/claude
AGENTMESH_GEMINI_CMD=gemini
```

---

## 🔒 安全

- 密码以 `scrypt` 哈希存储，明文永不落盘
- TOTP 双因素认证（Google Authenticator），可在 **设置 → TOTP** 中配置
- 每个终端连接都需要一次性授权 Token，与登录态绑定
- 所有写 API 有 CSRF 保护
- Runner Token 是长期凭证，作用域限定于单台 Runner 身份

> **重要：** 生产环境必须在 HTTPS/WSS 下运行。使用反代时需设置 `AGENTMESH_TRUST_PROXY=1` 以正确识别真实 IP 和协议。

---

## 🛠️ 工具支持

| 工具 | 自动识别 | 方式 |
|---|---|---|
| Codex | ✅ | 检测 PATH 中 `codex`（或 `AGENTMESH_CODEX_CMD`） |
| Claude Code | ✅ | 检测 PATH 中 `claude`（或 `AGENTMESH_CLAUDE_CMD`） |
| Gemini CLI | ✅ | 优先 `gemini`，fallback `npx -y @google/gemini-cli` |

Runner 连接后自动上报已发现的工具能力，Web UI 只展示当前选中 Runner 上实际可用的工具。

---

## 📦 仓库结构

```
AgentMesh/
├── gateway/        # Fastify HTTP/WS 服务端 + Web 控制台
├── runner/         # Node.js Runner 常驻进程（npm 包：agentmesh-runner）
├── tests/          # 集成测试
├── docker-compose.yml
├── railway.json
└── render.yaml
```

---

## 🧪 开发

```bash
# 以开发模式启动 Gateway（热重载）
AGENTMESH_BOOTSTRAP_PASSWORD=dev npm --prefix gateway run dev

# 以开发模式启动 Runner
AGENTMESH_ENROLL_CODE='<绑定码>' npm --prefix runner run dev

# 运行测试（需先 build）
npm --prefix gateway run build && npm --prefix runner run build
node --test tests/*.test.mjs
```

---

## License

MIT
