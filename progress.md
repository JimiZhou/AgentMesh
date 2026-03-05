# AgentMesh Progress

Last updated: 2026-03-04

AgentMesh 目标：做一个 Gateway + Runner 的最小系统，把 Codex/Claude/Gemini 这类“本地终端型 coding agent”的交互体验，从 SSH/本机终端搬到 Web，并尽量做到 1:1（ANSI、光标、全屏 TUI、低延迟输入）。

## Architecture direction (decision log)
- 产品假设：面向能自建部署的程序员，优先单人自用单租户，不做多租户复杂度。
- 部署形态：Server 是控制面与数据面，必须提供 Web 界面给人操作，同时对外提供 API/WS；Agent 是无头常驻进程，安装在各节点上作为可调度执行单元。
- 网络模型：选择 Agent 主动长连 Server（WSS/WebSocket），不要求节点开放入站端口，适配 NAT/企业网/家宽。
- 纳管方式：不采用第三方中转/扫码绑定；采用 Server 生成一次性 enroll token，Agent 用 token 换取长期身份凭证并常驻心跳，后续所有任务与 PTY 流都走同一条出站连接。
- 公网可达：HTTPS 终止由用户环境负责（Lucky/NAS/CF tunnel/反代/网关等），Server 主要保证在反代后正确识别真实协议与来源，并在 https 场景下使用 Secure cookie。
- Web 认证：采用 cookie session + 账号密码 + TOTP（二步验证，Google Authenticator 兼容），不强依赖外部反代认证系统。
- 重要安全修正：当前“知道 sessionId 就能连 /ws/terminal”的模型必须淘汰；终端接入必须绑定登录态与会话级授权，并做 Origin/CSRF 等校验，避免公网裸奔。

## What’s implemented (working today)

### Incremental update (2026-03-04, latest)
- Runner 绑定码（URL + token）已接入：
  - Gateway 新增 `POST /api/enroll/create` 生成一次性 enroll token，并输出 base64url 绑定码；
  - 绑定码 payload 包含 `gatewayHttp/gatewayWs/token/exp`，便于 runner 一次导入；
  - Runner 支持 `AGENTMESH_ENROLL_CODE` 环境变量，启动时自动兑换长期凭证并连接。
- Web 认证与终端授权补齐（基础版）：
  - 新增 `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`（cookie session）；
  - API 写操作增加 CSRF 校验（`X-AgentMesh-CSRF`）；
  - Terminal 连接新增会话级一次性 token（`POST /api/sessions/:id/terminal-token`）；
  - `WS /ws/terminal` 现在需要：登录态 + terminal token + 会话归属校验 + Origin 校验。
- Runner 断线重连后的会话对账（reconcile）已接入：
  - Gateway 在 runner WS 建连后主动发 `reconcile_sessions`；
  - Runner 回传存活会话清单 `reconcile_sessions_result`；
  - Gateway 根据结果自动修正 session 状态（running/exited）。
- 可观测性基础能力补齐：
  - Gateway 侧新增内存指标聚合（输入/输出帧、丢帧、慢客户端断开、buffer、reconcile 计数等）；
  - Runner 侧周期上报 `runner_metrics`（队列长度、累计发送/丢弃、活跃会话）；
  - 新增 `GET /api/metrics`，UI 侧新增 Metrics 面板可直接查看。
- Gateway terminal browser 链路已升级为“二进制输入/输出”：
  - Browser -> Gateway：xterm `onData` 改为发送二进制字节，不再走 JSON/utf8 输入文本。
  - Gateway -> Browser：PTY 数据以二进制帧直发，浏览器端用 `TextDecoder(stream)` 解码写入 xterm。
  - 兼容旧客户端：Gateway 仍接受老的 `{type:'input', data:'...'}` JSON 输入格式。
- Gateway 增加慢客户端保护（browser fan-out）：
  - 按 `bufferedAmount` 做背压阈值控制；
  - 超阈值时丢帧，严重超限时主动断开慢连接，避免拖垮内存。
