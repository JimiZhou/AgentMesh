import { createTerminalController } from './terminal.js';

const $ = (id) => document.getElementById(id);
const THEME_STORAGE_KEY = 'agentmesh_ui_theme';
const LANG_STORAGE_KEY = 'agentmesh_ui_lang';
const TERM_PALETTE_STORAGE_KEY = 'agentmesh_terminal_palette';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';
const LANG_ZH = 'zh';
const LANG_EN = 'en';
const TERM_PALETTE_NOIR = 'noir';
const TERM_PALETTE_DRACULA = 'dracula';
const TERM_PALETTE_GRUVBOX = 'gruvbox';
const TERM_PALETTE_NORD = 'nord';
const TERM_PALETTE_TOKYO_NIGHT = 'tokyo-night';
const TERM_PALETTE_SOLARIZED_DARK = 'solarized-dark';
const TERM_PALETTE_SOLARIZED_LIGHT = 'solarized-light';
const TERM_PALETTE_PAPER = 'paper';
const TERM_PALETTE_AMBER = 'amber';
const TERM_PALETTES = [
  TERM_PALETTE_NOIR,
  TERM_PALETTE_DRACULA,
  TERM_PALETTE_GRUVBOX,
  TERM_PALETTE_NORD,
  TERM_PALETTE_TOKYO_NIGHT,
  TERM_PALETTE_SOLARIZED_DARK,
  TERM_PALETTE_SOLARIZED_LIGHT,
  TERM_PALETTE_PAPER,
  TERM_PALETTE_AMBER,
];
const TERMINAL_PALETTE_PRESETS = [
  { id: TERM_PALETTE_NOIR, labelKey: 'terminal.paletteNoir', background: '#040609', foreground: '#f4f7fa', accent: '#94a3b8' },
  { id: TERM_PALETTE_DRACULA, labelKey: 'terminal.paletteDracula', background: '#191a21', foreground: '#f8f8f2', accent: '#bd93f9' },
  { id: TERM_PALETTE_GRUVBOX, labelKey: 'terminal.paletteGruvbox', background: '#1d2021', foreground: '#ebdbb2', accent: '#fabd2f' },
  { id: TERM_PALETTE_NORD, labelKey: 'terminal.paletteNord', background: '#2e3440', foreground: '#e5e9f0', accent: '#88c0d0' },
  { id: TERM_PALETTE_TOKYO_NIGHT, labelKey: 'terminal.paletteTokyoNight', background: '#1a1b26', foreground: '#c0caf5', accent: '#7aa2f7' },
  { id: TERM_PALETTE_SOLARIZED_DARK, labelKey: 'terminal.paletteSolarizedDark', background: '#002b36', foreground: '#93a1a1', accent: '#268bd2' },
  { id: TERM_PALETTE_SOLARIZED_LIGHT, labelKey: 'terminal.paletteSolarizedLight', background: '#fdf6e3', foreground: '#586e75', accent: '#268bd2' },
  { id: TERM_PALETTE_PAPER, labelKey: 'terminal.palettePaper', background: '#f7f3ea', foreground: '#111111', accent: '#6b7280' },
  { id: TERM_PALETTE_AMBER, labelKey: 'terminal.paletteAmber', background: '#0a0907', foreground: '#f3c776', accent: '#f3c776' },
];
const TOOL_ORDER = ['codex', 'claude', 'gemini'];

