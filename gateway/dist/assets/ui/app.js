import { createTerminalController } from './terminal.js';

const $ = (id) => document.getElementById(id);
const THEME_STORAGE_KEY = 'agentmesh_ui_theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';
const TOOL_ORDER = ['codex', 'claude', 'gemini'];

const state = {
  view: 'login',
  returnView: 'runnerDetail',
  auth: {
    authenticated: false,
    user: '',
    csrfToken: '',
    expiresAt: 0,
  },
  runnersAll: [],
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
  runnerSearch: '',
  sessionSearch: '',
  riskAction: 'settings',
};

let currentTheme = THEME_LIGHT;
let modalResolve = null;

const terminal = createTerminalController({
  $,
  api,
  getTheme: () => currentTheme,
  onError: (message) => notify({
    type: 'error',
    title: '终端连接失败',
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

function readThemePreference() {
  try {
    const stored = String(localStorage.getItem(THEME_STORAGE_KEY) || '').toLowerCase();
    if (stored === THEME_LIGHT || stored === THEME_DARK) return stored;
  } catch {}
  const prefersDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return prefersDark ? THEME_DARK : THEME_LIGHT;
}

function refreshThemeToggle(theme) {
  const btn = $('btnThemeToggle');
  if (!btn) return;
  const dark = theme === THEME_DARK;
  btn.textContent = dark ? '切换日间' : '切换夜间';
  btn.setAttribute('aria-label', dark ? '切换到日间模式' : '切换到夜间模式');
  btn.title = dark ? '切换到日间模式' : '切换到夜间模式';
}

function applyTheme(theme, persist = true) {
  const next = theme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
  currentTheme = next;
  const root = document.documentElement;
  if (root) {
    if (next === THEME_DARK) root.setAttribute('data-theme', THEME_DARK);
    else root.removeAttribute('data-theme');
  }
  refreshThemeToggle(next);
  terminal.setTheme();
  if (!persist) return;
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch {}
}

function toggleTheme() {
  applyTheme(currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK, true);
}

function notify({ type = 'info', title = '', message = '', ttl = 3600 }) {
  const stack = $('toastStack');
  if (!stack) return;
  const toast = document.createElement('article');
  toast.className = 'toast ' + type;
  toast.innerHTML = `<strong>${escapeHtml(title || '提示')}</strong><span>${escapeHtml(message)}</span>`;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, ttl);
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
}

function modalShow(opts = {}) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    const title = opts.title ? String(opts.title) : '提示';
    const body = opts.body ? String(opts.body) : '';
    const okText = opts.okText ? String(opts.okText) : '确认';
    const cancelText = opts.cancelText ? String(opts.cancelText) : '取消';
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
      setTimeout(() => input.focus(), 0);
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
  });
}

function toolLabel(tool) {
  const normalized = String(tool || '').toLowerCase();
  if (normalized === 'codex') return 'Codex';
  if (normalized === 'claude') return 'Claude';
  if (normalized === 'gemini') return 'Gemini';
  return String(tool || 'Unknown');
}

function formatDateTime(ts) {
  const value = Number(ts || 0);
  if (!value) return '-';
  try { return new Date(value).toLocaleString(); } catch { return '-'; }
}

function formatRelativeTime(ts) {
  const value = Number(ts || 0);
  if (!value) return '-';
  const diff = Date.now() - value;
  if (diff < 0) return '刚刚';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return sec + ' 秒前';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + ' 分钟前';
  const hour = Math.floor(min / 60);
  if (hour < 24) return hour + ' 小时前';
  const day = Math.floor(hour / 24);
  return day + ' 天前';
}