- Session 生命周期补齐：
  - 新增状态：`starting` / `stopping` / `exited`（保留 `created/running/error`）；
  - Gateway 处理 runner 回传的 `start_session_result`、`stop_session_result`、`session_exit`，可靠更新状态；
  - Session 记录新增 `startedAt` / `exitedAt` / `lastError` / `projectPath`。
- Session API 增强：
  - `POST /api/sessions` 支持从 `project.runnerId` 自动推导 runner，runnerId 可选；
  - `POST /api/sessions/:id/start` 默认自动使用 `session.projectPath` 或 `project.path`；
  - 新增 `POST /api/sessions/:id/stop`；
  - 新增 `GET /api/sessions/:id`。
- Runner 增强：
  - 新增 `stop_session` 处理（kill PTY 并回传 stop result）；
  - `start_session` 支持 `codex|claude|gemini` 命令分发（统一 PTY 启动路径）；
  - 重复 `sessionId` 启动会返回错误，避免覆盖旧会话。
- Gateway UI 增强：
  - Project 表单新增 `path`；
  - Session 表单新增 `projectPath`，runnerId 改为可选；
  - 增加 Session 控制区：`Start` / `Stop`；
  - 创建会话后自动填充 `sessionControlId` 与 Terminal 的 `sessionId`；
  - Terminal 加 `ResizeObserver`，容器尺寸变化时自动上报 resize。

### Repo / naming
- Repo: https://github.com/JimiZhou/AgentMesh (private)
- Local path: /Volumes/HDD/Projects/AgentMesh
- 项目早期叫 VibeHub，已改名 AgentMesh。

### Gateway (Fastify)
- HTTP 服务与健康检查：`GET /health`。
- Web Auth：`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`。
- Enroll：`POST /api/enroll/create`（生成绑定码）、`POST /api/runners/enroll`（runner 兑换凭证）。
- Runner 注册与状态存储：`POST /api/runners/register` 返回 runnerId/runnerToken。
- Runner 列表：`GET /api/runners`（会标注 online/offline）。
- Projects：`POST /api/projects`、`GET /api/projects`（目前仅存 JSON 状态，runner/path 绑定逻辑尚未真正参与执行）。
- Sessions：
  - `POST /api/sessions` 创建会话（projectId/tool 必填，runnerId 可选并可从 project 继承）。
  - `POST /api/sessions/:id/start` 通过 runner WS 下发 `start_session`。
  - `POST /api/sessions/:id/stop` 通过 runner WS 下发 `stop_session`。
  - `POST /api/sessions/:id/terminal-token` 申请一次性终端接入 token。
  - `GET /api/sessions` 列表。
- Metrics：`GET /api/metrics` 查看 gateway/runner 实时指标快照。
- PTY 数据缓存：在 gateway 内存中为每个 session 保存一段 tail buffer（用于新连接补屏/回放）。
- PTY 拉取（调试/回放用）：`GET /api/sessions/:id/pty/latest` 返回缓存尾部文本。
- PTY 输入（HTTP 版本，调试用）：`POST /api/sessions/:id/pty/input` 支持 utf8 或 base64，内部会转成二进制帧发给 runner。
- PTY resize（HTTP 版本，调试用）：`POST /api/sessions/:id/pty/resize` 下发 `pty_resize`。

### Runner (daemon + WebSocket)
- Runner 作为常驻进程：启动后会自动注册（或读 identity.json 复用），并保持到 gateway 的 WS 常连。
- Capabilities 上报：runner 连接后会发送 capabilities（tools/features/platform）。
- 重连对账：收到 `reconcile_sessions` 会回报当前存活 PTY 会话清单。
- 指标上报：周期发送 `runner_metrics`（队列长度、累计发送/丢弃、活跃会话）。
- PTY 会话（node-pty）：
  - 收到 `start_session` 后，为 `tool=codex|claude|gemini` 创建 PTY（interactive shell），先挂好 onData，再写入对应工具命令启动。
  - 收到二进制 PTY_INPUT 帧后，把输入写入 PTY。
  - 收到 `pty_resize` 后 resize。
  - 收到 `stop_session` 后 kill PTY 并回传 stop result。
  - PTY onData 会以二进制 PTY_DATA 帧流式回传。