const MESSAGES = {
  zh: {
    'app.description': 'AgentMesh 控制台，用于连接远端网关、管理本地节点，并在浏览器中使用 ACP 会话流操作 Codex、Claude 和 Gemini。',
    'chrome.tagline': '远端节点控制台，用于管理 Codex、Claude 和 Gemini CLI',
    'chrome.language': '界面语言',
    'auth.signedOut': '未登录',
    'auth.signedIn': ({ user }) => `已登录 · ${user || '-'}`,
    'login.eyebrow': '网关在线',
    'login.title': 'AgentMesh',
    'login.copy': '使用本机网关账号登录，统一管理节点、会话和 ACP 工作流。',
    'login.footnote': '如已启用 TOTP，下一步会要求输入 6 位动态码。',
    'field.username': '用户名',
    'field.password': '密码',
    'field.totp': '动态码',
    'placeholder.username': '输入用户名',
    'placeholder.password': '输入网关密码',
    'placeholder.totp': '输入 6 位动态码',
    'placeholder.newUser': '留空表示不修改',
    'placeholder.newPassword': '留空表示不修改',
    'placeholder.currentPassword': '用于确认身份',
    'placeholder.runnerSearch': '例如 mac-mini / codex / 在线',
    'placeholder.projectPath': '留空时使用节点默认工作目录',
    'placeholder.projectName': '例如 my-workspace',
    'placeholder.sessionSearch': '按会话 ID、工具、状态或路径搜索',
    'button.login': '登录',
    'button.verifyAndLogin': '验证并登录',
    'button.settings': '设置',
    'button.refresh': '刷新',
    'button.logout': '退出',
    'button.notifications': '通知',
    'button.reviewNow': '立即处理',
    'button.backToConsole': '返回控制台',
    'button.saveAndRelogin': '保存并重新登录',
    'button.configureTotp': '前往绑定',
    'button.removeTotp': '删除两步验证',
    'button.backToList': '返回列表',
    'button.refreshDetail': '刷新详情',
    'button.createAndOpenTerminal': '创建并进入会话',
    'button.back': '返回',
    'button.reconnect': '重连',
    'button.disconnect': '断开',
    'button.confirm': '确认',
    'button.cancel': '取消',
    'button.viewDetails': '查看详情',
    'button.startCoding': '开始 coding',
    'button.delete': '删除',
    'button.openTerminal': '进入会话',
    'button.copyClaudeResume': '复制 Claude Resume 命令',
    'button.copyGeminiLaunch': '复制 Gemini 启动命令',
    'button.stop': '停止',
    'button.zoomIn': '放大',
    'button.zoomOut': '缩小',
    'workspace.eyebrow': '控制台',
    'workspace.title': '开始 coding',
    'workspace.heroEyebrow': '开始',
    'workspace.heroTitle': '登录后先选一个在线节点，然后直接开始 ACP coding。',
    'workspace.heroBody': 'AgentMesh 会在所选节点上拉起会话，并把消息、计划、工具调用和文件变更连续渲染成可跟进的工作流。',
    'workspace.riskTitle': '安全提醒',
    'workspace.runnerListTitle': '节点列表',
    'workspace.runnerListCopy': '优先选一个在线节点直接开工；详情配置和历史会话退到次一级。',
    'workspace.recentTitle': '继续最近会话',
    'workspace.recentCopy': '如果你刚刚中断过会话，可以从这里直接回到最近的 coding 流。',
    'workspace.metric.online': '在线节点',
    'workspace.metric.active': '活跃会话',
    'workspace.metric.tools': 'ACP 工具',
    'workspace.quickStart': '开始 coding',
    'workspace.quickStartHint': '使用默认工具和节点默认工作目录立即开工',
    'workspace.quickResume': '继续最近会话',
    'workspace.openRunners': '查看节点',
    'workspace.recentEmpty': '最近还没有会话，选一个在线节点开始第一轮。',
    'stats.onlineRunners': '在线节点',
    'stats.onlineRunnersMeta': '当前可接收任务的节点',
    'stats.offlineRunners': '离线节点',
    'stats.offlineRunnersMeta': '需要排查网络、服务或机器状态的节点',
    'stats.totalSessions': '总会话数',
    'stats.totalSessionsMeta': '当前网关可见的所有会话',
    'stats.activeSessions': '活跃会话',
    'stats.activeSessionsMeta': '运行中 / 启动中 / 停止中',
    'settings.eyebrow': '安全设置',
    'settings.title': '控制台设置',
    'settings.authTitle': '账号与密码',
    'settings.authCopy': '修改控制台登录身份。保存后当前会话会被强制登出。',
    'settings.newUser': '新用户名',
    'settings.newPassword': '新密码',
    'settings.currentPassword': '当前密码',
    'settings.totpTitle': '两步验证',
    'settings.totpCopy': '建议在对外暴露控制台之前完成 TOTP 绑定。',
    'detail.eyebrow': '节点详情',
    'detail.capabilitiesTitle': '节点能力',
    'detail.rawCapabilities': '查看原始能力载荷',
    'detail.newSessionTitle': '新建会话',
    'detail.newSessionCopy': '为当前节点选择已探测可用的 CLI 工具、项目路径和项目名称，然后直接进入 ACP 会话。',
    'detail.cliAgent': 'CLI 工具',
    'detail.projectPath': '项目路径',
    'detail.projectPathDefault': '默认工作目录',
    'detail.projectName': '项目名称',
    'detail.sessionListTitle': '会话列表',
    'detail.sessionSearchLabel': '筛选会话',
    'terminal.eyebrow': 'ACP 会话',
    'terminal.disconnected': '未连接',
    'terminal.hint': '移动端支持 Ctrl / Alt 锁定键、方向键长按连发、双指缩放，以及快速唤起软键盘。',
    'terminal.mobileKeys': '终端快捷键',
    'terminal.modifierGroup': '修饰键',
    'terminal.navigationGroup': '导航键',
    'terminal.sessionActionsGroup': '会话操作',
    'terminal.keyboard': '键盘',
    'terminal.zoomInAria': '放大终端文字',
    'terminal.zoomOutAria': '缩小终端文字',
    'terminal.themeButton': '主题',
    'terminal.paletteGroup': '终端配色选择',
    'terminal.paletteNoir': 'Noir',
    'terminal.paletteDracula': 'Dracula',
    'terminal.paletteGruvbox': 'Gruvbox',
    'terminal.paletteNord': 'Nord',
    'terminal.paletteTokyoNight': 'Tokyo Night',
    'terminal.paletteSolarizedDark': 'Solarized Dark',
    'terminal.paletteSolarizedLight': 'Solarized Light',
    'terminal.palettePaper': 'Paper',
    'terminal.paletteAmber': 'Amber',
    'terminal.protocolLabel': '协议',
    'terminal.connectionLabel': '连接',
    'terminal.agentLabel': 'Agent',
    'terminal.authLabel': '认证',
    'terminal.authReady': '环境已就绪',
    'terminal.workspaceTitle': '实时工作面',
    'terminal.workspaceTurns': '轮次',
    'terminal.workspaceTools': '工具调用',
    'terminal.workspaceFiles': '最近文件',
    'terminal.workspaceApprovals': '待处理授权',
    'terminal.workspaceNoFiles': '本轮还没有文件变更',
    'terminal.turnLabel': ({ index }) => `第 ${index} 轮`,
    'terminal.turnMeta': ({ tools, files }) => `${tools} 次工具调用 · ${files} 个文件`,
    'terminal.turnOpen': '展开本轮',
    'terminal.sectionOutput': '命令输出',
    'terminal.sectionDiff': '变更 diff',
    'terminal.sectionContent': '结构化结果',
    'terminal.sectionEmpty': '该工具这一步还没有可展示的结果。',
    'terminal.linesUnit': ({ count }) => `${count} 行`,
    'terminal.emptyEyebrow': '已连接',
    'terminal.emptyTitle': '会话已经就绪，下一条指令可以直接发给 Agent。',
    'terminal.emptyBody': '这里会连续显示消息、计划、工具调用、命令输出和授权请求，适合在手机上直接跟进任务。',
    'terminal.emptyConnectingTitle': '正在连接会话…',
    'terminal.emptyConnectingBody': '正在建立 ACP 会话流，稍候即可开始对话。',
    'terminal.emptyErrorTitle': '会话流连接失败',
    'terminal.emptyErrorBody': '无法连接到会话流。请检查网络后点击上方的“重连”按钮重试。',
    'terminal.planTitle': '执行计划',
    'terminal.composerLabel': '发送下一条指令',
    'terminal.composerPlaceholder': '例如：检查这个仓库里 web 端还有哪些体验问题，并直接修掉',
    'terminal.sendPrompt': '发送',
    'terminal.cancelTurn': '停止本轮',
    'terminal.starter.audit': '扫描这个仓库里还没打磨好的体验问题',
    'terminal.starter.fix': '继续当前任务并直接修改代码',
    'terminal.starter.summary': '总结当前进展、风险和下一步',
    'terminal.promptFinished': ({ reason }) => `本轮已完成 · stop reason: ${reason}`,
    'terminal.promptFailed': ({ message }) => `本轮失败 · ${message}`,
    'terminal.permissionTitle': '等待授权',
    'terminal.toolTerminal': '命令输出',
    'terminal.toolCallFallback': '工具调用',
    'terminal.role.user': '你',
    'terminal.role.assistant': 'Agent',
    'terminal.role.thought': '思考',
    'terminal.toolKind.read': '读取',
    'terminal.toolKind.edit': '编辑',
    'terminal.toolKind.delete': '删除',
    'terminal.toolKind.move': '移动',
    'terminal.toolKind.search': '搜索',
    'terminal.toolKind.execute': '执行',
    'terminal.toolKind.think': '思考',
    'terminal.toolKind.fetch': '获取',
    'terminal.toolKind.switch_mode': '切换模式',
    'terminal.toolKind.other': '工具',
    'modal.title': '提示',
    'theme.toLight': '切换日间',
    'theme.toLightAria': '切换到日间模式',
    'theme.toDark': '切换夜间',
    'theme.toDarkAria': '切换到夜间模式',
    'chrome.openMenu': '打开菜单',
    'chrome.closeMenu': '收起菜单',
    'notifications.title': '通知',
    'notifications.empty': '当前没有需要处理的通知。',
    'notifications.openAria': '打开通知面板',
    'toast.notice': '提示',
    'label.unknown': '未知',
    'label.unreported': '未上报',
    'status.online': '在线',
    'status.offline': '离线',
    'status.created': '已创建',
    'status.starting': '启动中',
    'status.running': '运行中',
    'status.stopping': '停止中',
    'status.ended': '已结束',
    'status.exited': '已退出',
    'status.error': '异常',
    'runner.summary': ({ online, offline, total, matched }) =>
      `在线 ${online} 台节点 · 离线 ${offline} 台节点 · 总计 ${total} 台${matched === undefined ? '' : ` · 匹配 ${matched} 台`}`,
    'runner.emptyMatched': '没有匹配的节点。',
    'runner.empty': '当前没有节点。',
    'runner.unsupportedTools': '未上报工具',
    'runner.lastSeen': '最近心跳',
    'runner.absoluteTime': '绝对时间',
    'session.noSupportedTool': '当前节点未上报可用工具，暂不可创建会话。',
    'detail.subline': ({ status, relative, absolute }) => `${status} · 最近心跳 ${relative} · ${absolute}`,
    'detail.capabilitySummary': ({ tools }) => `当前节点支持 ${tools}，可直接用于新建会话。`,
    'detail.capabilitySummaryEmpty': '当前节点未上报可用工具。',
    'detail.sessionSummary': ({ total, active, matched }) =>
      `总会话 ${total} · 活跃 ${active}${matched === undefined ? '' : ` · 匹配 ${matched}`}`,
    'detail.noSessionMatched': '没有匹配的会话。',
    'detail.noSession': '暂无会话，可直接在上方创建。',
    'detail.metric.runnerId': '节点 ID',
    'detail.metric.platform': '平台',
    'detail.metric.status': '在线状态',
    'detail.metric.lastHeartbeat': '最近心跳',
    'detail.metric.activeSessions': '活跃会话',
    'detail.metric.totalSessions': '总会话',
    'session.idLabel': '会话 ID',
    'session.meta.created': '创建时间',
    'session.meta.projectPath': '项目路径',
    'session.meta.runner': '节点',
    'session.createdByUnknown': '未知用户',
    'terminal.meta': ({ tool, sessionId, runner, status, connection, projectPath }) =>
      `${tool} 会话 ID: ${sessionId} · 节点: ${runner} · 状态: ${status}${connection ? ` · ${connection}` : ''}${projectPath ? ` · 路径: ${projectPath}` : ''}`,
    'terminal.connectionFailed': '会话连接失败',
    'terminal.startFailedInline': ({ message }) => `[启动会话失败: ${message}]`,
    'terminal.status.connected': '已连接',
    'terminal.status.connecting': '连接中',
    'terminal.status.disconnected': '未连接',
    'terminal.status.error': '连接异常',
    'notify.loginSuccessTitle': '登录成功',
    'notify.loginSuccessMessage': ({ user }) => `欢迎回来，${user}。`,
    'notify.loginFailedTitle': '登录失败',
    'notify.loginTotpRequired': '请输入动态码继续登录',
    'notify.loginUnknown': '登录失败',
    'notify.refreshRunnerFailedTitle': '刷新节点失败',
    'notify.refreshRunnerDetailFailedTitle': '读取节点详情失败',
    'notify.refreshFailed': '刷新失败',
    'notify.loadRunnerFailed': '加载节点详情失败',
    'notify.createSessionTitle': '会话已创建',
    'notify.createSessionMessage': ({ sessionId }) => `会话 ID: ${sessionId}，正在准备 ACP 会话流。`,
    'notify.createSessionInline': ({ sessionId }) => `已创建会话：${sessionId}，正在进入 ACP 会话…`,
    'notify.createSessionFailedTitle': '创建会话失败',
    'notify.quickStartFailedTitle': '快速开始失败',
    'notify.createFailed': '创建失败',
    'notify.runnerOfflineTitle': '节点已离线',
    'notify.runnerOfflineMessage': '当前节点离线，无法进入会话。',
    'notify.offlineTitle': '设备已离线',
    'notify.offlineMessage': '当前网络不可用。ACP 会话会保留界面状态，待网络恢复后自动重连。',
    'notify.onlineTitle': '网络已恢复',
    'notify.onlineMessage': '已重新联网，正在恢复当前视图。',
    'notify.sessionResumedTitle': '会话已恢复',
    'notify.sessionResumedMessage': 'ACP 会话连接已重新建立。',
    'notify.sessionResumeFailedTitle': '会话恢复失败',
    'notify.startSessionFailedTitle': '启动会话失败',
    'notify.stopRequestedTitle': '停止请求已发送',
    'notify.stopRequestedMessage': ({ sessionId }) => `会话 ${sessionId} 正在停止。`,
    'notify.stopFailedTitle': '停止失败',
    'notify.deleteSessionTitle': '删除会话',
    'notify.deleteSessionBody': '删除会话会一并清理关联项目；若会话仍在运行，将执行 force 删除。',
    'notify.deleteSessionConfirm': '确认删除',
    'notify.deleteSessionSuccessTitle': '会话已删除',
    'notify.deleteSessionFailedTitle': '删除会话失败',
    'notify.deleteRunnerTitle': '删除节点',
    'notify.deleteRunnerBody': '离线节点会直接移除，在线节点会使用 force 删除并清理其会话与项目。',
    'notify.deleteRunnerSuccessInline': ({ runnerId }) => `已删除节点：${runnerId}`,
    'notify.deleteRunnerSuccessTitle': '节点已删除',
    'notify.deleteRunnerFailedTitle': '删除节点失败',
    'notify.copyClaudeTitle': '已复制 Claude Resume 命令',
    'notify.copyGeminiTitle': '已复制 Gemini 启动命令',
    'notify.copyFailedTitle': '复制失败',
    'notify.settingsCurrentUser': ({ user }) => `当前用户：${user}`,
    'notify.totpConfigured': '已配置两步验证。若需更换设备，请先删除再重新绑定。',
    'notify.totpNotConfigured': '未配置两步验证。建议上线前立刻访问 /setup 完成绑定。',
    'notify.authSavedInline': '已保存，正在退出当前会话。',
    'notify.authSavedTitle': '账号信息已保存',
    'notify.authSavedMessage': '需要重新登录后继续。',
    'notify.saveFailedTitle': '保存失败',
    'notify.disableTotpTitle': '删除两步验证',
    'notify.disableTotpBody': '删除后会降低控制台安全性。请再次输入密码和当前动态码确认。',
    'notify.disableTotpConfirm': '继续删除',
    'notify.totpPasswordLabel': '当前密码',
    'notify.totpPasswordPlaceholder': '必填',
    'notify.totpCodeLabel': '当前动态码',
    'notify.totpCodePlaceholder': '6 位动态码',
    'notify.incompleteTitle': '信息不完整',
    'notify.incompleteMessage': '需要同时提供当前密码和动态码。',
    'notify.totpDeletedInline': '已删除两步验证。',
    'notify.totpDeletedTitle': '两步验证已删除',
    'notify.totpDeletedMessage': '如需上线，请尽快重新绑定。',
    'notify.disableTotpFailedTitle': '删除两步验证失败',
    'notify.actionUnsupported': '操作不支持',
    'risk.defaultTitle': '默认凭据仍在使用',
    'risk.defaultBody': '检测到 admin / agentmesh 尚未替换。发布前应先修改账号或密码，再继续暴露控制台。',
    'risk.defaultAction': '去修改账号密码',
    'risk.totpTitle': '两步验证尚未完成',
    'risk.totpBody': '当前账户还没有完成 TOTP 绑定。建议上线前立即完成 /setup。',
    'risk.totpAction': '去绑定 TOTP',
    'gemini.availableFallback': ({ command }) => `Gemini 可用：将使用 npx fallback 启动（${command}）。`,
    'gemini.availableEnv': ({ command }) => `Gemini 可用：已通过 AGENTMESH_GEMINI_CMD 指定命令（${command}）。`,
    'gemini.availableDirect': ({ command }) => `Gemini 可用：命令 ${command}。`,
    'gemini.unavailable': ({ reason }) => `Gemini 不可用：${reason}。可安装 Gemini CLI 或设置 AGENTMESH_GEMINI_CMD。`,
    'time.unknown': '-',
    'theme.toggleFallback': '切换主题',
  },
  en: {
    'app.description': 'AgentMesh console for managing the gateway, local runners, and ACP session streams for Codex, Claude, and Gemini.',
    'chrome.tagline': 'Remote runner control for Codex, Claude, and Gemini CLI',
    'chrome.language': 'Interface language',
    'auth.signedOut': 'Not signed in',
    'auth.signedIn': ({ user }) => `Signed in · ${user || '-'}`,
    'login.eyebrow': 'Gateway online',
    'login.title': 'AgentMesh',
    'login.copy': 'Sign in with the local gateway account to manage runners, sessions, and ACP workflows from one console.',
    'login.footnote': 'If TOTP is enabled, the next step will ask for a 6-digit code.',
    'field.username': 'Username',
    'field.password': 'Password',
    'field.totp': 'Verification code',
    'placeholder.username': 'Enter username',
    'placeholder.password': 'Enter gateway password',
    'placeholder.totp': 'Enter 6-digit code',
    'placeholder.newUser': 'Leave blank to keep current',
    'placeholder.newPassword': 'Leave blank to keep current',
    'placeholder.currentPassword': 'Required for confirmation',
    'placeholder.runnerSearch': 'Search by mac-mini / codex / online',
    'placeholder.projectPath': 'Leave blank to use the runner default working directory',
    'placeholder.projectName': 'For example: my-workspace',
    'placeholder.sessionSearch': 'Search by Session ID, tool, status, or path',
    'button.login': 'Sign in',
    'button.verifyAndLogin': 'Verify and sign in',
    'button.settings': 'Settings',
    'button.refresh': 'Refresh',
    'button.logout': 'Sign out',
    'button.notifications': 'Alerts',
    'button.reviewNow': 'Review now',
    'button.backToConsole': 'Back to console',
    'button.saveAndRelogin': 'Save and sign in again',
    'button.configureTotp': 'Configure TOTP',
    'button.removeTotp': 'Remove TOTP',
    'button.backToList': 'Back to list',
    'button.refreshDetail': 'Refresh details',
    'button.createAndOpenTerminal': 'Create and open session',
    'button.back': 'Back',
    'button.reconnect': 'Reconnect',
    'button.disconnect': 'Disconnect',
    'button.confirm': 'Confirm',
    'button.cancel': 'Cancel',
    'button.viewDetails': 'View details',
    'button.startCoding': 'Start coding',
    'button.delete': 'Delete',
    'button.openTerminal': 'Open session',
    'button.copyClaudeResume': 'Copy Claude resume command',
    'button.copyGeminiLaunch': 'Copy Gemini launch command',
    'button.stop': 'Stop',
    'button.zoomIn': 'Zoom In',
    'button.zoomOut': 'Zoom Out',
    'workspace.eyebrow': 'Console',
    'workspace.title': 'Start coding',
    'workspace.heroEyebrow': 'Start',
    'workspace.heroTitle': 'Pick an online runner and start ACP coding right away.',
    'workspace.heroBody': 'AgentMesh will create the session on that runner and keep rendering messages, plans, tool calls, and file changes as one continuous workflow.',
    'workspace.riskTitle': 'Security notice',
    'workspace.runnerListTitle': 'Runner list',
    'workspace.runnerListCopy': 'Choose an online runner and start working first. Detailed config and session history stay secondary.',
    'workspace.recentTitle': 'Resume recent sessions',
    'workspace.recentCopy': 'If you just left a session on mobile, jump back into it from here.',
    'workspace.metric.online': 'Online runners',
    'workspace.metric.active': 'Active sessions',
    'workspace.metric.tools': 'ACP tools',
    'workspace.quickStart': 'Start coding',
    'workspace.quickStartHint': 'Use the default tool and the runner default workspace',
    'workspace.quickResume': 'Resume recent session',
    'workspace.openRunners': 'Browse runners',
    'workspace.recentEmpty': 'No recent sessions yet. Pick an online runner to start the first one.',
    'stats.onlineRunners': 'Online runners',
    'stats.onlineRunnersMeta': 'Nodes ready to receive work now',
    'stats.offlineRunners': 'Offline runners',
    'stats.offlineRunnersMeta': 'Hosts that need network or service checks',
    'stats.totalSessions': 'Total sessions',
    'stats.totalSessionsMeta': 'All sessions visible to this gateway',
    'stats.activeSessions': 'Active sessions',
    'stats.activeSessionsMeta': 'running / starting / stopping',
    'settings.eyebrow': 'Security',
    'settings.title': 'Console settings',
    'settings.authTitle': 'Username and password',
    'settings.authCopy': 'Update the console credentials. Saving will force the current session to sign out.',
    'settings.newUser': 'New username',
    'settings.newPassword': 'New password',
    'settings.currentPassword': 'Current password',
    'settings.totpTitle': 'Two-factor authentication',
    'settings.totpCopy': 'TOTP should be configured before exposing this console to other users or networks.',
    'detail.eyebrow': 'Runner Detail',
    'detail.capabilitiesTitle': 'Runner capabilities',
    'detail.rawCapabilities': 'Show raw capability payload',
    'detail.newSessionTitle': 'Create session',
    'detail.newSessionCopy': 'Choose a detected CLI agent, a valid project path, and a project name for this runner, then open the ACP session immediately.',
    'detail.cliAgent': 'CLI agent',
    'detail.projectPath': 'Project path',
    'detail.projectPathDefault': 'Default working directory',
    'detail.projectName': 'Project name',
    'detail.sessionListTitle': 'Session list',
    'detail.sessionSearchLabel': 'Filter sessions',
    'terminal.eyebrow': 'ACP Session',
    'terminal.disconnected': 'Disconnected',
    'terminal.hint': 'Mobile mode supports sticky Ctrl / Alt modifiers, repeating arrow keys, pinch-to-zoom, and quick keyboard focus.',
    'terminal.mobileKeys': 'Terminal shortcut keys',
    'terminal.modifierGroup': 'Modifier keys',
    'terminal.navigationGroup': 'Navigation keys',
    'terminal.sessionActionsGroup': 'Session actions',
    'terminal.keyboard': 'Keyboard',
    'terminal.zoomInAria': 'Increase terminal text size',
    'terminal.zoomOutAria': 'Decrease terminal text size',
    'terminal.themeButton': 'Theme',
    'terminal.paletteGroup': 'Terminal palette selector',
    'terminal.paletteNoir': 'Noir',
    'terminal.paletteDracula': 'Dracula',
    'terminal.paletteGruvbox': 'Gruvbox',
    'terminal.paletteNord': 'Nord',
    'terminal.paletteTokyoNight': 'Tokyo Night',
    'terminal.paletteSolarizedDark': 'Solarized Dark',
    'terminal.paletteSolarizedLight': 'Solarized Light',
    'terminal.palettePaper': 'Paper',
    'terminal.paletteAmber': 'Amber',
    'terminal.protocolLabel': 'Protocol',
    'terminal.connectionLabel': 'Connection',
    'terminal.agentLabel': 'Agent',
    'terminal.authLabel': 'Auth',
    'terminal.authReady': 'Environment ready',
    'terminal.workspaceTitle': 'Live workspace',
    'terminal.workspaceTurns': 'Turns',
    'terminal.workspaceTools': 'Tool calls',
    'terminal.workspaceFiles': 'Recent files',
    'terminal.workspaceApprovals': 'Pending approvals',
    'terminal.workspaceNoFiles': 'No files touched yet in this session',
    'terminal.turnLabel': ({ index }) => `Turn ${index}`,
    'terminal.turnMeta': ({ tools, files }) => `${tools} tool calls · ${files} files`,
    'terminal.turnOpen': 'Open turn',
    'terminal.sectionOutput': 'Command output',
    'terminal.sectionDiff': 'Diff',
    'terminal.sectionContent': 'Structured result',
    'terminal.sectionEmpty': 'No renderable result for this tool step yet.',
    'terminal.linesUnit': ({ count }) => `${count} lines`,
    'terminal.emptyEyebrow': 'Connected',
    'terminal.emptyTitle': 'The session is ready. Send the next instruction directly to the agent.',
    'terminal.emptyBody': 'This view will keep rendering messages, plans, tool calls, command output, and permission requests in a mobile-friendly flow.',
    'terminal.emptyConnectingTitle': 'Connecting to the session…',
    'terminal.emptyConnectingBody': 'Setting up the ACP session stream. You can start chatting in a moment.',
    'terminal.emptyErrorTitle': 'Session stream unavailable',
    'terminal.emptyErrorBody': 'The session stream could not be reached. Check your connection and use the Reconnect button above to retry.',
    'terminal.planTitle': 'Plan',
    'terminal.composerLabel': 'Send the next instruction',
    'terminal.composerPlaceholder': 'For example: audit the web UX in this repo and fix the obvious issues directly',
    'terminal.sendPrompt': 'Send',
    'terminal.cancelTurn': 'Stop turn',
    'terminal.starter.audit': 'Scan the repo for rough UX edges',
    'terminal.starter.fix': 'Continue the task and edit the code directly',
    'terminal.starter.summary': 'Summarize progress, risks, and next steps',
    'terminal.promptFinished': ({ reason }) => `Turn finished · stop reason: ${reason}`,
    'terminal.promptFailed': ({ message }) => `Turn failed · ${message}`,
    'terminal.permissionTitle': 'Permission required',
    'terminal.toolTerminal': 'Command output',
    'terminal.toolCallFallback': 'Tool call',
    'terminal.role.user': 'You',
    'terminal.role.assistant': 'Agent',
    'terminal.role.thought': 'Thinking',
    'terminal.toolKind.read': 'Read',
    'terminal.toolKind.edit': 'Edit',
    'terminal.toolKind.delete': 'Delete',
    'terminal.toolKind.move': 'Move',
    'terminal.toolKind.search': 'Search',
    'terminal.toolKind.execute': 'Execute',
    'terminal.toolKind.think': 'Think',
    'terminal.toolKind.fetch': 'Fetch',
    'terminal.toolKind.switch_mode': 'Mode',
    'terminal.toolKind.other': 'Tool',
    'modal.title': 'Notice',
    'theme.toLight': 'Light mode',
    'theme.toLightAria': 'Switch to light mode',
    'theme.toDark': 'Dark mode',
    'theme.toDarkAria': 'Switch to dark mode',
    'chrome.openMenu': 'Open menu',
    'chrome.closeMenu': 'Close menu',
    'notifications.title': 'Notifications',
    'notifications.empty': 'No notifications right now.',
    'notifications.openAria': 'Open notifications panel',
    'toast.notice': 'Notice',
    'label.unknown': 'Unknown',
    'label.unreported': 'Unreported',
    'status.online': 'Online',
    'status.offline': 'Offline',
    'status.created': 'Created',
    'status.starting': 'Starting',
    'status.running': 'Running',
    'status.stopping': 'Stopping',
    'status.ended': 'Ended',
    'status.exited': 'Exited',
    'status.error': 'Error',
    'runner.summary': ({ online, offline, total, matched }) =>
      `Online ${online} · Offline ${offline} · Total ${total}${matched === undefined ? '' : ` · Matched ${matched}`}`,
    'runner.emptyMatched': 'No runners match the current filter.',
    'runner.empty': 'No runners are currently registered.',
    'runner.unsupportedTools': 'No tools reported',
    'runner.lastSeen': 'Last seen',
    'runner.absoluteTime': 'Absolute time',
    'session.noSupportedTool': 'This runner did not report any supported tools, so sessions cannot be created yet.',
    'detail.subline': ({ status, relative, absolute }) => `${status} · Last heartbeat ${relative} · ${absolute}`,
    'detail.capabilitySummary': ({ tools }) => `This runner supports ${tools} and can be used to create new sessions immediately.`,
    'detail.capabilitySummaryEmpty': 'This runner has not reported any supported tools.',
    'detail.sessionSummary': ({ total, active, matched }) =>
      `Total ${total} · Active ${active}${matched === undefined ? '' : ` · Matched ${matched}`}`,
    'detail.noSessionMatched': 'No sessions match the current filter.',
    'detail.noSession': 'No sessions yet. Create one above to get started.',
    'detail.metric.runnerId': 'Runner ID',
    'detail.metric.platform': 'Platform',
    'detail.metric.status': 'Connectivity',
    'detail.metric.lastHeartbeat': 'Last heartbeat',
    'detail.metric.activeSessions': 'Active sessions',
    'detail.metric.totalSessions': 'Total sessions',
    'session.idLabel': 'Session ID',
    'session.meta.created': 'Created',
    'session.meta.projectPath': 'Project path',
    'session.meta.runner': 'Runner',
    'session.createdByUnknown': 'Unknown user',
    'terminal.meta': ({ tool, sessionId, runner, status, connection, projectPath }) =>
      `${tool} Session ID: ${sessionId} · Runner: ${runner} · Status: ${status}${connection ? ` · ${connection}` : ''}${projectPath ? ` · Path: ${projectPath}` : ''}`,
    'terminal.connectionFailed': 'Session connection failed',
    'terminal.startFailedInline': ({ message }) => `[start session failed: ${message}]`,
    'terminal.status.connected': 'Connected',
    'terminal.status.connecting': 'Connecting',
    'terminal.status.disconnected': 'Disconnected',
    'terminal.status.error': 'Connection error',
    'notify.loginSuccessTitle': 'Signed in',
    'notify.loginSuccessMessage': ({ user }) => `Welcome back, ${user}.`,
    'notify.loginFailedTitle': 'Sign-in failed',
    'notify.loginTotpRequired': 'Enter the verification code to continue signing in.',
    'notify.loginUnknown': 'Sign-in failed',
    'notify.refreshRunnerFailedTitle': 'Failed to refresh runners',
    'notify.refreshRunnerDetailFailedTitle': 'Failed to load runner details',
    'notify.refreshFailed': 'Refresh failed',
    'notify.loadRunnerFailed': 'Failed to load runner details',
    'notify.createSessionTitle': 'Session created',
    'notify.createSessionMessage': ({ sessionId }) => `Session ID: ${sessionId}. Preparing the ACP stream now.`,
    'notify.createSessionInline': ({ sessionId }) => `Session created: ${sessionId}. Opening ACP session…`,
    'notify.createSessionFailedTitle': 'Failed to create session',
    'notify.quickStartFailedTitle': 'Quick start failed',
    'notify.createFailed': 'Creation failed',
    'notify.runnerOfflineTitle': 'Runner offline',
    'notify.runnerOfflineMessage': 'The current runner is offline, so the session cannot be opened.',
    'notify.offlineTitle': 'Device offline',
    'notify.offlineMessage': 'The network is unavailable. The ACP session view will stay in place and retry when connectivity returns.',
    'notify.onlineTitle': 'Back online',
    'notify.onlineMessage': 'Connectivity is restored. Refreshing the current view now.',
    'notify.sessionResumedTitle': 'Session restored',
    'notify.sessionResumedMessage': 'The ACP session connection has been re-established.',
    'notify.sessionResumeFailedTitle': 'Failed to restore session',
    'notify.startSessionFailedTitle': 'Failed to start session',
    'notify.stopRequestedTitle': 'Stop request sent',
    'notify.stopRequestedMessage': ({ sessionId }) => `Session ${sessionId} is stopping.`,
    'notify.stopFailedTitle': 'Failed to stop session',
    'notify.deleteSessionTitle': 'Delete session',
    'notify.deleteSessionBody': 'Deleting a session also removes the linked project. If it is still running, force delete will be used.',
    'notify.deleteSessionConfirm': 'Delete session',
    'notify.deleteSessionSuccessTitle': 'Session deleted',
    'notify.deleteSessionFailedTitle': 'Failed to delete session',
    'notify.deleteRunnerTitle': 'Delete runner',
    'notify.deleteRunnerBody': 'Offline runners are removed immediately. Online runners will use force delete and their sessions and projects will be cleaned up.',
    'notify.deleteRunnerSuccessInline': ({ runnerId }) => `Runner deleted: ${runnerId}`,
    'notify.deleteRunnerSuccessTitle': 'Runner deleted',
    'notify.deleteRunnerFailedTitle': 'Failed to delete runner',
    'notify.copyClaudeTitle': 'Claude resume command copied',
    'notify.copyGeminiTitle': 'Gemini launch command copied',
    'notify.copyFailedTitle': 'Copy failed',
    'notify.settingsCurrentUser': ({ user }) => `Current user: ${user}`,
    'notify.totpConfigured': 'Two-factor authentication is configured. Remove it first if you need to bind a new device.',
    'notify.totpNotConfigured': 'Two-factor authentication is not configured. Open /setup before using this console in a broader environment.',
    'notify.authSavedInline': 'Saved. Signing out the current session now.',
    'notify.authSavedTitle': 'Credentials updated',
    'notify.authSavedMessage': 'Sign in again to continue.',
    'notify.saveFailedTitle': 'Failed to save settings',
    'notify.disableTotpTitle': 'Remove two-factor authentication',
    'notify.disableTotpBody': 'Removing TOTP lowers console security. Confirm with the current password and verification code.',
    'notify.disableTotpConfirm': 'Remove TOTP',
    'notify.totpPasswordLabel': 'Current password',
    'notify.totpPasswordPlaceholder': 'Required',
    'notify.totpCodeLabel': 'Current verification code',
    'notify.totpCodePlaceholder': '6-digit code',
    'notify.incompleteTitle': 'Missing information',
    'notify.incompleteMessage': 'Both the current password and verification code are required.',
    'notify.totpDeletedInline': 'Two-factor authentication removed.',
    'notify.totpDeletedTitle': 'Two-factor authentication removed',
    'notify.totpDeletedMessage': 'Configure it again before production use.',
    'notify.disableTotpFailedTitle': 'Failed to remove two-factor authentication',
    'notify.actionUnsupported': 'Unsupported action',
    'risk.defaultTitle': 'Default credentials are still in use',
    'risk.defaultBody': 'The admin / agentmesh credentials have not been replaced. Update the username or password before exposing this console.',
    'risk.defaultAction': 'Update credentials',
    'risk.totpTitle': 'Two-factor authentication is incomplete',
    'risk.totpBody': 'This account has not completed TOTP enrollment yet. Finish /setup before broader use.',
    'risk.totpAction': 'Configure TOTP',
    'gemini.availableFallback': ({ command }) => `Gemini is available and will use the npx fallback (${command}).`,
    'gemini.availableEnv': ({ command }) => `Gemini is available and was overridden with AGENTMESH_GEMINI_CMD (${command}).`,
    'gemini.availableDirect': ({ command }) => `Gemini is available via ${command}.`,
    'gemini.unavailable': ({ reason }) => `Gemini is unavailable: ${reason}. Install Gemini CLI or set AGENTMESH_GEMINI_CMD.`,
    'time.unknown': '-',
    'theme.toggleFallback': 'Toggle theme',
  },
};