function runnerPlatformLabel(runner) {
  const platform = runner && runner.capabilities && runner.capabilities.platform;
  const os = platform && typeof platform.os === 'string' ? platform.os : '';
  const arch = platform && typeof platform.arch === 'string' ? platform.arch : '';
  const parts = [os, arch].filter(Boolean);
  return parts.length ? parts.join(' / ') : '未上报';
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
    if (detail.source === 'fallback') {
      return 'Gemini 可用：将使用 npx fallback 启动（' + detail.command + '）。';
    }
    if (detail.source === 'env') {
      return 'Gemini 可用：已通过 AGENTMESH_GEMINI_CMD 指定命令（' + detail.command + '）。';
    }
    return 'Gemini 可用：命令 ' + detail.command + '。';
  }
  const reason = detail.reason ? detail.reason : 'runner 未检测到可执行命令';
  return 'Gemini 不可用：' + reason + '。可安装 gemini CLI 或设置 AGENTMESH_GEMINI_CMD。';
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
  $('authBadge').textContent = state.auth.authenticated ? ('user · ' + state.auth.user) : '未登录';
}

function setLoginTotpMode(enabled) {
  const on = !!enabled;
  $('authTotpField').classList.toggle('hidden', !on);
  if (!on) $('authTotp').value = '';
  $('btnLogin').textContent = on ? '验证并登录' : '登录';
}

function resetAuth() {
  closeEventStream();
  if (state.autoRefreshTimer) {
    clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
  setAuth({ authenticated: false, user: '', csrfToken: '', expiresAt: 0 });
  state.runnersAll = [];
  state.runnerSummary = { total: 0, online: 0, offline: 0, returned: 0 };
  state.sessionSummary = { total: 0, active: 0 };
  state.runnerDetail = null;
  state.selectedRunnerId = '';
  state.activeSession = null;
  state.runnerSearch = '';
  state.sessionSearch = '';
  $('runnerSearch').value = '';
  $('sessionSearch').value = '';
  setLoginTotpMode(false);
  setInlineFeedback('loginError', '', '');
  setSummaryTiles();
  setRiskBanner(null);
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
  $('statOnline').textContent = String(state.runnerSummary.online || 0);
  $('statOffline').textContent = String(state.runnerSummary.offline || 0);
  $('statSessions').textContent = String(state.sessionSummary.total || 0);
  $('statActiveSessions').textContent = String(state.sessionSummary.active || 0);
}

function setRiskBanner(authPayload) {
  const banner = $('riskBanner');
  if (!authPayload || !authPayload.authenticated) {
    banner.classList.add('hidden');
    return;
  }
  const insecureDefault = authPayload.security && authPayload.security.defaultPassword;
  const totpMissing = authPayload.totpEnabled === false || authPayload.totpProvisioned === false;
  if (!insecureDefault && !totpMissing) {
    banner.classList.add('hidden');
    return;
  }
  if (insecureDefault) {
    $('riskBannerTitle').textContent = '默认凭据仍在使用';
    $('riskBannerBody').textContent = '检测到 admin / agentmesh 尚未替换。发布前应先修改账号或密码，再继续暴露控制台。';
    $('btnRiskAction').textContent = '去修改账号密码';
    state.riskAction = 'settings';
  } else {
    $('riskBannerTitle').textContent = '两步验证尚未完成';
    $('riskBannerBody').textContent = '当前账户还没有完成 TOTP 绑定。建议上线前立即完成 /setup。';
    $('btnRiskAction').textContent = '去绑定 TOTP';
    state.riskAction = 'setup';
  }
  banner.classList.remove('hidden');
}

function showView(next) {
  state.view = next;
  $('loginView').classList.toggle('hidden', next !== 'login');
  $('workspaceView').classList.toggle('hidden', next !== 'workspace');
  $('settingsView').classList.toggle('hidden', next !== 'settings');
  $('runnerDetailView').classList.toggle('hidden', next !== 'runnerDetail');
  $('terminalView').classList.toggle('hidden', next !== 'terminal');
  document.body.classList.toggle('terminal-active', next === 'terminal');
  terminal.setActive(next === 'terminal');
  ensureAutoRefresh();
}

function closeEventStream(resetRetry = true) {
  if (state.eventRetryTimer) {
    clearTimeout(state.eventRetryTimer);
    state.eventRetryTimer = null;
  }
  if (resetRetry) state.eventRetryAttempt = 0;
  if (state.eventSource) {
    try { state.eventSource.close(); } catch {}
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
      queueLiveRefresh().catch(() => {});
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
    queueLiveRefresh().catch(() => {});
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
    queueLiveRefresh().catch(() => {});
  }, 6000);
}