### Binary framing protocol (runner <-> gateway)
- 已实现一种很轻量的二进制帧格式：`[kind:1][sidLen:1][sid...][payload...]`。
- kinds：PTY_DATA=1、PTY_INPUT=2。
- gateway 端支持分片、简单背压阈值与缓冲上限（best-effort）。

### Web UI (gateway 内置静态页)
- `GET /` 已演进到“工作台”形态（不再是测试台卡片堆叠）：
  - 登录页 -> 在线 runner 列表 -> runner 详情（能力 + 会话管理）-> terminal。
  - 登录后默认只展示在线 runner（在线环境数），离线残留不在主列表干扰操作。
- 已接入 xterm.js（不再依赖 CDN，改为 gateway 本地静态资源 `/assets/xterm/*`）：
  - 页面 terminal 走独立视图，点击会话直接进入。
  - 浏览器先申请 terminal token，再连接 `WS /ws/terminal?sessionId=...&token=...` 订阅实时 PTY 输出。
  - 键盘输入通过 WS 二进制字节流回灌到 gateway，再转发给 runner（兼容旧 JSON 输入）。
  - 窗口 resize 触发 `{type:'resize', cols, rows}`，转发给 runner。
- 当 xterm 资源异常时，UI 自动降级到 basic terminal（`<pre> + textarea`），保证登录/API/终端主流程不因前端脚本缺失而整体失效。
- 终端连接错误提示已增强：会明确提示 `sessionId` 与 `runnerId` 的区别（`/api/sessions/:id/terminal-token` 需要会话 ID）。
- 2026-03-04 新增 runner/session 管理 API（支撑“清理残留 + 历史会话管理”）：
  - `GET /api/runners`：返回 `summary(total/online/offline)`，支持 `onlineOnly` 过滤。
  - `GET /api/runners/:id`：返回 runner 详情 + 历史会话列表 + 活跃会话统计 + 最近指标。
  - `POST /api/runners/:id/sessions`：在指定 runner 下快捷创建 project+session（支持 tool/path/name）。
  - `POST /api/runners/cleanup`：一键清理离线 runner 及其残留 sessions/projects。
  - `DELETE /api/sessions/:id`：支持强制删除会话并回收 artifacts/孤儿 project。
  - `DELETE /api/runners/:id`：删除 runner 及关联残留（在线默认拒绝，需 force）。

### Terminal passthrough milestone notes
- 早期尝试过 tmux capture-pane 抓屏文字作为最小闭环，但不可能 1:1。
- 已切到 node-pty 真 PTY 透传，当前能在 Web 里看到 Codex 全屏 TUI 输出，并能把输入回灌。
- 关键故障与修复：mac mini 上 node-pty prebuilt 的 spawn-helper 缺少可执行权限导致 `posix_spawnp failed`；对 `node_modules/node-pty/prebuilds/darwin-x64/spawn-helper` 执行 chmod +x 后恢复正常。

## Known issues / risks / future pitfalls

### Web 终端链路（高概率踩坑）
- Browser WS 已切到二进制输入/输出，但 IME 组合输入、超大粘贴、以及控制序列边界仍需持续验证（尤其跨浏览器差异）。
- gateway -> browser 已加基础背压与慢客户端丢帧/断开策略，但还缺 per-client 指标与更细粒度队列观测。
- 现在的补屏策略是“把内存 tail buffer 整段发给新连接”。对全屏 TUI 来说，这不等价于“当前屏幕状态”，可能会出现重连后画面异常；需要做更可靠的 replay（比如仅发最近 N 秒增量 + 强制 resize/clear）或持久化 terminal state。
- xterm 已加 `ResizeObserver` 做容器变化 resize，但仍缺节流与异常场景（隐藏容器、移动端旋转）专项处理。

### 协议与一致性
- 二进制帧协议很轻，但目前没有版本号、没有校验、也没有 ack；未来想支持多消息类型（粘贴、文件传输、心跳、压缩）时容易变成隐形耦合，需要定义清晰的 message types 和兼容策略。
- sessionId 用 utf8 + 1 字节长度，sid>255 会直接炸；短期没问题，但属于隐性限制。