const state = {
  view: 'login',
  returnView: 'runnerDetail',
  auth: {
    authenticated: false,
    user: '',
    csrfToken: '',
    expiresAt: 0,
  },
  authMeta: null,
  settingsData: null,
  runnersAll: [],
  workspaceSessions: [],
  runnerSummary: { total: 0, online: 0, offline: 0, returned: 0 },
  sessionSummary: { total: 0, active: 0 },
  selectedRunnerId: '',
  runnerDetail: null,
  activeSession: null,
  autoRefreshTimer: null,
  eventSource: null,
  eventRetryTimer: null,
  eventRetryAttempt: 0,
  liveRefreshRunning: false,
  liveRefreshQueued: false,
  notifications: [],
  terminalConnection: 'disconnected',
  networkOnline: navigator.onLine !== false,
  terminalReconnectPending: false,
  mobileChromeOpen: false,
};

let currentTheme = THEME_LIGHT;
let currentLanguage = LANG_ZH;
let currentTerminalPalette = TERM_PALETTE_NOIR;
let modalResolve = null;
let modalPreviousFocus = null;

const terminal = createTerminalController({
  $,
  api,
  t,
  getTheme: () => currentTheme,
  getPalette: () => currentTerminalPalette,
  getLanguage: () => currentLanguage,
  translateError: localizeErrorText,
  onStatusChange: (status) => {
    state.terminalConnection = String(status || 'disconnected');
    if (status === 'connected' && state.activeSession) {
      state.activeSession.status = 'running';
    }
    if (status === 'connected' && state.terminalReconnectPending) {
      state.terminalReconnectPending = false;
      notify({
        type: 'success',
        title: t('notify.sessionResumedTitle'),
        message: t('notify.sessionResumedMessage'),
        ttl: 2600,
      });
    }
    if (state.activeSession) updateTerminalHeader(state.activeSession);
  },
  onError: (message) => notify({
    type: 'error',
    title: t('terminal.connectionFailed'),
    message,
  }),
});