function renderRunnerList() {
  const host = $('runnerList');
  const query = normalizeSearch(state.runnerSearch);
  const all = [...state.runnersAll].sort((a, b) => {
    const ao = a.online ? 1 : 0;
    const bo = b.online ? 1 : 0;
    if (ao !== bo) return bo - ao;
    return Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0);
  });
  const filtered = query ? all.filter((runner) => runnerMatchesSearch(runner, query)) : all;

  $('runnerSummaryText').textContent =
    '在线 ' + state.runnerSummary.online +
    ' 台 · 离线 ' + state.runnerSummary.offline +
    ' 台 · 总计 ' + state.runnerSummary.total +
    ' 台' +
    (query ? (' · 匹配 ' + filtered.length + ' 台') : '');

  if (!filtered.length) {
    host.innerHTML = '<div class="empty-state">' + escapeHtml(query ? '没有匹配的 runner。' : '当前没有 runner。') + '</div>';
    return;
  }

  host.innerHTML = filtered.map((runner) => {
    const tools = runnerSupportedTools(runner);
    const toolBadges = tools.length
      ? tools.map((tool) => `<span class="badge ${runner.online ? 'ok' : 'neutral'}">${escapeHtml(toolLabel(tool))}</span>`).join('')
      : '<span class="badge warn">未上报工具</span>';
    return `
      <article class="runner-card" data-runner-card="1" data-runner-id="${escapeHtml(runner.id)}">
        <div class="runner-head">
          <div class="action-row" style="align-items:flex-start">
            <span class="dot ${runner.online ? 'on' : 'off'}" aria-hidden="true"></span>
            <div class="runner-title">
              <strong>${escapeHtml(runner.name || runner.id)}</strong>
              <span class="runner-id">${escapeHtml(runner.id)}</span>
            </div>
          </div>
          <span class="chip ${runner.online ? 'state connected' : 'subtle'}">${runner.online ? '在线' : '离线'}</span>
        </div>
        <div class="badge-row">${toolBadges}</div>
        <div class="meta-grid">
          <div class="meta-item">
            <span>Last seen</span>
            <strong>${escapeHtml(formatRelativeTime(runner.lastSeenAt))}</strong>
          </div>
          <div class="meta-item">
            <span>Absolute time</span>
            <strong>${escapeHtml(formatDateTime(runner.lastSeenAt))}</strong>
          </div>
        </div>
        <div class="runner-actions">
          <button class="button ghost" data-action="open-runner" data-runner-id="${escapeHtml(runner.id)}" type="button">查看详情</button>
          <button class="button ghost danger" data-action="delete-runner" data-runner-id="${escapeHtml(runner.id)}" type="button">删除</button>
        </div>
      </article>
    `;
  }).join('');
}

function refreshNewSessionToolOptions(runner) {
  const select = $('newSessionTool');
  const result = $('createSessionResult');
  const prev = String(select.value || '').toLowerCase();
  const supported = runnerSupportedTools(runner);
  select.innerHTML = '';

  if (!supported.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'no supported tool';
    select.appendChild(option);
    select.disabled = true;
    $('btnCreateSession').disabled = true;
    setInlineFeedback('createSessionResult', '当前 runner 未上报可用工具，暂不可创建会话。');
    return;
  }

  for (const tool of supported) {
    const option = document.createElement('option');
    option.value = tool;
    option.textContent = tool;
    select.appendChild(option);
  }

  select.disabled = false;
  $('btnCreateSession').disabled = false;
  select.value = supported.includes(prev) ? prev : supported[0];
  if (result.textContent.includes('未上报可用工具')) result.textContent = '';
}