### Session 生命周期（断线/重启）
- gateway 状态 store 落盘了 sessions/projects/runners，但 PTY buffer 只在内存；gateway 重启会丢掉终端上下文，新连接就空白。
- 已有基础 reconcile 流程可在 runner 重连时对齐状态，但还缺更细粒度的“启动中/停止中”超时处理与重试策略。
- 已有 `stop_session` API，但还没有“超时强杀 + 原因分类 + 重试策略”等更完善的退出控制。

### node-pty / 环境差异
- 已遇到过 spawn-helper 权限问题导致所有 PTY spawn 失败；这类问题在换机器、升级 node-pty、或重新安装依赖时可能复发，最好在 runner 启动时做自检并给出明确错误提示。
- 不同 shell（bash/zsh/fish）对交互、提示符、环境变量加载差异很大；现在是用 `$SHELL` 起交互 shell，再写 `codex`，如果用户的 shell 初始化脚本很重，会明显增加启动延迟。

### 安全风险（别在公网裸奔）
- 已补上基础登录态 + CSRF + terminal token + session 归属校验 + Origin 校验，但仍缺完整账号体系、二步验证、审计日志与权限分层。
- 绑定码里使用的是 base64url 编码（便于传输，不是加密）；真正安全边界仍依赖一次性短期 token + HTTPS/WSS。
- Codex TUI 会处理工作目录里的文件内容，等价于把本机文件系统的读写能力暴露出去；正式使用必须加访问控制、加密传输、以及最小权限运行。

### Codex TUI 行为（会遇到的人机交互问题）
- 首次进入目录的 trust 提示会卡住流程，需要 UI 侧有明显提示或提供“一键发送 1+Enter”的 quick action。
- IME 中文输入、组合键、复制粘贴、大段文本粘贴，会触发不同的 key 序列，当前简单 onData 直发可能会有兼容问题，需要加 paste 模式或专门处理。

### 可观测性与调试
- 目前缺少统一的 request/session 日志关联（比如把 sessionId 打到所有关键日志里），排查“某个 session 为什么没输出/没输入”会很费劲。
- 已有基础 metrics（bufferedAmount、队列长度、丢帧计数等），但仍缺时序历史、聚合告警和长周期趋势分析。

## What’s planned (next milestones)

### Web 终端体验补齐
- 二进制链路后续：补协议版本/控制消息类型，减少隐式兼容负担。
- 流控后续：补 per-client 队列指标、丢帧计数、延迟观测与可调策略参数。
- 支持更多事件：比如复制粘贴、滚动缓冲、断线重连后的补屏策略更合理。

### 会话管理与持久化
- session 生命周期后续：完善 runner 断线/重连后的 reconcile，保证状态机与真实进程对齐。
- PTY 持久化：
  - 最直接方案是把 session 元数据与日志落盘；
  - 更强方案是把 Codex 跑进 tmux（或类似机制）做“进程不死 + 断线可重连”。

### 安全与访问控制
- Runner 鉴权目前只是 runnerToken 直连，后续要补：token 轮换、最小权限、以及浏览器端访问控制。
- 传输层：从纯 http/ws 升级到 https/wss（或强制走 Tailscale 内网），并明确 trusted proxy 策略。

### 产品形态（从测试台到工作台）
- UI 从“API 测试台”进化到“工作台”：项目视图、会话列表、终端 tab、基础日志。
- Project path / runner binding 已有基础自动推导，后续要做 UI 级默认值与批量操作体验。

### 多工具与扩展
- runner 已支持 codex/claude/gemini 基础启动，后续要补工具级健康检查、错误分类和能力探测。
- 插件化：把 tool 的启动命令、环境变量、工作目录策略抽成可配置。

## Non-goals (for now)
- 不做复杂的权限系统、账号体系、多人协作。
- 不做完整的远程文件管理器（先把终端体验打穿）。

## Dev conventions
- 快速迭代阶段默认不提交/不 push；有明确里程碑再整理提交。