function escapeHtml(raw) {
  return String(raw ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function localeTag(lang = currentLanguage) {
  return lang === LANG_EN ? 'en-US' : 'zh-CN';
}

function t(key, params = {}) {
  const table = MESSAGES[currentLanguage] || MESSAGES[LANG_EN];
  let value = table[key];
  if (value === undefined) value = MESSAGES[LANG_EN][key];
  if (value === undefined) return key;
  if (typeof value === 'function') return String(value(params));
  return String(value).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

function readThemePreference() {
  try {
    const stored = String(localStorage.getItem(THEME_STORAGE_KEY) || '').toLowerCase();
    if (stored === THEME_LIGHT || stored === THEME_DARK) return stored;
  } catch { }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return THEME_DARK;
  return THEME_LIGHT;
}

function readLanguagePreference() {
  try {
    const stored = String(localStorage.getItem(LANG_STORAGE_KEY) || '').toLowerCase();
    if (stored === LANG_ZH || stored === LANG_EN) return stored;
  } catch { }
  const docLang = String(document.documentElement.getAttribute('lang') || '').toLowerCase();
  return docLang.startsWith('en') ? LANG_EN : LANG_ZH;
}

function readTerminalPalettePreference() {
  try {
    const stored = String(localStorage.getItem(TERM_PALETTE_STORAGE_KEY) || '').toLowerCase();
    if (TERM_PALETTES.includes(stored)) return stored;
    if (stored === 'dark') return TERM_PALETTE_NOIR;
    if (stored === 'light') return TERM_PALETTE_PAPER;
    if (stored === 'solarized') return TERM_PALETTE_SOLARIZED_DARK;
  } catch { }
  return TERM_PALETTE_NOIR;
}

let viewportSyncRaf = 0;

function syncViewportMetrics() {
  viewportSyncRaf = 0;
  const root = document.documentElement;
  const layoutHeight = Math.round(window.innerHeight || root.clientHeight || 0);
  const visualViewport = window.visualViewport || null;
  const visualHeight = Math.round(visualViewport ? visualViewport.height : layoutHeight);
  const visualOffsetTop = Math.round(visualViewport ? visualViewport.offsetTop : 0);
  const visibleHeight = Math.max(0, visualHeight + visualOffsetTop);
  const keyboardInset = Math.max(0, layoutHeight - visibleHeight);

  root.style.setProperty('--app-height', `${layoutHeight}px`);
  root.style.setProperty('--visual-viewport-height', `${Math.max(visualHeight, visibleHeight)}px`);
  root.style.setProperty('--keyboard-inset', `${keyboardInset}px`);
}

function scheduleViewportMetricsSync() {
  if (viewportSyncRaf) return;
  viewportSyncRaf = window.requestAnimationFrame(syncViewportMetrics);
}

async function resumeVisibleView() {
  if (!state.auth.authenticated || document.visibilityState === 'hidden') return;
  if (!state.networkOnline) return;

  if (state.view === 'terminal' && state.activeSession) {
    if (state.terminalConnection !== 'connected') {
      state.terminalReconnectPending = true;
      try {
        await terminal.resume();
      } catch (error) {
        state.terminalReconnectPending = false;
        notify({
          type: 'error',
          title: t('notify.sessionResumeFailedTitle'),
          message: localizeErrorText(String((error && error.message) || error || t('label.unknown'))),
        });
      }
    }
    return;
  }

  if (state.view === 'runnerDetail') {
    await refreshRunnerDetail(false).catch(() => undefined);
    return;
  }

  if (state.view === 'workspace') {
    await refreshRunnerList(false).catch(() => undefined);
  }
}

function handleNetworkStatusChange(nextOnline) {
  const online = nextOnline !== false;
  if (state.networkOnline === online) return;
  state.networkOnline = online;
  terminal.setNetworkStatus(online);

  if (!state.auth.authenticated) return;

  if (!online) {
    notify({
      type: 'warn',
      title: t('notify.offlineTitle'),
      message: t('notify.offlineMessage'),
      ttl: 4200,
    });
    return;
  }

  notify({
    type: 'success',
    title: t('notify.onlineTitle'),
    message: t('notify.onlineMessage'),
    ttl: 2400,
  });
  void resumeVisibleView();
}

function updateLanguageToggle() {
  const zh = $('btnLangZh');
  const en = $('btnLangEn');
  if (zh) {
    const active = currentLanguage === LANG_ZH;
    zh.classList.toggle('active', active);
    zh.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  if (en) {
    const active = currentLanguage === LANG_EN;
    en.classList.toggle('active', active);
    en.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function refreshThemeToggle(theme) {
  const btn = $('btnThemeToggle');
  if (!btn) return;
  const dark = theme === THEME_DARK;
  btn.setAttribute('aria-label', dark ? t('theme.toLightAria') : t('theme.toDarkAria'));
  btn.title = dark ? t('theme.toLightAria') : t('theme.toDarkAria');
  btn.setAttribute('data-next-theme', dark ? THEME_LIGHT : THEME_DARK);
}

function updateTerminalPaletteToggle() {
  const button = $('btnTermPalette');
  if (button) button.title = t(TERMINAL_PALETTE_PRESETS.find((item) => item.id === currentTerminalPalette)?.labelKey || 'terminal.themeButton');
  const panel = $('termPalettePanel');
  if (!panel) return;
  for (const card of panel.querySelectorAll('[data-term-palette]')) {
    const active = card.getAttribute('data-term-palette') === currentTerminalPalette;
    card.classList.toggle('active', active);
    card.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function renderTerminalPalettePanel() {
  const panel = $('termPalettePanel');
  if (!panel) return;
  panel.innerHTML = TERMINAL_PALETTE_PRESETS.map((item) => `
    <button
      class="terminal-theme-option${item.id === currentTerminalPalette ? ' active' : ''}"
      type="button"
      data-term-palette="${escapeHtml(item.id)}"
      aria-pressed="${item.id === currentTerminalPalette ? 'true' : 'false'}"
      style="--preview-bg:${item.background};--preview-fg:${item.foreground};--preview-accent:${item.accent};"
    >
      <span class="terminal-theme-preview" aria-hidden="true">
        <span class="terminal-theme-preview-bar"></span>
        <span class="terminal-theme-preview-line short"></span>
        <span class="terminal-theme-preview-line"></span>
        <span class="terminal-theme-preview-line tiny accent"></span>
      </span>
      <span class="terminal-theme-name">${escapeHtml(t(item.labelKey))}</span>
    </button>
  `).join('');
}

function closeTermPalettePanel() {
  const panel = $('termPalettePanel');
  const button = $('btnTermPalette');
  if (!panel || !button) return;
  panel.classList.add('hidden');
  button.setAttribute('aria-expanded', 'false');
}

function setTermPalettePanelOpen(open) {
  const panel = $('termPalettePanel');
  const button = $('btnTermPalette');
  if (!panel || !button || state.view !== 'terminal') return;
  const next = !!open;
  panel.classList.toggle('hidden', !next);
  button.setAttribute('aria-expanded', next ? 'true' : 'false');
}

function isMobileChromeViewport() {
  return !!(window.matchMedia && window.matchMedia('(max-width: 820px)').matches);
}

function syncMobileChromeState() {
  const toggle = $('btnMobileChromeToggle');
  const topbar = $('authTopbar');
  const authenticated = state.auth.authenticated && state.view !== 'login';
  const mobile = isMobileChromeViewport();
  if (toggle) {
    toggle.classList.toggle('hidden', !(authenticated && mobile));
    toggle.setAttribute('aria-expanded', state.mobileChromeOpen ? 'true' : 'false');
    toggle.title = state.mobileChromeOpen ? t('chrome.closeMenu') : t('chrome.openMenu');
    toggle.setAttribute('aria-label', state.mobileChromeOpen ? t('chrome.closeMenu') : t('chrome.openMenu'));
  }
  if (!topbar) return;
  topbar.classList.toggle('mobile-collapsed', !!(authenticated && mobile && !state.mobileChromeOpen));
}

function applyStaticTranslations() {
  document.documentElement.lang = currentLanguage === LANG_EN ? 'en' : 'zh-CN';
  document.title = 'AgentMesh';
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', t('app.description'));

  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    if (key) node.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    const key = node.getAttribute('data-i18n-placeholder');
    if (key) node.setAttribute('placeholder', t(key));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
    const key = node.getAttribute('data-i18n-aria-label');
    if (!key) return;
    const value = t(key);
    node.setAttribute('aria-label', value);
    if (node.classList.contains('icon-button')) node.setAttribute('title', value);
  });

  refreshThemeToggle(currentTheme);
  renderTerminalPalettePanel();
  updateLanguageToggle();
  updateTerminalPaletteToggle();
  syncMobileChromeState();
}

function applyLanguage(lang, persist = true) {
  currentLanguage = lang === LANG_EN ? LANG_EN : LANG_ZH;
  applyStaticTranslations();
  setAuth(state.authMeta || state.auth);
  setLoginTotpMode(!$('authTotpField').classList.contains('hidden'));
  refreshNotifications(state.authMeta);
  if (state.settingsData) renderSettings(state.settingsData);
  renderWorkspaceHome();
  if (state.runnersAll.length || state.view === 'workspace') renderRunnerList();
  if (state.runnerDetail) renderRunnerDetail();
  if (state.activeSession) updateTerminalHeader(state.activeSession);
  terminal.refreshCopy();
  if (!persist) return;
  try { localStorage.setItem(LANG_STORAGE_KEY, currentLanguage); } catch { }
}

function applyTheme(theme, persist = true) {
  const next = theme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
  currentTheme = next;
  const root = document.documentElement;
  if (root) {
    if (next === THEME_DARK) root.setAttribute('data-theme', THEME_DARK);
    else root.setAttribute('data-theme', THEME_LIGHT);
  }
  refreshThemeToggle(next);
  terminal.setTheme();
  if (!persist) return;
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { }
}

function applyTerminalPalette(palette, persist = true) {
  const next = TERM_PALETTES.includes(palette) ? palette : TERM_PALETTE_NOIR;
  currentTerminalPalette = next;
  updateTerminalPaletteToggle();
  terminal.setPalette();
  closeTermPalettePanel();
  if (!persist) return;
  try { localStorage.setItem(TERM_PALETTE_STORAGE_KEY, next); } catch { }
}

function toggleTheme() {
  applyTheme(currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK, true);
}

function notify({ type = 'info', title = '', message = '', ttl = 3600 }) {
  const stack = $('toastStack');
  if (!stack) return;
  const toast = document.createElement('article');
  toast.className = 'toast ' + type;
  toast.innerHTML = `<strong>${escapeHtml(title || t('toast.notice'))}</strong><span>${escapeHtml(message)}</span>`;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, ttl);
}

async function registerPwaWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch {
    // Ignore service worker registration failures in non-PWA contexts.
  }
}

function localizeStatus(status) {
  const key = 'status.' + String(status || '').toLowerCase();
  const value = t(key);
  return value === key ? String(status || t('label.unknown')) : value;
}

function localizeErrorText(raw) {
  const message = String(raw || '').trim();
  if (!message || currentLanguage === LANG_EN) return message;

  const exact = {
    'invalid password': '当前密码不正确',
    'username too short': '用户名太短',
    'password too short (min 12)': '密码太短，至少需要 12 位',
    'no changes provided': '没有提供任何修改内容',
    'invalid totp': '动态码不正确',
    'invalid credentials': '用户名或密码不正确',
    'too many login attempts, please retry later': '登录尝试次数过多，请稍后再试',
    unauthorized: '未授权，请重新登录',
    forbidden: '无权执行该操作',
    'csrf mismatch': '请求校验失败，请刷新页面后重试',
    'token is required': '缺少 enroll token',
    'invalid enroll token': 'enroll token 无效',
    'enroll token expired': 'enroll token 已过期',
    'runner not found': '节点不存在',
    'runner offline': '节点当前离线',
    'runner reports no supported tools': '节点未上报可用工具',
    'tool must be codex|claude|gemini': '工具必须是 codex、claude 或 gemini',
    'projectId and tool are required': '缺少 projectId 或 tool',
    'project not found': '项目不存在',
    'runnerId is required (or bind project.runnerId first)': '缺少 runnerId，或项目尚未绑定 runnerId',
    'session not found': '会话不存在',
    'empty prompt': '输入不能为空',
    'permission request not found': '授权请求不存在或已处理',
    'session already stopping': '会话已在停止中',
    'session is active; use force=1 to delete': '会话仍在活动中，请使用 force=1 删除',
    'ws send failed': '向 Runner 发送指令失败',
    'copy failed': '复制失败',
    'empty text': '没有可复制的内容',
    'runner ws busy; retry': 'Runner WebSocket 正忙，请稍后重试',
    'not available': '当前不可用',
    'setup disabled': 'Setup 已禁用',
    'already provisioned': '当前账户已完成绑定',
    'missing secret; refresh /setup': '缺少密钥，请刷新 /setup 页面后重试',
    'totp not configured': '尚未配置 TOTP',
    'asset not found': '资源不存在',
    'gemini binary not found; using npx @google/gemini-cli fallback': '未检测到 Gemini CLI，仅存在 npx fallback',
    'gemini binary not found and npx is unavailable': '未检测到 Gemini CLI，且 npx 也不可用',
  };
  if (exact[message]) return exact[message];

  let match = message.match(/^session already (.+)$/i);
  if (match) return `会话已处于${localizeStatus(match[1])}状态`;
  match = message.match(/^cannot stop session in status (.+)$/i);
  if (match) return `当前状态为${localizeStatus(match[1])}，无法停止会话`;
  match = message.match(/^cannot cancel session in status (.+)$/i);
  if (match) return `当前状态为${localizeStatus(match[1])}，无法停止本轮`;
  match = message.match(/^project path not found: (.+)$/i);
  if (match) return `项目路径不存在：${match[1]}`;
  match = message.match(/^project path is not a directory: (.+)$/i);
  if (match) return `项目路径不是目录：${match[1]}`;
  match = message.match(/^project path is not accessible: (.+)$/i);
  if (match) return `项目路径不可访问：${match[1]}`;
  match = message.match(/^command not found: (.+)$/i);
  if (match) return `未找到命令：${match[1]}`;

  return message;
}

function setInlineFeedback(id, message = '', kind = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = String(message || '');
  el.classList.toggle('error', kind === 'error');
}

function modalHide() {
  $('modalMask').classList.add('hidden');
  $('modalTitle').textContent = '';
  $('modalBody').textContent = '';
  $('modalFields').innerHTML = '';
  $('modalOk').onclick = null;
  $('modalCancel').onclick = null;
  modalResolve = null;
  const previous = modalPreviousFocus;
  modalPreviousFocus = null;
  if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
    try { previous.focus(); } catch { }
  }
}

function modalCancelActive() {
  const done = modalResolve;
  modalHide();
  if (done) done({ confirmed: false, values: {} });
}

function handleModalKeydown(ev) {
  const mask = $('modalMask');
  if (!mask || mask.classList.contains('hidden')) return;
  if (ev.key === 'Escape') {
    ev.preventDefault();
    modalCancelActive();
    return;
  }
  if (ev.key !== 'Tab') return;
  const card = mask.querySelector('.modal-card');
  if (!card) return;
  const focusable = Array.from(card.querySelectorAll('input, select, textarea, button'))
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
}

function modalShow(opts = {}) {
  if (modalResolve) modalCancelActive();
  return new Promise((resolve) => {
    modalResolve = resolve;
    modalPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const title = opts.title ? String(opts.title) : t('modal.title');
    const body = opts.body ? String(opts.body) : '';
    const okText = opts.okText ? String(opts.okText) : t('button.confirm');
    const cancelText = opts.cancelText ? String(opts.cancelText) : t('button.cancel');
    const fields = Array.isArray(opts.fields) ? opts.fields : [];
    const values = {};

    $('modalTitle').textContent = title;
    $('modalBody').textContent = body;
    $('modalFields').innerHTML = '';
    $('modalOk').textContent = okText;
    $('modalCancel').textContent = cancelText;
    $('modalOk').className = 'button ' + (opts.destructive ? 'danger' : 'primary');

    for (const field of fields) {
      const wrap = document.createElement('label');
      wrap.className = 'field';
      const label = document.createElement('span');
      label.textContent = field.label || '';
      const input = document.createElement('input');
      input.placeholder = field.placeholder || '';
      if (field.type) input.type = field.type;
      if (field.inputmode) input.setAttribute('inputmode', field.inputmode);
      if (field.autocomplete) input.setAttribute('autocomplete', field.autocomplete);
      input.addEventListener('input', () => {
        values[field.key] = input.value;
      });
      values[field.key] = '';
      wrap.appendChild(label);
      wrap.appendChild(input);
      $('modalFields').appendChild(wrap);
    }

    $('modalCancel').onclick = () => {
      const done = modalResolve;
      modalHide();
      if (done) done({ confirmed: false, values });
    };

    $('modalOk').onclick = () => {
      const done = modalResolve;
      modalHide();
      if (done) done({ confirmed: true, values });
    };

    $('modalMask').classList.remove('hidden');
    const firstInput = $('modalFields').querySelector('input');
    const focusTarget = firstInput || $('modalOk');
    setTimeout(() => {
      try { focusTarget.focus(); } catch { }
    }, 0);
  });
}

function toolLabel(tool) {
  const normalized = String(tool || '').toLowerCase();
  if (normalized === 'codex') return 'Codex';
  if (normalized === 'claude') return 'Claude';
  if (normalized === 'gemini') return 'Gemini';
  return String(tool || t('label.unknown'));
}

function formatDateTime(ts) {
  const value = Number(ts || 0);
  if (!value) return t('time.unknown');
  try {
    return new Date(value).toLocaleString(localeTag(currentLanguage), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return t('time.unknown');
  }
}

function formatRelativeTime(ts) {
  const value = Number(ts || 0);
  if (!value) return t('time.unknown');
  const diffSeconds = Math.round((value - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(localeTag(currentLanguage), { numeric: 'auto' });
  if (Math.abs(diffSeconds) < 60) return rtf.format(diffSeconds, 'second');
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
}

function runnerPlatformLabel(runner) {
  const platform = runner && runner.capabilities && runner.capabilities.platform;
  const os = platform && typeof platform.os === 'string' ? platform.os : '';
  const arch = platform && typeof platform.arch === 'string' ? platform.arch : '';
  const parts = [os, arch].filter(Boolean);
  return parts.length ? parts.join(' / ') : t('label.unreported');
}

function normalizeSearch(raw) {
  return String(raw || '').trim().toLowerCase();
}

function shellQuoteSingle(raw) {
  return "'" + String(raw || '').replace(/'/g, "'\\''") + "'";
}

function buildClaudeResumeCommand(session) {
  if (!session || String(session.tool || '').toLowerCase() !== 'claude') return '';
  const sessionId = String(session.id || '').trim();
  if (!sessionId) return '';
  const projectPath = typeof session.projectPath === 'string' ? session.projectPath.trim() : '';
  if (!projectPath) return 'claude --resume ' + sessionId;
  return 'cd ' + shellQuoteSingle(projectPath) + ' && claude --resume ' + sessionId;
}

function toolDetailsFromCapabilities(capabilities) {
  const raw = capabilities && capabilities.toolDetails && typeof capabilities.toolDetails === 'object'
    ? capabilities.toolDetails
    : {};
  const details = {};
  for (const tool of TOOL_ORDER) {
    const item = raw[tool];
    if (!item || typeof item !== 'object') continue;
    details[tool] = {
      command: typeof item.command === 'string' ? item.command : '',
      source: typeof item.source === 'string' ? item.source : '',
      available: item.available === true,
      reason: typeof item.reason === 'string' ? item.reason : '',
    };
  }
  return details;
}

function getRunnerToolDetail(runner, tool) {
  const toolName = String(tool || '').toLowerCase();
  if (!TOOL_ORDER.includes(toolName)) return null;
  const details = toolDetailsFromCapabilities(runner && runner.capabilities);
  return details[toolName] || null;
}

function buildGeminiLaunchCommand(session, runner) {
  if (!session || String(session.tool || '').toLowerCase() !== 'gemini') return '';
  const detail = getRunnerToolDetail(runner, 'gemini');
  const command = detail && detail.command ? detail.command : 'gemini';
  const projectPath = typeof session.projectPath === 'string' ? session.projectPath.trim() : '';
  if (!projectPath) return command;
  return 'cd ' + shellQuoteSingle(projectPath) + ' && ' + command;
}

function buildGeminiDiagnosticText(runner) {
  const detail = getRunnerToolDetail(runner, 'gemini');
  if (!detail) return '';
  if (detail.available) {
    if (detail.source === 'fallback') return t('gemini.availableFallback', { command: detail.command });
    if (detail.source === 'env') return t('gemini.availableEnv', { command: detail.command });
    return t('gemini.availableDirect', { command: detail.command });
  }
  const reason = detail.reason ? localizeErrorText(detail.reason) : t('label.unreported');
  return t('gemini.unavailable', { reason });
}

function runnerSupportedTools(runner) {
  const fromRunner = Array.isArray(runner && runner.supportedTools) ? runner.supportedTools : null;
  if (fromRunner) {
    const set = new Set(fromRunner.map((x) => String(x || '').toLowerCase()));
    return TOOL_ORDER.filter((tool) => set.has(tool));
  }
  const rawTools = runner && runner.capabilities && runner.capabilities.tools;
  if (!rawTools || typeof rawTools !== 'object') return ['codex', 'claude'];
  return TOOL_ORDER.filter((tool) => rawTools[tool] === true);
}

function runnerAvailableTools(runner) {
  const details = toolDetailsFromCapabilities(runner && runner.capabilities);
  const detailKeys = TOOL_ORDER.filter((tool) => details[tool]);
  if (!detailKeys.length) return runnerSupportedTools(runner);
  return TOOL_ORDER.filter((tool) => details[tool] && details[tool].available === true);
}

function runnerToolStates(runner) {
  const supported = new Set(runnerSupportedTools(runner));
  const available = new Set(runnerAvailableTools(runner));
  return TOOL_ORDER.map((tool) => {
    const detail = getRunnerToolDetail(runner, tool);
    const isAvailable = available.has(tool);
    const isSupported = supported.has(tool);
    return {
      tool,
      available: isAvailable,
      supported: isSupported,
      fallback: !!(detail && detail.available === true && detail.source === 'fallback'),
      reason: detail && detail.reason ? localizeErrorText(detail.reason) : '',
    };
  });
}

function runnerDisplayName(runnerId) {
  const current = state.runnerDetail && state.runnerDetail.runner;
  if (current && current.id === runnerId) return current.name || current.id || t('label.unreported');
  const match = state.runnersAll.find((runner) => runner.id === runnerId);
  if (match) return match.name || match.id || t('label.unreported');
  return runnerId || t('label.unreported');
}

function runnerProjectPathOptions(detail) {
  const sessions = detail && Array.isArray(detail.sessions) ? detail.sessions : [];
  const seen = new Set();
  const options = [];
  for (const session of sessions) {
    const projectPath = typeof session.projectPath === 'string' ? session.projectPath.trim() : '';
    if (!projectPath || seen.has(projectPath)) continue;
    seen.add(projectPath);
    options.push(projectPath);
  }
  return options;
}

function runnerMatchesSearch(runner, query) {
  if (!query) return true;
  const name = String(runner && runner.name ? runner.name : '').toLowerCase();
  const id = String(runner && runner.id ? runner.id : '').toLowerCase();
  const tools = runnerSupportedTools(runner).join(' ');
  const status = runner && runner.online ? 'online 在线' : 'offline 离线';
  const geminiDetail = getRunnerToolDetail(runner, 'gemini');
  const geminiHint = [
    geminiDetail && geminiDetail.command,
    geminiDetail && geminiDetail.source,
    geminiDetail && geminiDetail.reason,
  ].filter(Boolean).join(' ').toLowerCase();
  return [name, id, tools, status, geminiHint].some((item) => item.includes(query));
}

function sessionMatchesSearch(session, query) {
  if (!query) return true;
  const values = [
    session && session.id,
    session && session.tool,
    session && session.status,
    session && session.projectPath,
    session && session.createdBy,
  ].map((value) => String(value || '').toLowerCase());
  return values.some((value) => value.includes(query));
}

async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) throw new Error('empty text');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', 'readonly');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(input);
  if (!copied) throw new Error('copy failed');
}

function setAuth(authPayload) {
  state.auth.authenticated = !!(authPayload && authPayload.authenticated);
  state.auth.user = authPayload && authPayload.user ? authPayload.user : '';
  state.auth.csrfToken = authPayload && authPayload.csrfToken ? authPayload.csrfToken : '';
  state.auth.expiresAt = Number(authPayload && authPayload.expiresAt ? authPayload.expiresAt : 0);
  $('authBadge').textContent = state.auth.authenticated
    ? t('auth.signedIn', { user: state.auth.user })
    : t('auth.signedOut');
  renderAuthenticatedChrome();
}

function setLoginTotpMode(enabled) {
  const on = !!enabled;
  $('authTotpField').classList.toggle('hidden', !on);
  if ($('loginFootnote')) $('loginFootnote').classList.toggle('hidden', !on);
  if (!on) $('authTotp').value = '';
  $('btnLogin').textContent = on ? t('button.verifyAndLogin') : t('button.login');
}

function resetAuth() {
  terminal.disconnect(true);
  closeEventStream();
  if (state.autoRefreshTimer) {
    clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
  setAuth({ authenticated: false, user: '', csrfToken: '', expiresAt: 0 });
  state.authMeta = null;
  state.settingsData = null;
  state.runnersAll = [];
  state.workspaceSessions = [];
  state.runnerSummary = { total: 0, online: 0, offline: 0, returned: 0 };
  state.sessionSummary = { total: 0, active: 0 };
  state.runnerDetail = null;
  state.selectedRunnerId = '';
  state.activeSession = null;
  state.terminalConnection = 'disconnected';
  state.mobileChromeOpen = false;
  setLoginTotpMode(false);
  setInlineFeedback('loginError', '', '');
  setSummaryTiles();
  renderWorkspaceHome();
  state.notifications = [];
  renderNotifications();
  closeTermPalettePanel();
  syncMobileChromeState();
}

async function api(method, path, body) {
  const m = String(method || 'GET').toUpperCase();
  const headers = {};
  const hasBody = body !== undefined && body !== null;
  if (hasBody) headers['Content-Type'] = 'application/json';
  if ((m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') && state.auth.csrfToken) {
    headers['X-AgentMesh-CSRF'] = state.auth.csrfToken;
  }

  const res = await fetch(path, {
    method: m,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }

  if (!res.ok) {
    const error = Object.assign(new Error('HTTP ' + res.status), { status: res.status, data });
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      resetAuth();
      showView('login');
    }
    throw error;
  }

  return data;
}

function setSummaryTiles() {
  if ($('statOnline')) $('statOnline').textContent = String(state.runnerSummary.online || 0);
  if ($('statOffline')) $('statOffline').textContent = String(state.runnerSummary.offline || 0);
  if ($('statSessions')) $('statSessions').textContent = String(state.sessionSummary.total || 0);
  if ($('statActiveSessions')) $('statActiveSessions').textContent = String(state.sessionSummary.active || 0);
}

function closeNotificationPanel() {
  const panel = $('notificationPanel');
  const button = $('btnNotifications');
  if (!panel || !button) return;
  panel.classList.add('hidden');
  button.setAttribute('aria-expanded', 'false');
}

function setNotificationPanelOpen(open) {
  const panel = $('notificationPanel');
  const button = $('btnNotifications');
  if (!panel || !button || !state.auth.authenticated) return;
  const next = !!open;
  panel.classList.toggle('hidden', !next);
  button.setAttribute('aria-expanded', next ? 'true' : 'false');
}

async function handleNotificationAction(action) {
  closeNotificationPanel();
  if (action === 'setup') {
    location.href = '/setup';
    return;
  }
  if (action === 'settings') {
    showView('settings');
    try { await refreshSettings(); } catch { }
  }
}

function buildNotifications(authPayload) {
  if (!authPayload || !authPayload.authenticated) return [];
  const items = [];
  if (authPayload.security && authPayload.security.defaultPassword) {
    items.push({
      id: 'default-credentials',
      title: t('risk.defaultTitle'),
      body: t('risk.defaultBody'),
      action: 'settings',
      actionLabel: t('risk.defaultAction'),
    });
  }
  if (authPayload.totpEnabled === false || authPayload.totpProvisioned === false) {
    items.push({
      id: 'totp-setup',
      title: t('risk.totpTitle'),
      body: t('risk.totpBody'),
      action: 'setup',
      actionLabel: t('risk.totpAction'),
    });
  }
  return items;
}

function renderNotifications() {
  const button = $('btnNotifications');
  const count = $('notificationCount');
  const list = $('notificationList');
  if (!button || !count || !list) return;

  if (!state.auth.authenticated) {
    button.classList.add('hidden');
    count.classList.add('hidden');
    count.textContent = '0';
    list.innerHTML = '';
    closeNotificationPanel();
    return;
  }

  button.classList.remove('hidden');
  const total = state.notifications.length;
  count.textContent = String(total);
  count.classList.toggle('hidden', total < 1);

  if (!total) {
    list.innerHTML = `<div class="notification-empty">${escapeHtml(t('notifications.empty'))}</div>`;
    return;
  }

  list.innerHTML = state.notifications.map((item) => `
    <article class="notification-item">
      <div class="notification-item-head">
        <strong class="notification-item-title">${escapeHtml(item.title)}</strong>
      </div>
      <div class="notification-item-body">${escapeHtml(item.body)}</div>
      ${item.action ? `<div class="action-row"><button class="button primary" data-notification-action="${escapeHtml(item.action)}" type="button">${escapeHtml(item.actionLabel)}</button></div>` : ''}
    </article>
  `).join('');
}

function refreshNotifications(authPayload = state.authMeta) {
  state.notifications = buildNotifications(authPayload);
  renderNotifications();
}

function renderAuthenticatedChrome() {
  const authenticated = state.auth.authenticated && state.view !== 'login';
  $('authTopbar').classList.toggle('hidden', !authenticated);
  $('btnLogout').classList.toggle('hidden', !authenticated);

  const viewMap = {
    workspace: ['workspaceCopy', 'workspaceActions'],
    settings: ['settingsCopy', 'settingsActions'],
    runnerDetail: ['detailCopy', 'detailActions'],
    terminal: ['terminalCopyBlock', 'terminalActions'],
  };

  for (const [viewName, ids] of Object.entries(viewMap)) {
    const active = authenticated && state.view === viewName;
    $(ids[0]).classList.toggle('hidden', !active);
    $(ids[1]).classList.toggle('hidden', !active);
  }

  if (!authenticated || state.view !== 'terminal') closeTermPalettePanel();
  if (!authenticated) closeNotificationPanel();
  syncMobileChromeState();
}

function showView(next) {
  state.view = next;
  if (isMobileChromeViewport()) state.mobileChromeOpen = false;
  $('loginView').classList.toggle('hidden', next !== 'login');
  $('workspaceView').classList.toggle('hidden', next !== 'workspace');
  $('settingsView').classList.toggle('hidden', next !== 'settings');
  $('runnerDetailView').classList.toggle('hidden', next !== 'runnerDetail');
  $('terminalView').classList.toggle('hidden', next !== 'terminal');
  document.body.classList.toggle('terminal-active', next === 'terminal');
  terminal.setActive(next === 'terminal');
  closeNotificationPanel();
  renderAuthenticatedChrome();
  ensureAutoRefresh();
}

function closeEventStream(resetRetry = true) {
  if (state.eventRetryTimer) {
    clearTimeout(state.eventRetryTimer);
    state.eventRetryTimer = null;
  }
  if (resetRetry) state.eventRetryAttempt = 0;
  if (state.eventSource) {
    try { state.eventSource.close(); } catch { }
    state.eventSource = null;
  }
}

function scheduleEventStreamReconnect() {
  if (!state.auth.authenticated || state.view === 'terminal' || state.view === 'settings') return;
  if (state.eventRetryTimer) return;
  const delay = Math.min(15000, Math.max(600, 600 * (2 ** state.eventRetryAttempt)));
  state.eventRetryAttempt += 1;
  state.eventRetryTimer = setTimeout(() => {
    state.eventRetryTimer = null;
    ensureEventStream();
  }, delay);
}

async function queueLiveRefresh() {
  if (state.liveRefreshRunning) {
    state.liveRefreshQueued = true;
    return;
  }
  state.liveRefreshRunning = true;
  try {
    if (state.view === 'workspace') {
      await refreshRunnerList(false);
    } else if (state.view === 'runnerDetail' && state.selectedRunnerId) {
      await refreshRunnerDetail(false);
    }
  } finally {
    state.liveRefreshRunning = false;
    if (state.liveRefreshQueued) {
      state.liveRefreshQueued = false;
      queueLiveRefresh().catch(() => { });
    }
  }
}

function ensureEventStream() {
  if (!state.auth.authenticated || state.view === 'terminal' || state.view === 'settings') {
    closeEventStream();
    return;
  }
  if (state.eventSource) return;
  if (typeof EventSource === 'undefined') return;

  const es = new EventSource('/api/events/stream');
  state.eventSource = es;
  const onData = () => {
    state.eventRetryAttempt = 0;
    queueLiveRefresh().catch(() => { });
  };
  es.addEventListener('connected', onData);
  es.addEventListener('update', onData);
  es.onerror = () => {
    closeEventStream(false);
    scheduleEventStreamReconnect();
  };
}

function ensureAutoRefresh() {
  if (state.autoRefreshTimer) {
    clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
  if (!state.auth.authenticated || state.view === 'terminal' || state.view === 'settings') {
    closeEventStream();
    return;
  }
  if (typeof EventSource !== 'undefined') {
    ensureEventStream();
    return;
  }
  state.autoRefreshTimer = setInterval(() => {
    queueLiveRefresh().catch(() => { });
  }, 6000);
}

function quickStartToolForRunner(runner) {
  const available = runnerAvailableTools(runner);
  if (available.includes('codex')) return 'codex';
  return available[0] || '';
}

function recentWorkspaceSessions(limit = 3) {
  return [...(state.workspaceSessions || [])]
    .sort((a, b) => Number(b.startedAt || b.createdAt || 0) - Number(a.startedAt || a.createdAt || 0))
    .slice(0, limit);
}

function renderWorkspaceHome() {
  const metrics = $('workspaceLaunchMetrics');
  const actions = $('workspacePrimaryActions');
  const recentSection = $('workspaceRecentSection');
  const recentHost = $('workspaceRecentSessions');
  if (!metrics || !actions || !recentSection || !recentHost) return;

  const onlineRunners = state.runnersAll.filter((runner) => runner.online);
  const supportedTools = new Set();
  for (const runner of onlineRunners) {
    for (const tool of runnerAvailableTools(runner)) supportedTools.add(tool);
  }

  metrics.innerHTML = [
    [t('workspace.metric.online'), String(onlineRunners.length || 0)],
    [t('workspace.metric.active'), String(state.sessionSummary.active || 0)],
    [t('workspace.metric.tools'), String(supportedTools.size || 0)],
  ].map(([label, value]) => `
    <div class="workspace-launch-metric">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `).join('');

  const recent = recentWorkspaceSessions(3);
  const primaryRunner = onlineRunners[0] || null;
  actions.innerHTML = `
    ${recent[0] ? `<button class="button primary" data-action="resume-recent-session" data-session-id="${escapeHtml(recent[0].id)}" type="button">${escapeHtml(t('workspace.quickResume'))}</button>` : ''}
    ${primaryRunner ? `<button class="button ghost" data-action="quick-start-runner" data-runner-id="${escapeHtml(primaryRunner.id)}" type="button">${escapeHtml(t('workspace.quickStart'))}</button>` : `<button class="button ghost" type="button" disabled>${escapeHtml(t('workspace.quickStart'))}</button>`}
    ${primaryRunner ? `<span class="workspace-action-hint">${escapeHtml((primaryRunner.name || primaryRunner.id) + ' · ' + t('workspace.quickStartHint'))}</span>` : `<span class="workspace-action-hint">${escapeHtml(t('runner.empty'))}</span>`}
  `;

  if (!recent.length) {
    recentSection.classList.toggle('hidden', false);
    recentHost.innerHTML = `<div class="empty-state compact">${escapeHtml(t('workspace.recentEmpty'))}</div>`;
    return;
  }

  recentSection.classList.toggle('hidden', false);
  recentHost.innerHTML = recent.map((session) => {
    const status = String(session.status || 'created');
    const runner = state.runnersAll.find((item) => item.id === session.runnerId);
    return `
      <article class="workspace-session-card" data-action="resume-recent-session" data-session-id="${escapeHtml(session.id)}">
        <div class="workspace-session-main">
          <strong>${escapeHtml(toolLabel(session.tool))}</strong>
          <span class="mono-line">${escapeHtml(session.projectPath || runnerDisplayName(session.runnerId) || session.id)}</span>
        </div>
        <div class="workspace-session-side">
          <span class="chip state ${status === 'running' ? 'connected' : 'connecting'}">${escapeHtml(localizeStatus(status))}</span>
          <span class="badge neutral">${escapeHtml(runner ? (runner.name || runner.id) : session.runnerId)}</span>
        </div>
      </article>
    `;
  }).join('');
}

function renderRunnerList() {
  const host = $('runnerList');
  const all = [...state.runnersAll].sort((a, b) => {
    const ao = a.online ? 1 : 0;
    const bo = b.online ? 1 : 0;
    if (ao !== bo) return bo - ao;
    return Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0);
  });

  $('runnerSummaryText').textContent = t('runner.summary', {
    online: state.runnerSummary.online,
    offline: state.runnerSummary.offline,
    total: state.runnerSummary.total,
  });

  if (!all.length) {
    host.innerHTML = '<div class="empty-state">' + escapeHtml(t('runner.empty')) + '</div>';
    return;
  }

  host.innerHTML = all.map((runner) => {
    const toolStates = runnerToolStates(runner);
    const primaryTool = quickStartToolForRunner(runner);
    const toolBadges = toolStates.length
      ? toolStates.map((item) => `
          <span
            class="badge ${item.available && runner.online ? 'ok' : 'neutral'}"
            title="${escapeHtml(item.available ? toolLabel(item.tool) : (item.reason || t('label.unreported')))}"
          >
            ${escapeHtml(toolLabel(item.tool))}
          </span>
        `).join('')
      : `<span class="badge warn">${escapeHtml(t('runner.unsupportedTools'))}</span>`;
    return `
      <article class="runner-card" data-runner-card="1" data-runner-id="${escapeHtml(runner.id)}">
        <div class="runner-card-main">
          <div class="runner-head">
            <div class="action-row runner-title-row">
              <span class="dot ${runner.online ? 'on' : 'off'}" aria-hidden="true"></span>
              <div class="runner-title">
                <strong>${escapeHtml(runner.name || runner.id)}</strong>
                <span class="runner-subline">${escapeHtml(runner.online ? t('status.online') : t('status.offline'))} · ${escapeHtml(formatRelativeTime(runner.lastSeenAt))}</span>
              </div>
            </div>
          </div>
          <div class="badge-row">${toolBadges}</div>
        </div>
        <div class="runner-card-side">
          <div class="runner-actions">
            <button class="button primary" data-action="quick-start-runner" data-runner-id="${escapeHtml(runner.id)}" data-tool="${escapeHtml(primaryTool)}" type="button"${runner.online && primaryTool ? '' : ' disabled'}>${escapeHtml(t('button.startCoding'))}</button>
            <button class="button ghost" data-action="open-runner" data-runner-id="${escapeHtml(runner.id)}" type="button">${escapeHtml(t('button.viewDetails'))}</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function refreshNewSessionToolOptions(runner) {
  const select = $('newSessionTool');
  const result = $('createSessionResult');
  const prev = String(select.value || '').toLowerCase();
  const supported = runnerAvailableTools(runner);
  select.innerHTML = '';

  if (!supported.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = t('runner.unsupportedTools');
    select.appendChild(option);
    select.disabled = true;
    $('btnCreateSession').disabled = true;
    setInlineFeedback('createSessionResult', t('session.noSupportedTool'));
    return;
  }

  for (const tool of supported) {
    const option = document.createElement('option');
    option.value = tool;
    option.textContent = toolLabel(tool);
    select.appendChild(option);
  }

  select.disabled = false;
  $('btnCreateSession').disabled = false;
  select.value = supported.includes(prev) ? prev : supported[0];
  if (result.textContent === t('session.noSupportedTool')) result.textContent = '';
}

function refreshNewSessionPathOptions(detail) {
  const select = $('newSessionPath');
  const prev = String(select.value || '');
  const projectPaths = runnerProjectPathOptions(detail);
  select.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = t('detail.projectPathDefault');
  select.appendChild(defaultOption);

  for (const projectPath of projectPaths) {
    const option = document.createElement('option');
    option.value = projectPath;
    option.textContent = projectPath;
    select.appendChild(option);
  }

  select.value = projectPaths.includes(prev) ? prev : '';
}

function renderRunnerDetail() {
  const detail = state.runnerDetail;
  if (!detail || !detail.runner) return;

  const runner = detail.runner;
  const toolStates = runnerToolStates(runner);
  $('detailRunnerTitle').textContent = runner.name || runner.id;
  $('detailRunnerSub').textContent = t('detail.subline', {
    status: runner.online ? t('status.online') : t('status.offline'),
    relative: formatRelativeTime(runner.lastSeenAt),
    absolute: formatDateTime(runner.lastSeenAt),
  });

  $('detailTools').innerHTML = toolStates.length
    ? toolStates.map((item) => `
        <span class="badge ${item.available ? 'ok' : 'neutral'}" title="${escapeHtml(item.available ? toolLabel(item.tool) : (item.reason || t('label.unreported')))}">
          ${escapeHtml(toolLabel(item.tool))}
        </span>
      `).join('')
    : `<span class="badge warn">${escapeHtml(t('runner.unsupportedTools'))}</span>`;

  const lastSeen = formatDateTime(runner.lastSeenAt);
  $('detailMetrics').innerHTML = [
    [t('detail.metric.platform'), runnerPlatformLabel(runner)],
    [t('detail.metric.status'), runner.online ? t('status.online') : t('status.offline')],
    [t('detail.metric.lastHeartbeat'), lastSeen],
    [t('detail.metric.activeSessions'), String(detail.summary ? detail.summary.activeSessions : 0)],
    [t('detail.metric.totalSessions'), String(detail.summary ? detail.summary.totalSessions : 0)],
  ].map(([label, value]) => `
    <div class="meta-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join('');

  refreshNewSessionToolOptions(runner);
  refreshNewSessionPathOptions(detail);

  const sessions = Array.isArray(detail.sessions) ? detail.sessions : [];
  $('detailSessionSummary').textContent = t('detail.sessionSummary', {
    total: detail.summary ? detail.summary.totalSessions : sessions.length,
    active: detail.summary ? detail.summary.activeSessions : 0,
  });

  const host = $('detailSessionList');
  if (!sessions.length) {
    host.innerHTML = '<div class="empty-state">' + escapeHtml(t('detail.noSession')) + '</div>';
    return;
  }

  host.innerHTML = sessions.map((session) => {
    const status = String(session.status || 'created');
    const statusClass = status === 'running' || status === 'starting'
      ? 'connected'
      : (status === 'error' || status === 'exited' || status === 'ended' ? 'error' : 'connecting');
    const resumeCommand = buildClaudeResumeCommand(session);
    const geminiCommand = buildGeminiLaunchCommand(session, runner);
    const runnerName = runnerDisplayName(session.runnerId);
    return `
      <article class="session-card" data-session-id="${escapeHtml(session.id)}">
        <div class="session-headline">
          <div class="session-main">
            <strong>${escapeHtml(toolLabel(session.tool))}</strong>
            <div class="session-id">${escapeHtml(t('session.idLabel'))}: ${escapeHtml(session.id)}</div>
          </div>
          <div class="status-strip">
            <span class="chip state ${statusClass}">${escapeHtml(localizeStatus(status))}</span>
            <span class="badge neutral">${escapeHtml(session.createdBy || t('session.createdByUnknown'))}</span>
          </div>
        </div>
        <div class="session-meta">
          <div class="meta-item">
            <span>${escapeHtml(t('session.meta.created'))}</span>
            <strong>${escapeHtml(formatDateTime(session.createdAt))}</strong>
          </div>
          <div class="meta-item">
            <span>${escapeHtml(t('session.meta.projectPath'))}</span>
            <strong class="mono-line">${escapeHtml(session.projectPath || '-')}</strong>
          </div>
          <div class="meta-item">
            <span>${escapeHtml(t('session.meta.runner'))}</span>
            <strong>${escapeHtml(runnerName || '-')}</strong>
          </div>
        </div>
        <div class="session-actions">
          <button class="button primary" data-action="open-session" data-session-id="${escapeHtml(session.id)}" type="button">${escapeHtml(t('button.openTerminal'))}</button>
          ${resumeCommand ? `<button class="button ghost" data-action="copy-claude" data-session-id="${escapeHtml(session.id)}" type="button">${escapeHtml(t('button.copyClaudeResume'))}</button>` : ''}
          ${geminiCommand ? `<button class="button ghost" data-action="copy-gemini" data-session-id="${escapeHtml(session.id)}" type="button">${escapeHtml(t('button.copyGeminiLaunch'))}</button>` : ''}
          <button class="button ghost" data-action="stop-session" data-session-id="${escapeHtml(session.id)}" type="button"${status === 'running' || status === 'starting' || status === 'stopping' ? '' : ' disabled'}>${escapeHtml(t('button.stop'))}</button>
          <button class="button ghost danger" data-action="delete-session" data-session-id="${escapeHtml(session.id)}" type="button">${escapeHtml(t('button.delete'))}</button>
        </div>
      </article>
    `;
  }).join('');
}

async function refreshRunnerList(showError = true) {
  try {
    const [runnersData, sessionsData] = await Promise.all([
      api('GET', '/api/runners'),
      api('GET', '/api/sessions').catch(() => ({ sessions: [] })),
    ]);
    state.runnersAll = Array.isArray(runnersData && runnersData.runners) ? runnersData.runners : [];
    state.runnerSummary = runnersData && runnersData.summary ? runnersData.summary : {
      total: state.runnersAll.length,
      online: state.runnersAll.filter((runner) => runner.online).length,
      offline: state.runnersAll.filter((runner) => !runner.online).length,
      returned: state.runnersAll.length,
    };
    const sessions = Array.isArray(sessionsData && sessionsData.sessions) ? sessionsData.sessions : [];
    state.workspaceSessions = sessions;
    state.sessionSummary = {
      total: sessions.length,
      active: sessions.filter((session) => ['running', 'starting', 'stopping'].includes(String(session.status || ''))).length,
    };
    setSummaryTiles();
    renderWorkspaceHome();
    renderRunnerList();
  } catch (error) {
    if (showError) {
      const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('notify.refreshFailed'));
      const message = localizeErrorText(rawMessage);
      $('runnerList').innerHTML = '<div class="empty-state">' + escapeHtml(message) + '</div>';
      notify({ type: 'error', title: t('notify.refreshRunnerFailedTitle'), message });
    }
  }
}

async function refreshRunnerDetail(showError = true) {
  const runnerId = state.selectedRunnerId;
  if (!runnerId) return;
  try {
    const detail = await api('GET', '/api/runners/' + encodeURIComponent(runnerId));
    state.runnerDetail = detail;
    renderRunnerDetail();
  } catch (error) {
    const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('notify.loadRunnerFailed'));
    const message = localizeErrorText(rawMessage);
    if (showError) {
      $('detailSessionList').innerHTML = '<div class="empty-state">' + escapeHtml(message) + '</div>';
      notify({ type: 'error', title: t('notify.refreshRunnerDetailFailedTitle'), message });
    }
    if (error && error.status === 404) {
      showView('workspace');
      refreshRunnerList(false).catch(() => { });
    }
  }
}

async function openRunnerDetail(runnerId) {
  state.selectedRunnerId = runnerId;
  setInlineFeedback('createSessionResult', '');
  showView('runnerDetail');
  await refreshRunnerDetail(true);
}

async function createSessionForRunner() {
  const runnerId = state.selectedRunnerId;
  if (!runnerId) return;
  $('btnCreateSession').disabled = true;
  setInlineFeedback('createSessionResult', '');
  try {
    const tool = $('newSessionTool').value;
    if (!tool) throw new Error(t('session.noSupportedTool'));
    const projectPath = $('newSessionPath').value.trim();
    const projectName = $('newSessionProjectName').value.trim();
    const payload = {
      tool,
      projectPath: projectPath || undefined,
      projectName: projectName || undefined,
    };
    const data = await api('POST', '/api/runners/' + encodeURIComponent(runnerId) + '/sessions', payload);
    setInlineFeedback('createSessionResult', t('notify.createSessionInline', { sessionId: data.sessionId }));
    $('newSessionProjectName').value = '';
    notify({
      type: 'success',
      title: t('notify.createSessionTitle'),
      message: t('notify.createSessionMessage', { sessionId: data.sessionId }),
    });
    await refreshRunnerDetail(false);
    const created = getActiveDetailSession(data.sessionId) || {
      id: data.sessionId,
      runnerId,
      tool,
      projectPath: projectPath || null,
      status: data.status || 'created',
    };
    await openSession(created);
  } catch (error) {
    const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('notify.createFailed'));
    const message = localizeErrorText(rawMessage);
    setInlineFeedback('createSessionResult', message, 'error');
    notify({ type: 'error', title: t('notify.createSessionFailedTitle'), message });
  } finally {
    $('btnCreateSession').disabled = $('newSessionTool').disabled;
  }
}

async function quickStartRunner(runnerId) {
  const runner = state.runnersAll.find((item) => item.id === runnerId);
  if (!runner || !runner.online) {
    notify({
      type: 'warn',
      title: t('notify.runnerOfflineTitle'),
      message: t('notify.runnerOfflineMessage'),
    });
    return;
  }

  const tool = quickStartToolForRunner(runner);
  if (!tool) {
    notify({
      type: 'error',
      title: t('notify.quickStartFailedTitle'),
      message: t('session.noSupportedTool'),
    });
    return;
  }

  try {
    const data = await api('POST', '/api/runners/' + encodeURIComponent(runnerId) + '/sessions', {
      tool,
    });
    notify({
      type: 'success',
      title: t('notify.createSessionTitle'),
      message: t('notify.createSessionMessage', { sessionId: data.sessionId }),
    });
    const created = {
      id: data.sessionId,
      runnerId,
      tool,
      projectPath: data.projectPath || null,
      status: data.status || 'created',
    };
    await refreshRunnerList(false);
    await openSession(created, { returnView: 'workspace' });
  } catch (error) {
    const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('notify.createFailed'));
    const message = localizeErrorText(rawMessage);
    notify({ type: 'error', title: t('notify.quickStartFailedTitle'), message });
  }
}

function getActiveDetailSession(sessionId) {
  const sessions = state.runnerDetail && Array.isArray(state.runnerDetail.sessions) ? state.runnerDetail.sessions : [];
  return sessions.find((session) => session.id === sessionId) || null;
}

function updateTerminalHeader(session) {
  const container = $('termHeaderMeta');
  if (!container) return;

  const status = session.status || 'created';
  const statusClass = status === 'running' || status === 'starting' ? 'connected' : 'error';
  const runnerName = runnerDisplayName(session.runnerId);
  const summary = [
    String(session.tool || 'ACP').toUpperCase(),
    localizeStatus(status),
    runnerName || session.runnerId,
  ].filter(Boolean).join(' · ');

  container.innerHTML = `
    <details class="term-session-bar">
      <summary class="term-session-summary">
        <div class="term-session-summary-main">
          <span class="chip subtle">ACP</span>
          <strong>${escapeHtml(summary)}</strong>
        </div>
        <span class="term-session-summary-hint">${escapeHtml(t('button.viewDetails'))}</span>
      </summary>
      <div class="term-session-details">
        <div class="term-header-item">
          <span>${escapeHtml(t('session.meta.runner'))}</span>
          <strong>${escapeHtml(runnerName)}</strong>
        </div>
        <div class="term-header-item">
          <span>${escapeHtml(t('detail.metric.status'))}</span>
          <span class="chip state ${statusClass}">${escapeHtml(localizeStatus(status))}</span>
        </div>
        <div class="term-header-item">
          <span>${escapeHtml(t('session.meta.projectPath'))}</span>
          <strong class="mono-line">${escapeHtml(session.projectPath || '/')}</strong>
        </div>
        <div class="term-header-item">
          <span>${escapeHtml(t('session.idLabel'))}</span>
          <strong class="mono-line">${escapeHtml(session.id)}</strong>
        </div>
      </div>
    </details>
  `;
}

async function ensureSessionStarted(session) {
  const status = String(session.status || 'created');
  if (status === 'running' || status === 'starting') return;
  const started = await api('POST', '/api/sessions/' + encodeURIComponent(session.id) + '/start', {
    cols: 120,
    rows: 34,
    projectPath: session.projectPath || undefined,
  });
  if (started && started.status) session.status = started.status;
}

async function openSession(session, options = {}) {
  const runner = state.runnersAll.find((item) => item.id === session.runnerId);
  if (!runner || !runner.online) {
    notify({
      type: 'warn',
      title: t('notify.runnerOfflineTitle'),
      message: t('notify.runnerOfflineMessage'),
    });
    return;
  }
  state.activeSession = { ...session };
  state.returnView = options.returnView || (state.view === 'workspace' ? 'workspace' : 'runnerDetail');
  state.terminalConnection = 'connecting';
  showView('terminal');
  updateTerminalHeader(state.activeSession);
  try {
    await ensureSessionStarted(state.activeSession);
  } catch (error) {
    const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('label.unknown'));
    const message = localizeErrorText(rawMessage);
    terminal.resetOutput();
    terminal.write(t('terminal.startFailedInline', { message }) + '\r\n');
    notify({ type: 'error', title: t('notify.startSessionFailedTitle'), message });
    return;
  }
  updateTerminalHeader(state.activeSession);
  try {
    await terminal.connect(state.activeSession.id);
  } catch (error) {
    const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('label.unknown'));
    const message = localizeErrorText(rawMessage);
    state.terminalConnection = 'error';
    updateTerminalHeader(state.activeSession);
    notify({ type: 'error', title: t('terminal.connectionFailed'), message });
  }
}

async function stopSession(sessionId) {
  try {
    await api('POST', '/api/sessions/' + encodeURIComponent(sessionId) + '/stop', {});
    notify({
      type: 'success',
      title: t('notify.stopRequestedTitle'),
      message: t('notify.stopRequestedMessage', { sessionId }),
    });
  } catch (error) {
    const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('notify.stopFailedTitle'));
    const message = localizeErrorText(rawMessage);
    notify({ type: 'error', title: t('notify.stopFailedTitle'), message });
  }
  setTimeout(() => refreshRunnerDetail(false).catch(() => { }), 250);
}

async function deleteSession(sessionId) {
  const session = getActiveDetailSession(sessionId);
  const runnerId = (session && session.runnerId) || state.selectedRunnerId;
  const result = await modalShow({
    title: t('notify.deleteSessionTitle'),
    body: t('notify.deleteSessionBody'),
    okText: t('notify.deleteSessionConfirm'),
    cancelText: t('button.cancel'),
    destructive: true,
  });
  if (!result.confirmed) return;
  try {
    await api('DELETE', '/api/sessions/' + encodeURIComponent(sessionId) + '?force=1');
    notify({ type: 'success', title: t('notify.deleteSessionSuccessTitle'), message: sessionId });
    if (state.runnerDetail && Array.isArray(state.runnerDetail.sessions)) {
      state.runnerDetail.sessions = state.runnerDetail.sessions.filter((s) => s.id !== sessionId);
      renderRunnerDetail();
    }
    setTimeout(() => {
      if (state.selectedRunnerId === runnerId) {
        refreshRunnerDetail(false).catch(() => { });
      }
    }, 800);
  } catch (error) {
    const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('button.delete'));
    const message = localizeErrorText(rawMessage);
    notify({ type: 'error', title: t('notify.deleteSessionFailedTitle'), message });
  }
}

async function deleteRunner(runnerId) {
  const result = await modalShow({
    title: t('notify.deleteRunnerTitle'),
    body: t('notify.deleteRunnerBody'),
    okText: t('button.confirm'),
    cancelText: t('button.cancel'),
    destructive: true,
  });
  if (!result.confirmed) return;
  try {
    await api('DELETE', '/api/runners/' + encodeURIComponent(runnerId) + '?force=1');
    setInlineFeedback('cleanupResult', t('notify.deleteRunnerSuccessInline', { runnerId }));
    notify({ type: 'success', title: t('notify.deleteRunnerSuccessTitle'), message: runnerId });
    if (state.selectedRunnerId === runnerId) {
      state.selectedRunnerId = '';
      state.runnerDetail = null;
      showView('workspace');
    }
    await refreshRunnerList(false);
  } catch (error) {
    const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('button.delete'));
    const message = localizeErrorText(rawMessage);
    notify({ type: 'error', title: t('notify.deleteRunnerFailedTitle'), message });
  }
}

