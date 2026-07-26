const MOBILE_LAYOUT_QUERY = '(max-width: 820px), (pointer: coarse)';
const DEFAULT_TERM_FONT_SIZE_DESKTOP = 15;
const DEFAULT_TERM_FONT_SIZE_MOBILE = 16;
const MIN_TERM_FONT_SIZE = 13;
const MAX_TERM_FONT_SIZE = 22;
const MAX_SESSION_EVENTS = 2000;

const TERMINAL_PALETTE_MAP = {
  noir: { background: '#0a0f16', foreground: '#eff5ff', accent: '#7dd3fc', muted: 'rgba(239,245,255,0.62)' },
  dracula: { background: '#191a21', foreground: '#f8f8f2', accent: '#ff79c6', muted: 'rgba(248,248,242,0.58)' },
  gruvbox: { background: '#1d2021', foreground: '#ebdbb2', accent: '#fabd2f', muted: 'rgba(235,219,178,0.58)' },
  nord: { background: '#2e3440', foreground: '#e5e9f0', accent: '#88c0d0', muted: 'rgba(229,233,240,0.58)' },
  'tokyo-night': { background: '#1a1b26', foreground: '#c0caf5', accent: '#7aa2f7', muted: 'rgba(192,202,245,0.58)' },
  'solarized-dark': { background: '#002b36', foreground: '#93a1a1', accent: '#268bd2', muted: 'rgba(147,161,161,0.58)' },
  'solarized-light': { background: '#fdf6e3', foreground: '#586e75', accent: '#268bd2', muted: 'rgba(88,110,117,0.58)' },
  paper: { background: '#f7f3ea', foreground: '#111111', accent: '#db6b39', muted: 'rgba(17,17,17,0.56)' },
  amber: { background: '#0a0907', foreground: '#f3c776', accent: '#f3c776', muted: 'rgba(243,199,118,0.62)' },
};

function isMobileLayout() {
  return !!(window.matchMedia && window.matchMedia(MOBILE_LAYOUT_QUERY).matches);
}

function isCoarsePointer() {
  return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

function defaultTermFontSize() {
  return isMobileLayout() ? DEFAULT_TERM_FONT_SIZE_MOBILE : DEFAULT_TERM_FONT_SIZE_DESKTOP;
}

function clampTermFontSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return defaultTermFontSize();
  return Math.max(MIN_TERM_FONT_SIZE, Math.min(MAX_TERM_FONT_SIZE, Math.round(numeric)));
}

function getTerminalPalette(palette) {
  return TERMINAL_PALETTE_MAP[String(palette || '').toLowerCase()] || TERMINAL_PALETTE_MAP.noir;
}