function renderRunnerDetail() {
  const detail = state.runnerDetail;
  if (!detail || !detail.runner) return;

  const runner = detail.runner;
  const supportedTools = runnerSupportedTools(runner);
  $('detailRunnerTitle').textContent = runner.name || runner.id;
  $('detailRunnerSub').textContent =
    (runner.online ? '在线' : '离线') +
    ' · 最近心跳 ' + formatRelativeTime(runner.lastSeenAt) +
    ' · ' + formatDateTime(runner.lastSeenAt);
  $('detailCapabilitySummary').textContent =
    '当前 runner 支持 ' +
    (supportedTools.length ? supportedTools.map((tool) => toolLabel(tool)).join(' / ') : '0 个可用工具') +
    '，可直接用于新建会话。';

  $('detailTools').innerHTML = supportedTools.length
    ? supportedTools.map((tool) => `<span class="badge ok">${escapeHtml(toolLabel(tool))}</span>`).join('')
    : '<span class="badge warn">未上报工具</span>';

  const geminiHint = buildGeminiDiagnosticText(runner);
  $('detailToolHint').textContent = geminiHint;
  $('detailToolHint').classList.toggle('hidden', !geminiHint);

  const metrics = detail.metrics || {};
  const lastSeen = formatDateTime(runner.lastSeenAt);
  const tmux = runner && runner.capabilities && runner.capabilities.features && runner.capabilities.features.tmux === true
    ? 'available'
    : 'required / missing';
  $('detailMetrics').innerHTML = [
    ['Runner ID', runner.id],
    ['Platform', runnerPlatformLabel(runner)],
    ['在线状态', runner.online ? 'online' : 'offline'],
    ['最近心跳', lastSeen],
    ['活跃会话', String(detail.summary ? detail.summary.activeSessions : 0)],
    ['总会话', String(detail.summary ? detail.summary.totalSessions : 0)],
    ['tmux', tmux],
    ['Queue bytes', String(metrics.queueBytes || 0)],
    ['Queue frames', String(metrics.queueFrames || 0)],
  ].map(([label, value]) => `
    <div class="meta-item">
      <span>${escapeHtml(label)}</span>
      <strong class="${label === 'Runner ID' ? 'mono-line' : ''}">${escapeHtml(value)}</strong>
    </div>
  `).join('');
  $('detailCapabilities').textContent = JSON.stringify(runner.capabilities || {}, null, 2);

  refreshNewSessionToolOptions(runner);

  const allSessions = Array.isArray(detail.sessions) ? detail.sessions : [];
  const query = normalizeSearch(state.sessionSearch);
  const sessions = query ? allSessions.filter((session) => sessionMatchesSearch(session, query)) : allSessions;
  $('detailSessionSummary').textContent =
    '总会话 ' + (detail.summary ? detail.summary.totalSessions : allSessions.length) +
    ' · 活跃 ' + (detail.summary ? detail.summary.activeSessions : 0) +
    (query ? (' · 匹配 ' + sessions.length) : '');

  const host = $('detailSessionList');
  if (!sessions.length) {
    host.innerHTML = '<div class="empty-state">' + escapeHtml(query ? '没有匹配的会话。' : '暂无会话，可直接在上方创建。') + '</div>';
    return;
  }

  host.innerHTML = sessions.map((session) => {
    const status = String(session.status || 'created');
    const statusClass = status === 'running' || status === 'starting'
      ? 'connected'
      : (status === 'error' || status === 'exited' || status === 'ended' ? 'error' : 'connecting');
    const resumeCommand = buildClaudeResumeCommand(session);
    const geminiCommand = buildGeminiLaunchCommand(session, runner);
    return `
      <article class="session-card" data-session-id="${escapeHtml(session.id)}">
        <div class="session-headline">
          <div class="session-main">
            <strong>${escapeHtml(toolLabel(session.tool))}</strong>
            <div class="session-id">${escapeHtml(session.id)}</div>
          </div>
          <div class="status-strip">
            <span class="chip state ${statusClass}">${escapeHtml(status)}</span>
            <span class="badge neutral">${escapeHtml(session.createdBy || 'unknown')}</span>
          </div>
        </div>
        <div class="session-meta">
          <div class="meta-item">
            <span>Created</span>
            <strong>${escapeHtml(formatDateTime(session.createdAt))}</strong>
          </div>
          <div class="meta-item">
            <span>Project path</span>
            <strong class="mono-line">${escapeHtml(session.projectPath || '-')}</strong>
          </div>
          <div class="meta-item">
            <span>Runner</span>
            <strong class="mono-line">${escapeHtml(session.runnerId || '-')}</strong>
          </div>
        </div>
        <div class="session-actions">
          <button class="button primary" data-action="open-session" data-session-id="${escapeHtml(session.id)}" type="button">进入 Terminal</button>
          ${resumeCommand ? `<button class="button ghost" data-action="copy-claude" data-session-id="${escapeHtml(session.id)}" type="button">复制 Resume 命令</button>` : ''}
          ${geminiCommand ? `<button class="button ghost" data-action="copy-gemini" data-session-id="${escapeHtml(session.id)}" type="button">复制 Gemini 命令</button>` : ''}
          <button class="button ghost" data-action="stop-session" data-session-id="${escapeHtml(session.id)}" type="button"${status === 'running' || status === 'starting' || status === 'stopping' ? '' : ' disabled'}>停止</button>
          <button class="button ghost danger" data-action="delete-session" data-session-id="${escapeHtml(session.id)}" type="button">删除</button>
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
    state.sessionSummary = {
      total: sessions.length,
      active: sessions.filter((session) => ['running', 'starting', 'stopping'].includes(String(session.status || ''))).length,
    };
    setSummaryTiles();
    renderRunnerList();
  } catch (error) {
    if (showError) {
      const message = String((error && error.data && error.data.error) || (error && error.message) || '刷新失败');
      $('runnerList').innerHTML = '<div class="empty-state">加载失败：' + escapeHtml(message) + '</div>';
      notify({ type: 'error', title: '刷新 runner 失败', message });
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
    const message = String((error && error.data && error.data.error) || (error && error.message) || '加载 runner 详情失败');
    if (showError) {
      $('detailSessionList').innerHTML = '<div class="empty-state">' + escapeHtml(message) + '</div>';
      notify({ type: 'error', title: '读取 runner 详情失败', message });
    }
    if (error && error.status === 404) {
      showView('workspace');
      refreshRunnerList(false).catch(() => {});
    }
  }
}

async function openRunnerDetail(runnerId) {
  state.selectedRunnerId = runnerId;
  state.sessionSearch = '';
  $('sessionSearch').value = '';
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
    if (!tool) throw new Error('当前 runner 没有可用工具');
    const projectPath = $('newSessionPath').value.trim();
    const projectName = $('newSessionProjectName').value.trim();
    const payload = {
      tool,
      projectPath: projectPath || undefined,
      projectName: projectName || undefined,
    };
    const data = await api('POST', '/api/runners/' + encodeURIComponent(runnerId) + '/sessions', payload);
    setInlineFeedback('createSessionResult', '已创建 session：' + data.sessionId + '，正在进入 terminal…');
    $('newSessionProjectName').value = '';
    notify({
      type: 'success',
      title: '会话已创建',
      message: 'sessionId: ' + data.sessionId + '，准备启动终端。',
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
    const message = String((error && error.data && error.data.error) || (error && error.message) || '创建失败');
    setInlineFeedback('createSessionResult', message, 'error');
    notify({ type: 'error', title: '创建会话失败', message });
  } finally {
    $('btnCreateSession').disabled = $('newSessionTool').disabled;
  }
}

function getActiveDetailSession(sessionId) {
  const sessions = state.runnerDetail && Array.isArray(state.runnerDetail.sessions) ? state.runnerDetail.sessions : [];
  return sessions.find((session) => session.id === sessionId) || null;
}

function updateTerminalHeader(session) {
  $('termTitle').textContent = toolLabel(session.tool) + ' · ' + session.id;
  $('termMeta').textContent =
    'runner=' + session.runnerId +
    ' · status=' + String(session.status || 'created') +
    (session.projectPath ? (' · path=' + session.projectPath) : '');
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

async function openSession(session) {
  const runner = state.runnersAll.find((item) => item.id === session.runnerId);
  if (!runner || !runner.online) {
    notify({
      type: 'warn',
      title: 'Runner 已离线',
      message: '当前 runner 离线，无法进入 terminal。',
    });
    return;
  }
  state.activeSession = { ...session };
  state.returnView = 'runnerDetail';
  showView('terminal');
  updateTerminalHeader(state.activeSession);
  let initialOutput = '';
  try {
    const latest = await api('GET', '/api/sessions/' + encodeURIComponent(state.activeSession.id) + '/pty/latest');
    initialOutput = latest && typeof latest.data === 'string' ? latest.data : '';
  } catch {}
  try {
    await ensureSessionStarted(state.activeSession);
  } catch (error) {
    const message = String((error && error.data && error.data.error) || (error && error.message) || 'unknown');
    terminal.resetOutput();
    terminal.write('[start session failed: ' + message + ']\r\n');
    notify({ type: 'error', title: '启动 session 失败', message });
    return;
  }
  updateTerminalHeader(state.activeSession);
  await terminal.connect(state.activeSession.id, { initialOutput });
}

async function stopSession(sessionId) {
  try {
    await api('POST', '/api/sessions/' + encodeURIComponent(sessionId) + '/stop', {});
    notify({ type: 'success', title: '停止请求已发送', message: 'Session ' + sessionId + ' 正在停止。' });
  } catch (error) {
    const message = String((error && error.data && error.data.error) || (error && error.message) || '停止失败');
    notify({ type: 'error', title: '停止失败', message });
  }
  setTimeout(() => refreshRunnerDetail(false).catch(() => {}), 250);
}

async function deleteSession(sessionId) {
  const result = await modalShow({
    title: '删除会话',
    body: '删除会话会一并清理关联项目；若会话仍在运行，将执行 force 删除。',
    okText: '确认删除',
    cancelText: '取消',
    destructive: true,
  });
  if (!result.confirmed) return;
  try {
    await api('DELETE', '/api/sessions/' + encodeURIComponent(sessionId) + '?force=1');
    notify({ type: 'success', title: '会话已删除', message: sessionId });
    await refreshRunnerDetail(false);
  } catch (error) {
    const message = String((error && error.data && error.data.error) || (error && error.message) || '删除失败');
    notify({ type: 'error', title: '删除会话失败', message });
  }
}

async function deleteRunner(runnerId) {
  const result = await modalShow({
    title: '删除 runner',
    body: '离线 runner 会直接移除，在线 runner 会使用 force 删除并清理其会话与项目。',
    okText: '确认删除',
    cancelText: '取消',
    destructive: true,
  });
  if (!result.confirmed) return;
  try {
    await api('DELETE', '/api/runners/' + encodeURIComponent(runnerId) + '?force=1');
    setInlineFeedback('cleanupResult', '已删除 runner：' + runnerId);
    notify({ type: 'success', title: 'Runner 已删除', message: runnerId });
    if (state.selectedRunnerId === runnerId) {
      state.selectedRunnerId = '';
      state.runnerDetail = null;
      showView('workspace');
    }
    await refreshRunnerList(false);
  } catch (error) {
    const message = String((error && error.data && error.data.error) || (error && error.message) || '删除失败');
    notify({ type: 'error', title: '删除 runner 失败', message });
  }
}

async function copyClaudeResume(session) {
  const command = buildClaudeResumeCommand(session);
  if (!command) return;
  try {
    await copyTextToClipboard(command);
    notify({ type: 'success', title: '已复制 Claude Resume 命令', message: command, ttl: 2600 });
  } catch (error) {
    notify({
      type: 'error',
      title: '复制失败',
      message: String((error && error.message) || error || 'unknown'),
    });
  }
}

async function copyGeminiLaunch(session, runner) {
  const command = buildGeminiLaunchCommand(session, runner);
  if (!command) return;
  try {
    await copyTextToClipboard(command);
    notify({ type: 'success', title: '已复制 Gemini 启动命令', message: command, ttl: 2600 });
  } catch (error) {
    notify({
      type: 'error',
      title: '复制失败',
      message: String((error && error.message) || error || 'unknown'),
    });
  }
}

async function refreshAuth() {
  const me = await api('GET', '/api/auth/me');
  setAuth(me);
  setRiskBanner(me);
  return me;
}

async function refreshSettings() {
  const settings = await api('GET', '/api/admin/settings');
  const totp = settings && settings.web && settings.web.totp ? settings.web.totp : {};
  $('settingsSub').textContent = '当前用户：' + (settings && settings.web && settings.web.user ? settings.web.user : '-');
  if (totp && totp.configured) {
    $('totpStatus').textContent = '已配置两步验证。若需更换设备，请先删除再重新绑定。';
    $('btnTotpDisable').classList.remove('hidden');
    $('btnTotpEnable').classList.add('hidden');
  } else {
    $('totpStatus').textContent = '未配置两步验证。建议上线前立刻访问 /setup 完成绑定。';
    $('btnTotpDisable').classList.add('hidden');
    $('btnTotpEnable').classList.remove('hidden');
  }
  return settings;
}

async function saveAuthSettings() {
  $('btnSaveAuth').disabled = true;
  setInlineFeedback('saveAuthResult', '');
  try {
    const oldPassword = $('setOldPassword').value;
    const newUser = $('setNewUser').value.trim();
    const newPassword = $('setNewPassword').value;
    const response = await api('POST', '/api/admin/auth/change', { oldPassword, newUser, newPassword });
    setInlineFeedback('saveAuthResult', '已保存，正在退出当前会话。');
    notify({ type: 'success', title: '账号信息已保存', message: '需要重新登录后继续。' });
    if (response && response.relogin) await doLogout();
  } catch (error) {
    const message = String((error && error.data && error.data.error) || (error && error.message) || '保存失败');
    setInlineFeedback('saveAuthResult', message, 'error');
    notify({ type: 'error', title: '保存失败', message });
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
      title: '删除两步验证',
      body: '删除后会降低控制台安全性。请再次输入密码和当前动态码确认。',
      okText: '继续删除',
      cancelText: '取消',
      destructive: true,
      fields: [
        { key: 'password', label: '当前密码', placeholder: '必填', type: 'password' },
        { key: 'totp', label: '当前动态码', placeholder: '6 位动态码', inputmode: 'numeric', autocomplete: 'one-time-code' },
      ],
    });
    if (!result.confirmed) return;
    const password = String(result.values.password || '');
    const totp = String(result.values.totp || '').trim();
    if (!password || !totp) {
      notify({ type: 'warn', title: '信息不完整', message: '需要同时提供当前密码和动态码。' });
      return;
    }
    try {
      await api('POST', '/api/admin/totp/disable', { password, totp });
      setInlineFeedback('totpActionResult', '已删除两步验证。');
      notify({ type: 'success', title: '两步验证已删除', message: '如需上线，请尽快重新绑定。' });
      await refreshAuth();
      await refreshSettings();
    } catch (error) {
      const message = String((error && error.data && error.data.error) || (error && error.message) || '操作失败');
      setInlineFeedback('totpActionResult', message, 'error');
      notify({ type: 'error', title: '删除两步验证失败', message });
    }
    return;
  }

  setInlineFeedback('totpActionResult', '操作不支持', 'error');
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
      setInlineFeedback('loginError', '请输入动态码继续登录', 'error');
      try { $('authTotp').focus(); } catch {}
      return;
    }
    if (!response || !response.authenticated) throw new Error('登录失败');
    setAuth(response);
    setLoginTotpMode(false);
    showView('workspace');
    await refreshRunnerList(true);
    await refreshAuth();
    notify({ type: 'success', title: '登录成功', message: '欢迎回来，' + state.auth.user + '。', ttl: 2200 });
  } catch (error) {
    const message = String((error && error.data && error.data.error) || (error && error.message) || '登录失败');
    setInlineFeedback('loginError', message, 'error');
    if (message.includes('invalid credentials')) {
      setLoginTotpMode(false);
    } else {
      $('authTotp').value = '';
    }
    notify({ type: 'error', title: '登录失败', message });
  } finally {
    $('btnLogin').disabled = false;
  }
}

async function doLogout() {
  $('btnLogout').disabled = true;
  try {
    await api('POST', '/api/auth/logout', {});
  } catch {}
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
  $('btnThemeToggle').onclick = () => toggleTheme();
  $('loginForm').addEventListener('submit', doLogin);
  $('btnLogout').onclick = () => doLogout();
  $('btnRefreshRunners').onclick = () => refreshRunnerList(true);
  $('btnOpenSettings').onclick = async () => {
    showView('settings');
    try { await refreshSettings(); } catch {}
  };
  $('btnBackFromSettings').onclick = async () => {
    showView('workspace');
    await refreshRunnerList(false);
  };
  $('btnSaveAuth').onclick = () => saveAuthSettings();
  $('btnTotpDisable').onclick = () => totpAction('disable');
  $('btnTotpEnable').onclick = () => totpAction('enable');
  $('btnRiskAction').onclick = async () => {
    if (state.riskAction === 'setup') {
      location.href = '/setup';
      return;
    }
    showView('settings');
    await refreshSettings();
  };

  $('btnBackToRunners').onclick = async () => {
    showView('workspace');
    await refreshRunnerList(false);
  };
  $('btnRefreshDetail').onclick = () => refreshRunnerDetail(true);
  $('btnCreateSession').onclick = () => createSessionForRunner();
  $('runnerSearch').addEventListener('input', (ev) => {
    state.runnerSearch = String(ev.target && ev.target.value ? ev.target.value : '');
    renderRunnerList();
  });
  $('sessionSearch').addEventListener('input', (ev) => {
    state.sessionSearch = String(ev.target && ev.target.value ? ev.target.value : '');
    renderRunnerDetail();
  });

  $('btnBackFromTerminal').onclick = async () => {
    showView(state.returnView || 'runnerDetail');
    if (state.selectedRunnerId) await refreshRunnerDetail(false);
  };
  $('btnTermReconnect').onclick = async () => {
    if (!state.activeSession) return;
    await terminal.reconnect();
  };
  $('btnTermDisconnect').onclick = () => terminal.disconnect(true);

  $('modalMask').addEventListener('click', (ev) => {
    if (ev.target === $('modalMask')) {
      const done = modalResolve;
      modalHide();
      if (done) done({ confirmed: false, values: {} });
    }
  });

  bindRunnerListEvents();
  bindSessionListEvents();
}

async function bootstrap() {
  applyTheme(readThemePreference(), false);
  setSummaryTiles();
  terminal.init();
  bindUiEvents();

  try {
    const me = await refreshAuth();
    if (me && me.authenticated) {
      showView('workspace');
      await refreshRunnerList(true);
      return;
    }
  } catch {}

  resetAuth();
  showView('login');
}

bootstrap();