async function copyClaudeResume(session) {
  const command = buildClaudeResumeCommand(session);
  if (!command) return;
  try {
    await copyTextToClipboard(command);
    notify({ type: 'success', title: t('notify.copyClaudeTitle'), message: command, ttl: 2600 });
  } catch (error) {
    notify({
      type: 'error',
      title: t('notify.copyFailedTitle'),
      message: localizeErrorText(String((error && error.message) || error || t('label.unknown'))),
    });
  }
}

async function copyGeminiLaunch(session, runner) {
  const command = buildGeminiLaunchCommand(session, runner);
  if (!command) return;
  try {
    await copyTextToClipboard(command);
    notify({ type: 'success', title: t('notify.copyGeminiTitle'), message: command, ttl: 2600 });
  } catch (error) {
    notify({
      type: 'error',
      title: t('notify.copyFailedTitle'),
      message: localizeErrorText(String((error && error.message) || error || t('label.unknown'))),
    });
  }
}

async function refreshAuth() {
  const me = await api('GET', '/api/auth/me');
  state.authMeta = me;
  setAuth(me);
  refreshNotifications(me);
  return me;
}

async function refreshSettings() {
  const settings = await api('GET', '/api/admin/settings');
  state.settingsData = settings;
  renderSettings(settings);
  return settings;
}