function escapeHtml(raw) {
  return String(raw ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function summarizeContentBlock(block) {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'text') return String(block.text || '');
  if (block.type === 'resource_link') return String(block.title || block.name || block.uri || '');
  if (block.type === 'resource') {
    const resource = block.resource || {};
    if (resource.text) return String(resource.text);
    return String(resource.uri || '');
  }
  if (block.type === 'image') return '[image]';
  if (block.type === 'audio') return '[audio]';
  return '';
}

function summarizeContent(value) {
  if (Array.isArray(value)) return value.map((entry) => summarizeContentBlock(entry)).join('');
  return summarizeContentBlock(value);
}

function messageRoleFromUpdate(kind) {
  if (kind === 'user_message_chunk') return 'user';
  if (kind === 'agent_thought_chunk') return 'thought';
  return 'assistant';
}

function normalizeToolCall(update) {
  return {
    toolCallId: String(update.toolCallId || ''),
    title: String(update.title || ''),
    status: String(update.status || 'pending'),
    kind: String(update.kind || 'other'),
    content: Array.isArray(update.content) ? update.content.slice() : [],
    locations: Array.isArray(update.locations) ? update.locations.slice() : [],
    rawInput: update.rawInput,
    rawOutput: update.rawOutput,
  };
}

function applyToolCallUpdate(base, patch) {
  if (patch.title != null) base.title = String(patch.title || '');
  if (patch.status != null) base.status = String(patch.status || 'pending');
  if (patch.kind != null) base.kind = String(patch.kind || 'other');
  if (patch.content != null) base.content = Array.isArray(patch.content) ? patch.content.slice() : [];
  if (patch.locations != null) base.locations = Array.isArray(patch.locations) ? patch.locations.slice() : [];
  if (Object.prototype.hasOwnProperty.call(patch, 'rawInput')) base.rawInput = patch.rawInput;
  if (Object.prototype.hasOwnProperty.call(patch, 'rawOutput')) base.rawOutput = patch.rawOutput;
  return base;
}

function buildTimeline(events) {
  const items = [];
  const messageMap = new Map();
  const toolCallMap = new Map();
  const toolItemMap = new Map();
  let streamingMessage = null;

  for (const event of events || []) {
    if (!event || typeof event !== 'object') continue;

    if (event.type === 'system') {
      streamingMessage = null;
      items.push({
        kind: 'system',
        id: event.id,
        level: event.level || 'info',
        text: String(event.message || ''),
        ts: Number(event.ts || Date.now()),
      });
      continue;
    }

    if (event.type === 'prompt_result') {
      streamingMessage = null;
      items.push({
        kind: 'prompt_result',
        id: event.id,
        ok: event.ok !== false,
        stopReason: String(event.stopReason || ''),
        error: String(event.error || ''),
        ts: Number(event.ts || Date.now()),
      });
      continue;
    }

    if (event.type !== 'update' || !event.update) continue;
    const update = event.update;
    const sessionUpdate = String(update.sessionUpdate || '');

    if (
      sessionUpdate === 'agent_message_chunk'
      || sessionUpdate === 'user_message_chunk'
      || sessionUpdate === 'agent_thought_chunk'
    ) {
      const role = messageRoleFromUpdate(sessionUpdate);
      const explicitMessageId = String(update.messageId || '').trim();
      const chunk = summarizeContent(update.content);
      if (explicitMessageId) {
        const key = `${role}:${explicitMessageId}`;
        if (!messageMap.has(key)) {
          const item = {
            kind: 'message',
            id: key,
            role,
            text: chunk,
            ts: Number(event.ts || Date.now()),
          };
          messageMap.set(key, item);
          items.push(item);
        } else {
          messageMap.get(key).text += chunk;
        }
        streamingMessage = messageMap.get(key) || null;
        continue;
      }

      if (!streamingMessage || streamingMessage.kind !== 'message' || streamingMessage.role !== role) {
        const item = {
          kind: 'message',
          id: `${role}:stream:${event.id}`,
          role,
          text: chunk,
          ts: Number(event.ts || Date.now()),
        };
        items.push(item);
        streamingMessage = item;
      } else {
        streamingMessage.text += chunk;
      }
      continue;
    }

    if (sessionUpdate === 'plan') {
      streamingMessage = null;
      items.push({
        kind: 'plan',
        id: event.id,
        entries: Array.isArray(update.entries) ? update.entries.slice() : [],
        ts: Number(event.ts || Date.now()),
      });
      continue;
    }

    if (sessionUpdate === 'tool_call') {
      streamingMessage = null;
      const toolCall = normalizeToolCall(update);
      toolCallMap.set(toolCall.toolCallId, toolCall);
      const item = {
        kind: 'tool_call',
        id: `tool:${toolCall.toolCallId}`,
        toolCallId: toolCall.toolCallId,
        toolCall,
        ts: Number(event.ts || Date.now()),
      };
      toolItemMap.set(toolCall.toolCallId, item);
      items.push(item);
      continue;
    }

    if (sessionUpdate === 'tool_call_update') {
      streamingMessage = null;
      const toolCallId = String(update.toolCallId || '');
      const existing = toolCallMap.get(toolCallId) || normalizeToolCall(update);
      applyToolCallUpdate(existing, update);
      toolCallMap.set(toolCallId, existing);
      const item = toolItemMap.get(toolCallId);
      if (item) item.toolCall = existing;
      else {
        const created = {
          kind: 'tool_call',
          id: `tool:${toolCallId}`,
          toolCallId,
          toolCall: existing,
          ts: Number(event.ts || Date.now()),
        };
        toolItemMap.set(toolCallId, created);
        items.push(created);
      }
      continue;
    }

    streamingMessage = null;
    items.push({
      kind: 'generic',
      id: event.id,
      label: sessionUpdate,
      payload: update,
      ts: Number(event.ts || Date.now()),
    });
  }

  return items;
}

function lineCountOf(text) {
  const raw = String(text || '').trim();
  if (!raw) return 0;
  return raw.split(/\r?\n/).length;
}

function summarizeToolCall(toolCall, terminals) {
  const content = Array.isArray(toolCall && toolCall.content) ? toolCall.content : [];
  const locations = Array.isArray(toolCall && toolCall.locations) ? toolCall.locations : [];
  const fileSet = new Set();
  let terminalBlocks = 0;
  let diffBlocks = 0;
  let contentBlocks = 0;

  for (const location of locations) {
    const filePath = String(location && location.path ? location.path : '').trim();
    if (filePath) fileSet.add(filePath);
  }

  for (const entry of content) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type === 'terminal') {
      terminalBlocks += 1;
      const terminal = terminals && entry.terminalId ? terminals[entry.terminalId] : null;
      const output = terminal && terminal.output ? terminal.output : '';
      if (output && !fileSet.size && entry.cwd) fileSet.add(String(entry.cwd));
      continue;
    }
    if (entry.type === 'diff') {
      diffBlocks += 1;
      continue;
    }
    if (entry.type === 'content') {
      contentBlocks += 1;
    }
  }

  return {
    files: Array.from(fileSet.values()),
    terminalBlocks,
    diffBlocks,
    contentBlocks,
  };
}

function buildTurns(items, terminals) {
  const turns = [];
  let current = {
    index: 1,
    items: [],
    result: null,
    toolCalls: 0,
    files: new Set(),
  };

  const pushCurrentTurn = () => {
    if (!current.items.length) return;
    turns.push({
      index: current.index,
      items: current.items.slice(),
      result: current.result,
      toolCalls: current.toolCalls,
      files: Array.from(current.files.values()),
    });
    current = {
      index: turns.length + 1,
      items: [],
      result: null,
      toolCalls: 0,
      files: new Set(),
    };
  };

  for (const item of items || []) {
    current.items.push(item);
    if (item.kind === 'tool_call') {
      current.toolCalls += 1;
      const summary = summarizeToolCall(item.toolCall || {}, terminals);
      for (const filePath of summary.files) current.files.add(filePath);
    }
    if (item.kind === 'prompt_result') {
      current.result = item;
      pushCurrentTurn();
    }
  }

  if (current.items.length) pushCurrentTurn();
  return turns;
}

function collectRecentFiles(turns, limit = 8) {
  const seen = new Set();
  const out = [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    const files = Array.isArray(turn && turn.files) ? turn.files : [];
    for (let j = files.length - 1; j >= 0; j -= 1) {
      const filePath = String(files[j] || '').trim();
      if (!filePath || seen.has(filePath)) continue;
      seen.add(filePath);
      out.push(filePath);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function buildTurnFileGroups(turn, terminals) {
  const grouped = new Map();
  const items = Array.isArray(turn && turn.items) ? turn.items : [];
  for (const item of items) {
    if (!item || item.kind !== 'tool_call') continue;
    const toolCall = item.toolCall || {};
    const summary = summarizeToolCall(toolCall, terminals);
    const files = summary.files.length ? summary.files : ['[workspace]'];
    for (const filePath of files) {
      if (!grouped.has(filePath)) {
        grouped.set(filePath, {
          path: filePath,
          count: 0,
          kinds: new Set(),
          statuses: new Set(),
        });
      }
      const entry = grouped.get(filePath);
      entry.count += 1;
      entry.kinds.add(String(toolCall.kind || 'other'));
      entry.statuses.add(String(toolCall.status || 'pending'));
    }
  }
  return Array.from(grouped.values()).sort((a, b) => {
    if (a.path === '[workspace]') return 1;
    if (b.path === '[workspace]') return -1;
    return a.path.localeCompare(b.path);
  });
}

export function createTerminalController({
  $,
  api,
  getTheme,
  getPalette,
  t = (key) => key,
  translateError = (message) => message,
  onError,
  onStatusChange,
}) {
  const STARTER_PROMPT_KEYS = [
    'terminal.starter.audit',
    'terminal.starter.fix',
    'terminal.starter.summary',
  ];
  let termWs = null;
  let activeSessionId = '';
  let activeView = false;
  let connectionState = 'disconnected';
  let networkOnline = navigator.onLine !== false;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let manualDisconnect = false;
  let connectSeq = 0;
  let suppressFocusScroll = false;
  let lastErrorNoticeAt = 0;
  let termFontSize = defaultTermFontSize();
  let composerDraft = '';
  let pendingComposerFocus = false;
  let sessionState = {
    events: [],
    terminals: {},
    pendingPermissions: {},
    meta: {},
  };

  function tt(key, params) {
    try {
      return t(key, params);
    } catch {
      return key;
    }
  }

  function setTermConnection(status) {
    connectionState = String(status || 'disconnected');
    if (typeof onStatusChange === 'function') {
      onStatusChange(connectionState, tt('terminal.status.' + connectionState));
    }
    render();
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect(immediate = false) {
    if (!activeSessionId || manualDisconnect || !networkOnline || reconnectTimer) return;
    const delay = immediate ? 0 : Math.min(6000, 600 + reconnectAttempt * 900);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectAttempt += 1;
      void reconnect().catch((error) => {
        if (error && error.status === 401) return;
        scheduleReconnect(false);
      });
    }, delay);
  }

  function applySurface() {
    const host = $('termHost');
    if (!host) return;
    const colors = getTerminalPalette(typeof getPalette === 'function' ? getPalette() : 'noir');
    host.classList.add('acp-host');
    host.style.setProperty('--term-surface', colors.background);
    host.style.setProperty('--term-foreground', colors.foreground);
    host.style.setProperty('--term-accent', colors.accent);
    host.style.setProperty('--term-muted', colors.muted);
    host.style.setProperty('--term-font-size', termFontSize + 'px');
  }

  function scrollStreamToBottom(force = false) {
    const stream = document.querySelector('#termHost .acp-stream');
    if (!stream) return;
    const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 64;
    if (force || nearBottom) stream.scrollTop = stream.scrollHeight;
  }

  function resizeComposerInput(input) {
    if (!input) return;
    input.style.height = 'auto';
    const nextHeight = Math.min(Math.max(input.scrollHeight, 92), 240);
    input.style.height = `${nextHeight}px`;
  }

  function scrollComposerIntoView(input) {
    if (!input) return;
    const composer = input.closest('.acp-composer');
    if (composer && typeof composer.scrollIntoView === 'function') {
      setTimeout(() => {
        try {
          composer.scrollIntoView({ block: 'end', behavior: isMobileLayout() ? 'smooth' : 'auto' });
        } catch {
          composer.scrollIntoView(false);
        }
        scrollStreamToBottom(true);
      }, 40);
    }
  }

  function focusComposer(input, restoreSelection = null, scrollIntoView = true) {
    if (!input || typeof input.focus !== 'function') return;
    if (!scrollIntoView) suppressFocusScroll = true;
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
    suppressFocusScroll = false;
    if (restoreSelection && typeof input.setSelectionRange === 'function') {
      const start = Math.max(0, Math.min(Number(restoreSelection.start || 0), input.value.length));
      const end = Math.max(start, Math.min(Number(restoreSelection.end || start), input.value.length));
      try {
        input.setSelectionRange(start, end);
      } catch {
        // ignore selection restore failures
      }
    }
  }

  function renderStarterButtons() {
    return STARTER_PROMPT_KEYS.map((key) => `
      <button type="button" class="acp-starter-btn" data-starter-prompt="${escapeHtml(tt(key))}">
        ${escapeHtml(tt(key))}
      </button>
    `).join('');
  }

  function renderMessage(item) {
    return `
      <article class="acp-message acp-role-${escapeHtml(item.role)}">
        <header class="acp-card-head">
          <span class="acp-chip">${escapeHtml(tt('terminal.role.' + item.role))}</span>
        </header>
        <div class="acp-rich-text">${escapeHtml(item.text || '').replace(/\n/g, '<br/>')}</div>
      </article>
    `;
  }

  function renderPlan(item) {
    const entries = Array.isArray(item.entries) ? item.entries : [];
    return `
      <article class="acp-card">
        <header class="acp-card-head">
          <span class="acp-chip">${escapeHtml(tt('terminal.planTitle'))}</span>
        </header>
        <div class="acp-plan-list">
          ${entries.map((entry) => `
            <div class="acp-plan-item" data-status="${escapeHtml(String(entry.status || 'pending'))}">
              <span class="acp-plan-dot"></span>
              <strong>${escapeHtml(String(entry.content || ''))}</strong>
            </div>
          `).join('')}
        </div>
      </article>
    `;
  }

  function renderToolCall(item) {
    const toolCall = item.toolCall || {};
    const content = Array.isArray(toolCall.content) ? toolCall.content : [];
    const locations = Array.isArray(toolCall.locations) ? toolCall.locations : [];
    const defaultExpanded = toolCall.status === 'running' || toolCall.status === 'error';
    const renderedContent = content.map((entry, entryIndex) => {
      if (!entry || typeof entry !== 'object') return '';
      const disclosureId = escapeHtml(`${toolCall.toolCallId || item.id}:${entryIndex}`);
      if (entry.type === 'terminal') {
        const terminal = sessionState.terminals && sessionState.terminals[entry.terminalId];
        const output = terminal && terminal.output ? terminal.output : '';
        return `
          <details class="acp-disclosure" data-disclosure-id="${disclosureId}"${defaultExpanded ? ' open' : ''}>
            <summary>
              <span>${escapeHtml(tt('terminal.sectionOutput'))}</span>
              <span>${escapeHtml(tt('terminal.linesUnit', { count: lineCountOf(output) }))}</span>
            </summary>
            <div class="acp-tool-terminal">
              <div class="acp-tool-terminal-head">
                <span>${escapeHtml(tt('terminal.toolTerminal'))}</span>
                <span>${escapeHtml(entry.terminalId || '')}</span>
              </div>
              <pre>${escapeHtml(output)}</pre>
            </div>
          </details>
        `;
      }
      if (entry.type === 'content') {
        return `
          <details class="acp-disclosure" data-disclosure-id="${disclosureId}"${defaultExpanded ? ' open' : ''}>
            <summary>
              <span>${escapeHtml(tt('terminal.sectionContent'))}</span>
            </summary>
            <div class="acp-tool-content">${escapeHtml(summarizeContentBlock(entry.content || {})).replace(/\n/g, '<br/>')}</div>
          </details>
        `;
      }
      if (entry.type === 'diff') {
        const diffText = String(entry.diff || entry.patch || '').trim();
        return `
          <details class="acp-disclosure" data-disclosure-id="${disclosureId}"${defaultExpanded ? ' open' : ''}>
            <summary>
              <span>${escapeHtml(tt('terminal.sectionDiff'))}</span>
              <span>${escapeHtml(tt('terminal.linesUnit', { count: lineCountOf(diffText) }))}</span>
            </summary>
            <pre class="acp-tool-diff">${escapeHtml(diffText)}</pre>
          </details>
        `;
      }
      return '';
    }).join('');

    return `
      <article class="acp-card acp-tool-card" data-status="${escapeHtml(String(toolCall.status || 'pending'))}">
        <header class="acp-card-head">
          <span class="acp-chip">${escapeHtml(tt('terminal.toolKind.' + String(toolCall.kind || 'other')))}</span>
          <span class="acp-chip subtle">${escapeHtml(String(toolCall.status || 'pending'))}</span>
        </header>
        <h3>${escapeHtml(String(toolCall.title || tt('terminal.toolCallFallback')))}</h3>
        ${locations.length ? `
          <div class="acp-location-list">
            ${locations.map((location) => `<span class="acp-location-pill">${escapeHtml(String(location.path || ''))}</span>`).join('')}
          </div>
        ` : ''}
        ${renderedContent || `<div class="acp-tool-empty">${escapeHtml(tt('terminal.sectionEmpty'))}</div>`}
      </article>
    `;
  }

  function renderSystem(item) {
    return `
      <article class="acp-system acp-system-${escapeHtml(item.level)}">
        ${escapeHtml(item.text)}
      </article>
    `;
  }

  function renderGeneric(item) {
    return `
      <article class="acp-card">
        <header class="acp-card-head">
          <span class="acp-chip subtle">${escapeHtml(item.label || 'update')}</span>
        </header>
        <pre class="acp-json">${escapeHtml(JSON.stringify(item.payload || {}, null, 2))}</pre>
      </article>
    `;
  }

  function renderPromptResult(item) {
    const text = item.ok
      ? tt('terminal.promptFinished', { reason: item.stopReason || 'end_turn' })
      : tt('terminal.promptFailed', { message: item.error || tt('label.unknown') });
    return `
      <article class="acp-system ${item.ok ? 'acp-system-info' : 'acp-system-error'}">
        ${escapeHtml(text)}
      </article>
    `;
  }

  function renderPermissions() {
    const pending = Object.values(sessionState.pendingPermissions || {});
    if (!pending.length) return '';
    return pending.map((permission) => `
      <section class="acp-permission-card" data-request-id="${escapeHtml(permission.requestId)}">
        <div class="acp-permission-copy">
          <span class="acp-chip danger">${escapeHtml(tt('terminal.permissionTitle'))}</span>
          <strong>${escapeHtml(String((permission.toolCall && permission.toolCall.title) || tt('terminal.toolCallFallback')))}</strong>
        </div>
        <div class="acp-permission-actions">
          ${(permission.options || []).map((option) => `
            <button type="button" class="acp-permission-btn" data-option-id="${escapeHtml(option.optionId || '')}">
              ${escapeHtml(String(option.name || option.optionId || 'Select'))}
            </button>
          `).join('')}
        </div>
      </section>
    `).join('');
  }

  function renderWorkspaceStrip(turns) {
    const recentFiles = collectRecentFiles(turns, isMobileLayout() ? 4 : 8);
    const toolCalls = turns.reduce((total, turn) => total + Number(turn.toolCalls || 0), 0);
    const pendingPermissions = Object.keys(sessionState.pendingPermissions || {}).length;
    return `
      <section class="acp-workspace-strip">
        <div class="acp-workspace-head">
          <div class="acp-workspace-title">
            <span class="acp-chip subtle">${escapeHtml(tt('terminal.workspaceTitle'))}</span>
            <div class="acp-workspace-inline-stats">
              <span><strong>${escapeHtml(String(turns.length || 0))}</strong>${escapeHtml(tt('terminal.workspaceTurns'))}</span>
              <span><strong>${escapeHtml(String(toolCalls))}</strong>${escapeHtml(tt('terminal.workspaceTools'))}</span>
              <span><strong>${escapeHtml(String(pendingPermissions))}</strong>${escapeHtml(tt('terminal.workspaceApprovals'))}</span>
            </div>
          </div>
        </div>
        <div class="acp-workspace-stats">
          <div class="acp-workspace-stat">
            <span>${escapeHtml(tt('terminal.workspaceTurns'))}</span>
            <strong>${escapeHtml(String(turns.length || 0))}</strong>
          </div>
          <div class="acp-workspace-stat">
            <span>${escapeHtml(tt('terminal.workspaceTools'))}</span>
            <strong>${escapeHtml(String(toolCalls))}</strong>
          </div>
          <div class="acp-workspace-stat">
            <span>${escapeHtml(tt('terminal.workspaceApprovals'))}</span>
            <strong>${escapeHtml(String(pendingPermissions))}</strong>
          </div>
        </div>
        <div class="acp-workspace-files">
          <span class="acp-workspace-label">${escapeHtml(tt('terminal.workspaceFiles'))}</span>
          <div class="acp-location-list acp-location-rail">
            ${recentFiles.length
              ? recentFiles.map((filePath) => `<span class="acp-location-pill">${escapeHtml(filePath)}</span>`).join('')
              : `<span class="acp-location-pill muted">${escapeHtml(tt('terminal.workspaceNoFiles'))}</span>`}
          </div>
        </div>
      </section>
    `;
  }

  function renderTurn(turn) {
    const items = Array.isArray(turn.items) ? turn.items : [];
    const fileGroups = buildTurnFileGroups(turn, sessionState.terminals || {});
    const mobile = isMobileLayout();
    return `
      <section class="acp-turn">
        <header class="acp-turn-head">
          <div>
            <strong>${escapeHtml(tt('terminal.turnLabel', { index: turn.index }))}</strong>
            <p>${escapeHtml(tt('terminal.turnMeta', {
              tools: turn.toolCalls || 0,
              files: Array.isArray(turn.files) ? turn.files.length : 0,
            }))}</p>
          </div>
          ${mobile ? '' : `<span class="acp-chip subtle">${escapeHtml(tt('terminal.turnOpen'))}</span>`}
        </header>
        ${fileGroups.length ? `
          <div class="acp-turn-files">
            ${fileGroups.map((group) => `
              <article class="acp-file-card">
                <div class="acp-file-card-head">
                  <strong>${escapeHtml(group.path)}</strong>
                  <span>${escapeHtml(String(group.count))}</span>
                </div>
                <div class="acp-file-card-meta">
                  ${Array.from(group.kinds.values()).map((kind) => `<span class="acp-chip subtle">${escapeHtml(tt('terminal.toolKind.' + kind))}</span>`).join('')}
                </div>
              </article>
            `).join('')}
          </div>
        ` : ''}
        <div class="acp-turn-body">
          ${items.map((item) => {
            if (item.kind === 'message') return renderMessage(item);
            if (item.kind === 'plan') return renderPlan(item);
            if (item.kind === 'tool_call') return renderToolCall(item);
            if (item.kind === 'system') return renderSystem(item);
            if (item.kind === 'prompt_result') return renderPromptResult(item);
            return renderGeneric(item);
          }).join('')}
        </div>
      </section>
    `;
  }

  function renderEmptyState() {
    if (connectionState === 'connecting') {
      return `
        <section class="acp-empty-state">
          <div class="acp-empty-copy">
            <span class="acp-chip subtle">${escapeHtml(tt('terminal.status.connecting'))}</span>
            <h3>${escapeHtml(tt('terminal.emptyConnectingTitle'))}</h3>
            <p>${escapeHtml(tt('terminal.emptyConnectingBody'))}</p>
          </div>
          <span class="acp-empty-spinner" aria-hidden="true"></span>
        </section>
      `;
    }
    if (connectionState === 'error') {
      return `
        <section class="acp-empty-state">
          <div class="acp-empty-copy">
            <span class="acp-chip danger">${escapeHtml(tt('terminal.status.error'))}</span>
            <h3>${escapeHtml(tt('terminal.emptyErrorTitle'))}</h3>
            <p>${escapeHtml(tt('terminal.emptyErrorBody'))}</p>
          </div>
        </section>
      `;
    }
    const eyebrow = connectionState === 'connected'
      ? tt('terminal.emptyEyebrow')
      : tt('terminal.status.' + connectionState);
    return `
      <section class="acp-empty-state">
        <div class="acp-empty-copy">
          <span class="acp-chip subtle">${escapeHtml(eyebrow)}</span>
          <h3>${escapeHtml(tt('terminal.emptyTitle'))}</h3>
          <p>${escapeHtml(tt('terminal.emptyBody'))}</p>
        </div>
        <div class="acp-starter-grid">${renderStarterButtons()}</div>
      </section>
    `;
  }

  function render() {
    const host = $('termHost');
    if (!host) return;
    const previousInput = document.getElementById('acpPromptInput');
    const shouldRestoreFocus = !!(previousInput && document.activeElement === previousInput);
    const selection = shouldRestoreFocus
      ? {
          start: previousInput.selectionStart || 0,
          end: previousInput.selectionEnd || previousInput.selectionStart || 0,
        }
      : null;
    const previousStream = host.querySelector('.acp-stream');
    const streamScroll = previousStream
      ? {
          top: previousStream.scrollTop,
          nearBottom: previousStream.scrollHeight - previousStream.scrollTop - previousStream.clientHeight < 64,
        }
      : null;
    const disclosureState = new Map();
    host.querySelectorAll('details[data-disclosure-id]').forEach((node) => {
      disclosureState.set(node.getAttribute('data-disclosure-id'), node.hasAttribute('open'));
    });
    applySurface();
    const timeline = buildTimeline(sessionState.events || []);
    const turns = buildTurns(timeline, sessionState.terminals || {});
    const mobile = isMobileLayout();
    host.innerHTML = `
      <div class="acp-surface">
        ${mobile ? '' : renderWorkspaceStrip(turns)}
        <div class="acp-stream">${timeline.length
          ? turns.map((turn) => renderTurn(turn)).join('')
          : renderEmptyState()}</div>
        <div class="acp-permissions" aria-live="polite">${renderPermissions()}</div>
        <form class="acp-composer" id="acpComposerForm">
          <label class="acp-composer-label" for="acpPromptInput">${escapeHtml(tt('terminal.composerLabel'))}</label>
          <textarea id="acpPromptInput" class="acp-composer-input" rows="3" placeholder="${escapeHtml(tt('terminal.composerPlaceholder'))}"></textarea>
          <div class="acp-composer-actions">
            <button type="submit" class="button primary">${escapeHtml(tt('terminal.sendPrompt'))}</button>
            <button type="button" class="button ghost" id="acpStopTurn">${escapeHtml(tt('terminal.cancelTurn'))}</button>
          </div>
        </form>
      </div>
    `;

    host.querySelectorAll('details[data-disclosure-id]').forEach((node) => {
      const key = node.getAttribute('data-disclosure-id');
      if (disclosureState.has(key)) node.toggleAttribute('open', disclosureState.get(key) === true);
    });

    const form = $('acpComposerForm') || document.getElementById('acpComposerForm');
    const input = $('acpPromptInput') || document.getElementById('acpPromptInput');
    const stop = $('acpStopTurn') || document.getElementById('acpStopTurn');
    if (form) {
      form.onsubmit = async (event) => {
        event.preventDefault();
        await submitPrompt();
      };
    }
    if (input) {
      input.value = composerDraft;
      input.style.fontSize = (isCoarsePointer() ? Math.max(16, termFontSize) : termFontSize) + 'px';
      resizeComposerInput(input);
      input.oninput = () => {
        composerDraft = String(input.value || '');
        resizeComposerInput(input);
      };
      input.onfocus = () => {
        if (suppressFocusScroll) return;
        scrollComposerIntoView(input);
      };
      input.onkeydown = async (event) => {
        if (event.key !== 'Enter' || event.shiftKey || isMobileLayout()) return;
        event.preventDefault();
        await submitPrompt();
      };
      if (shouldRestoreFocus || pendingComposerFocus) {
        focusComposer(input, selection, false);
        pendingComposerFocus = false;
      }
    }
    if (stop) {
      stop.onclick = async () => {
        if (!activeSessionId) return;
        try {
          await api('POST', '/api/sessions/' + encodeURIComponent(activeSessionId) + '/cancel', {});
        } catch (error) {
          if (typeof onError === 'function') onError(translateError(String(error && error.message ? error.message : error)));
        }
      };
    }

    host.querySelectorAll('.acp-permission-card').forEach((card) => {
      card.querySelectorAll('[data-option-id]').forEach((button) => {
        button.addEventListener('click', async () => {
          const optionId = button.getAttribute('data-option-id') || '';
          const requestId = card.getAttribute('data-request-id') || '';
          if (!activeSessionId || !requestId || !optionId) return;
          try {
            await api('POST', '/api/sessions/' + encodeURIComponent(activeSessionId) + '/permission', { requestId, optionId });
          } catch (error) {
            if (typeof onError === 'function') onError(translateError(String(error && error.message ? error.message : error)));
          }
        });
      });
    });

    host.querySelectorAll('[data-starter-prompt]').forEach((button) => {
      button.addEventListener('click', () => {
        const prompt = String(button.getAttribute('data-starter-prompt') || '').trim();
        if (!prompt) return;
        composerDraft = prompt;
        const nextInput = document.getElementById('acpPromptInput');
        if (!nextInput) return;
        nextInput.value = composerDraft;
        resizeComposerInput(nextInput);
        pendingComposerFocus = true;
        focusComposer(nextInput, {
          start: composerDraft.length,
          end: composerDraft.length,
        });
      });
    });

    const stream = host.querySelector('.acp-stream');
    if (stream) {
      if (!streamScroll || streamScroll.nearBottom) stream.scrollTop = stream.scrollHeight;
      else stream.scrollTop = streamScroll.top;
    }
  }

  async function submitPrompt() {
    if (!activeSessionId) return;
    const input = document.getElementById('acpPromptInput');
    const text = input ? String(input.value || '').trim() : '';
    if (!text) return;
    try {
      await api('POST', '/api/sessions/' + encodeURIComponent(activeSessionId) + '/prompt', { text });
      composerDraft = '';
      input.value = '';
      resizeComposerInput(input);
      pendingComposerFocus = true;
      if (activeView) input.focus();
    } catch (error) {
      const raw = String((error && error.data && error.data.error) || (error && error.message) || 'prompt failed');
      const message = translateError(raw);
      if (typeof onError === 'function') onError(message);
      pushLocalEvent({
        id: 'system-' + Date.now(),
        type: 'system',
        level: 'error',
        message,
        ts: Date.now(),
      });
    }
  }

  function appendSessionEvent(event) {
    const next = [...sessionState.events, event];
    sessionState.events = next.length > MAX_SESSION_EVENTS ? next.slice(-MAX_SESSION_EVENTS) : next;
  }

  function pushLocalEvent(event) {
    appendSessionEvent(event);
    render();
  }

  async function loadActivity(sessionId, seq) {
    const response = await api('GET', '/api/sessions/' + encodeURIComponent(sessionId) + '/activity');
    if (seq !== undefined && seq !== connectSeq) return;
    sessionState = response && response.activity
      ? {
          events: Array.isArray(response.activity.events)
            ? response.activity.events.slice(-MAX_SESSION_EVENTS)
            : [],
          terminals: response.activity.terminals || {},
          pendingPermissions: response.activity.pendingPermissions || {},
          meta: response.activity.meta || {},
        }
      : { events: [], terminals: {}, pendingPermissions: {}, meta: {} };
    render();
  }

  function handleSocketMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'activity_snapshot' && message.snapshot) {
      sessionState = {
        events: Array.isArray(message.snapshot.events)
          ? message.snapshot.events.slice(-MAX_SESSION_EVENTS)
          : [],
        terminals: message.snapshot.terminals || {},
        pendingPermissions: message.snapshot.pendingPermissions || {},
        meta: message.snapshot.meta || {},
      };
      render();
      return;
    }
    if (message.type === 'activity_event' && message.event) {
      appendSessionEvent(message.event);
      render();
      return;
    }
    if (message.type === 'activity_meta') {
      sessionState.meta = message.meta || {};
      render();
      return;
    }
    if (message.type === 'terminal_snapshot' && message.terminal) {
      sessionState.terminals = {
        ...sessionState.terminals,
        [message.terminal.terminalId]: message.terminal,
      };
      render();
      return;
    }
    if (message.type === 'permission_pending' && message.permission) {
      sessionState.pendingPermissions = {
        ...sessionState.pendingPermissions,
        [message.permission.requestId]: message.permission,
      };
      render();
      return;
    }
    if (message.type === 'permission_resolved' && message.requestId) {
      const next = { ...sessionState.pendingPermissions };
      delete next[message.requestId];
      sessionState.pendingPermissions = next;
      render();
    }
  }

  function connectSocket(sessionId, seq) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/session?sessionId=${encodeURIComponent(sessionId)}`;
    manualDisconnect = false;
    const socket = new WebSocket(url);
    termWs = socket;
    socket.onopen = () => {
      if (socket !== termWs || seq !== connectSeq) return;
      reconnectAttempt = 0;
      clearReconnectTimer();
      setTermConnection('connected');
    };
    socket.onmessage = (event) => {
      if (socket !== termWs || seq !== connectSeq) return;
      try {
        handleSocketMessage(JSON.parse(event.data));
      } catch {
        // ignore malformed session activity frames
      }
    };
    socket.onerror = () => {
      if (socket !== termWs || seq !== connectSeq) return;
      setTermConnection('error');
      if (typeof onError === 'function' && Date.now() - lastErrorNoticeAt > 4000) {
        lastErrorNoticeAt = Date.now();
        onError(tt('terminal.connectionFailed'));
      }
      scheduleReconnect(false);
    };
    socket.onclose = () => {
      if (socket !== termWs || seq !== connectSeq) return;
      if (connectionState !== 'error') setTermConnection('disconnected');
      scheduleReconnect(false);
    };
  }

  async function connect(sessionId, options = {}) {
    const resetState = options.resetState !== false;
    const seq = ++connectSeq;
    clearReconnectTimer();
    disconnect(false);
    activeSessionId = String(sessionId || '');
    if (resetState) {
      composerDraft = '';
      sessionState = { events: [], terminals: {}, pendingPermissions: {}, meta: {} };
    }
    pendingComposerFocus = true;
    setTermConnection('connecting');
    render();
    try {
      await loadActivity(activeSessionId, seq);
    } catch (error) {
      if (seq === connectSeq) setTermConnection('error');
      throw error;
    }
    if (seq !== connectSeq) return;
    connectSocket(activeSessionId, seq);
  }

  function disconnect(userInitiated = false) {
    manualDisconnect = userInitiated;
    clearReconnectTimer();
    if (termWs) {
      try {
        termWs.close(userInitiated ? 1000 : 1001, userInitiated ? 'manual disconnect' : 'reconnect');
      } catch {
        // ignore close failures
      }
      termWs = null;
    }
    setTermConnection('disconnected');
  }

  function reconnect() {
    if (!activeSessionId) return Promise.resolve();
    return connect(activeSessionId, { resetState: false });
  }

  function setNetworkStatus(nextOnline) {
    networkOnline = nextOnline !== false;
    if (networkOnline && activeView && activeSessionId && connectionState !== 'connected' && !manualDisconnect) {
      scheduleReconnect(true);
      return;
    }
    if (!networkOnline) clearReconnectTimer();
  }

  function resume() {
    if (!activeSessionId || !networkOnline || manualDisconnect || connectionState === 'connected') return Promise.resolve();
    clearReconnectTimer();
    return reconnect();
  }

  function setFontSize(nextSize) {
    const next = clampTermFontSize(nextSize);
    if (next === termFontSize) return;
    termFontSize = next;
    render();
  }

  function adjustFontSize(delta) {
    setFontSize(termFontSize + Number(delta || 0));
  }

  function init() {
    if (window.matchMedia) {
      try {
        window.matchMedia(MOBILE_LAYOUT_QUERY).addEventListener('change', () => render());
      } catch {
        // ignore matchMedia listener failures on older engines
      }
    }
    render();
  }

  function refreshCopy() {
    render();
  }

  function write(text) {
    pushLocalEvent({
      id: 'local-' + Date.now(),
      type: 'system',
      level: 'info',
      message: String(text || ''),
      ts: Date.now(),
    });
  }

  function resetOutput() {
    composerDraft = '';
    sessionState = {
      events: [],
      terminals: {},
      pendingPermissions: {},
      meta: sessionState.meta || {},
    };
    render();
  }

  function setActive(next) {
    activeView = !!next;
    if (activeView) {
      pendingComposerFocus = true;
      const input = document.getElementById('acpPromptInput');
      if (input && typeof input.focus === 'function') {
        focusComposer(input);
      }
    }
  }

  function setTheme() {
    applySurface();
  }

  function setPalette() {
    applySurface();
    render();
  }

  return {
    init,
    connect,
    reconnect,
    resume,
    disconnect,
    setNetworkStatus,
    setActive,
    setTheme,
    setPalette,
    refreshCopy,
    write,
    resetOutput,
    adjustFontSize,
  };
}