function renderSettings(settings) {
  const totp = settings && settings.web && settings.web.totp ? settings.web.totp : {};
  $('settingsSub').textContent = t('notify.settingsCurrentUser', {
    user: settings && settings.web && settings.web.user ? settings.web.user : '-',
  });
  if (totp && totp.configured) {
    $('totpStatus').textContent = t('notify.totpConfigured');
    $('btnTotpDisable').classList.remove('hidden');
    $('btnTotpEnable').classList.add('hidden');
  } else {
    $('totpStatus').textContent = t('notify.totpNotConfigured');
    $('btnTotpDisable').classList.add('hidden');
    $('btnTotpEnable').classList.remove('hidden');
  }
}

async function saveAuthSettings() {
  $('btnSaveAuth').disabled = true;
  setInlineFeedback('saveAuthResult', '');
  try {
    const oldPassword = $('setOldPassword').value;
    const newUser = $('setNewUser').value.trim();
    const newPassword = $('setNewPassword').value;
    const response = await api('POST', '/api/admin/auth/change', { oldPassword, newUser, newPassword });
    setInlineFeedback('saveAuthResult', t('notify.authSavedInline'));
    notify({ type: 'success', title: t('notify.authSavedTitle'), message: t('notify.authSavedMessage') });
    if (response && response.relogin) await doLogout();
  } catch (error) {
    const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('notify.saveFailedTitle'));
    const message = localizeErrorText(rawMessage);
    setInlineFeedback('saveAuthResult', message, 'error');
    notify({ type: 'error', title: t('notify.saveFailedTitle'), message });
  } finally {
    $('btnSaveAuth').disabled = false;
    $('setOldPassword').value = '';
    $('setNewPassword').value = '';
  }
}

async function totpAction(kind) {
  setInlineFeedback('totpActionResult', '');
  if (kind === 'enable') {
    location.href = '/setup';
    return;
  }

  if (kind === 'disable') {
    const result = await modalShow({
      title: t('notify.disableTotpTitle'),
      body: t('notify.disableTotpBody'),
      okText: t('notify.disableTotpConfirm'),
      cancelText: t('button.cancel'),
      destructive: true,
      fields: [
        {
          key: 'password',
          label: t('notify.totpPasswordLabel'),
          placeholder: t('notify.totpPasswordPlaceholder'),
          type: 'password',
        },
        {
          key: 'totp',
          label: t('notify.totpCodeLabel'),
          placeholder: t('notify.totpCodePlaceholder'),
          inputmode: 'numeric',
          autocomplete: 'one-time-code',
        },
      ],
    });
    if (!result.confirmed) return;
    const password = String(result.values.password || '');
    const totp = String(result.values.totp || '').trim();
    if (!password || !totp) {
      notify({ type: 'warn', title: t('notify.incompleteTitle'), message: t('notify.incompleteMessage') });
      return;
    }
    try {
      await api('POST', '/api/admin/totp/disable', { password, totp });
      setInlineFeedback('totpActionResult', t('notify.totpDeletedInline'));
      notify({ type: 'success', title: t('notify.totpDeletedTitle'), message: t('notify.totpDeletedMessage') });
      await refreshAuth();
      await refreshSettings();
    } catch (error) {
      const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('notify.actionUnsupported'));
      const message = localizeErrorText(rawMessage);
      setInlineFeedback('totpActionResult', message, 'error');
      notify({ type: 'error', title: t('notify.disableTotpFailedTitle'), message });
    }
    return;
  }

  setInlineFeedback('totpActionResult', t('notify.actionUnsupported'), 'error');
}

async function doLogin(ev) {
  ev.preventDefault();
  $('btnLogin').disabled = true;
  setInlineFeedback('loginError', '');
  try {
    const username = $('authUser').value.trim();
    const password = $('authPassword').value;
    const inTotpStep = !$('authTotpField').classList.contains('hidden');
    const payload = inTotpStep
      ? { username, password, totp: $('authTotp').value.trim() }
      : { username, password };
    const response = await api('POST', '/api/auth/login', payload);
    if (response && response.needTotp && !response.authenticated) {
      setLoginTotpMode(true);
      setInlineFeedback('loginError', t('notify.loginTotpRequired'), 'error');
      try { $('authTotp').focus(); } catch { }
      return;
    }
    if (!response || !response.authenticated) throw new Error(t('notify.loginUnknown'));
    setAuth(response);
    setLoginTotpMode(false);
    showView('workspace');
    await refreshRunnerList(true);
    await refreshAuth();
    notify({
      type: 'success',
      title: t('notify.loginSuccessTitle'),
      message: t('notify.loginSuccessMessage', { user: state.auth.user }),
      ttl: 2200,
    });
  } catch (error) {
    const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('notify.loginUnknown'));
    const message = localizeErrorText(rawMessage);
    setInlineFeedback('loginError', message, 'error');
    if (rawMessage.includes('invalid credentials')) {
      setLoginTotpMode(false);
    } else {
      $('authTotp').value = '';
    }
    notify({ type: 'error', title: t('notify.loginFailedTitle'), message });
  } finally {
    $('btnLogin').disabled = false;
  }
}

async function doLogout() {
  $('btnLogout').disabled = true;
  terminal.disconnect(true);
  try {
    await api('POST', '/api/auth/logout', {});
  } catch { }
  resetAuth();
  showView('login');
  $('btnLogout').disabled = false;
}

function bindRunnerListEvents() {
  $('runnerList').addEventListener('click', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest('[data-action], [data-runner-card]') : null;
    if (!target) return;
    const action = target.getAttribute('data-action');
    const runnerId = target.getAttribute('data-runner-id') || target.closest('[data-runner-id]')?.getAttribute('data-runner-id') || '';
    if (action === 'delete-runner') {
      ev.preventDefault();
      deleteRunner(runnerId);
      return;
    }
    if (action === 'open-runner' || target.hasAttribute('data-runner-card')) {
      ev.preventDefault();
      openRunnerDetail(runnerId);
    }
  });
}

function bindWorkspaceHomeEvents() {
  $('workspaceView').addEventListener('click', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest('[data-action], [data-session-id], [data-runner-id]') : null;
    if (!target) return;
    const action = target.getAttribute('data-action');
    if (action === 'quick-start-runner') {
      ev.preventDefault();
      const runnerId = target.getAttribute('data-runner-id') || '';
      if (runnerId) quickStartRunner(runnerId);
      return;
    }
    if (action === 'resume-recent-session') {
      ev.preventDefault();
      const sessionId = target.getAttribute('data-session-id') || '';
      const session = (state.workspaceSessions || []).find((item) => item.id === sessionId);
      if (session) openSession(session, { returnView: 'workspace' });
    }
  });
}

function bindSessionListEvents() {
  $('detailSessionList').addEventListener('click', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest('[data-action], [data-session-id]') : null;
    if (!target) return;
    const action = target.getAttribute('data-action');
    const sessionId = target.getAttribute('data-session-id') || target.closest('[data-session-id]')?.getAttribute('data-session-id') || '';
    const session = getActiveDetailSession(sessionId);
    if (!session) return;

    if (action === 'copy-claude') {
      ev.preventDefault();
      copyClaudeResume(session);
      return;
    }
    if (action === 'copy-gemini') {
      ev.preventDefault();
      copyGeminiLaunch(session, state.runnerDetail && state.runnerDetail.runner);
      return;
    }
    if (action === 'stop-session') {
      ev.preventDefault();
      stopSession(sessionId);
      return;
    }
    if (action === 'delete-session') {
      ev.preventDefault();
      deleteSession(sessionId);
      return;
    }
    if (action === 'open-session' || target.classList.contains('session-card')) {
      ev.preventDefault();
      openSession(session);
    }
  });
}

function bindUiEvents() {
  bindWorkspaceHomeEvents();
  $('btnLangZh').onclick = () => applyLanguage(LANG_ZH, true);
  $('btnLangEn').onclick = () => applyLanguage(LANG_EN, true);
  $('btnThemeToggle').onclick = () => toggleTheme();
  $('btnMobileChromeToggle').onclick = () => {
    state.mobileChromeOpen = !state.mobileChromeOpen;
    syncMobileChromeState();
  };
  $('btnTermFontDown').onclick = () => terminal.adjustFontSize(-1);
  $('btnTermFontUp').onclick = () => terminal.adjustFontSize(1);
  $('btnTermPalette').onclick = (ev) => {
    ev.stopPropagation();
    const expanded = $('btnTermPalette').getAttribute('aria-expanded') === 'true';
    setTermPalettePanelOpen(!expanded);
  };
  $('loginForm').addEventListener('submit', doLogin);
  $('btnLogout').onclick = () => doLogout();
  $('btnRefreshRunners').onclick = () => refreshRunnerList(true);
  $('btnDeleteRunner').onclick = () => {
    const runnerId = state.runnerDetail && state.runnerDetail.runner && state.runnerDetail.runner.id;
    if (runnerId) deleteRunner(runnerId);
  };
  $('btnNotifications').onclick = (ev) => {
    ev.stopPropagation();
    const expanded = $('btnNotifications').getAttribute('aria-expanded') === 'true';
    setNotificationPanelOpen(!expanded);
  };
  $('btnOpenSettings').onclick = async () => {
    closeNotificationPanel();
    showView('settings');
    try { await refreshSettings(); } catch { }
  };
  $('btnBackFromSettings').onclick = async () => {
    closeNotificationPanel();
    showView('workspace');
    await refreshRunnerList(false);
  };
  $('btnSaveAuth').onclick = () => saveAuthSettings();
  $('btnTotpDisable').onclick = () => totpAction('disable');
  $('btnTotpEnable').onclick = () => totpAction('enable');

  $('btnBackToRunners').onclick = async () => {
    closeNotificationPanel();
    showView('workspace');
    await refreshRunnerList(false);
  };
  $('btnRefreshDetail').onclick = () => refreshRunnerDetail(true);
  $('btnCreateSession').onclick = () => createSessionForRunner();


  $('btnBackFromTerminal').onclick = async () => {
    showView(state.returnView || 'runnerDetail');
    if (state.selectedRunnerId) await refreshRunnerDetail(false);
  };
  $('btnTermReconnect').onclick = async () => {
    if (!state.activeSession) return;
    try {
      await terminal.reconnect();
    } catch (error) {
      const rawMessage = String((error && error.data && error.data.error) || (error && error.message) || t('label.unknown'));
      const message = localizeErrorText(rawMessage);
      state.terminalConnection = 'error';
      updateTerminalHeader(state.activeSession);
      notify({ type: 'error', title: t('terminal.connectionFailed'), message });
    }
  };
  $('btnTermDisconnect').onclick = () => terminal.disconnect(true);

  $('modalMask').addEventListener('click', (ev) => {
    if (ev.target === $('modalMask')) modalCancelActive();
  });
  document.addEventListener('keydown', handleModalKeydown);
  $('notificationPanel').addEventListener('click', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest('[data-notification-action]') : null;
    if (!target) return;
    ev.preventDefault();
    ev.stopPropagation();
    handleNotificationAction(target.getAttribute('data-notification-action') || '');
  });
  $('termPalettePanel').addEventListener('click', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest('[data-term-palette]') : null;
    if (!target) return;
    ev.preventDefault();
    ev.stopPropagation();
    applyTerminalPalette(target.getAttribute('data-term-palette') || TERM_PALETTE_NOIR, true);
  });
  document.addEventListener('click', (ev) => {
    const target = ev.target;
    const notificationWrap = document.querySelector('.notification-wrap');
    const themeWrap = document.querySelector('.terminal-theme-wrap');
    if (target instanceof Node) {
      if (notificationWrap && notificationWrap.contains(target)) return;
      if (themeWrap && themeWrap.contains(target)) return;
    }
    closeNotificationPanel();
    closeTermPalettePanel();
  });
  window.addEventListener('resize', () => {
    scheduleViewportMetricsSync();
    syncMobileChromeState();
  });
  window.addEventListener('orientationchange', scheduleViewportMetricsSync);
  window.addEventListener('focusin', scheduleViewportMetricsSync);
  window.addEventListener('focusout', () => {
    setTimeout(scheduleViewportMetricsSync, 80);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    scheduleViewportMetricsSync();
    void resumeVisibleView();
  });
  window.addEventListener('online', () => handleNetworkStatusChange(true));
  window.addEventListener('offline', () => handleNetworkStatusChange(false));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleViewportMetricsSync);
    window.visualViewport.addEventListener('scroll', scheduleViewportMetricsSync);
  }

  bindRunnerListEvents();
  bindSessionListEvents();
}

async function bootstrap() {
  syncViewportMetrics();
  terminal.setNetworkStatus(state.networkOnline);
  currentLanguage = readLanguagePreference();
  currentTerminalPalette = readTerminalPalettePreference();
  applyLanguage(currentLanguage, false);
  applyTheme(readThemePreference(), false);
  applyTerminalPalette(currentTerminalPalette, false);
  setSummaryTiles();
  terminal.init();
  bindUiEvents();
  void registerPwaWorker();

  try {
    const me = await refreshAuth();
    if (me && me.authenticated) {
      showView('workspace');
      await refreshRunnerList(true);
      return;
    }
  } catch { }

  resetAuth();
  showView('login');
}

bootstrap();
