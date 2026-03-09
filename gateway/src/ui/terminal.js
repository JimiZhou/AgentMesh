const TERM_ENCODER = new TextEncoder();
const TERM_DECODER = new TextDecoder();
const DEFAULT_TERM_COLS = 120;
const DEFAULT_TERM_ROWS = 34;
const BASIC_TERM_MAX_CHARS = 200000;
const MOBILE_TERM_ACTIONS = {
  esc: '\x1b',
  tab: '\t',
  enter: '\r',
  backspace: '\x7f',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  home: '\x1b[H',
  end: '\x1b[F',
  pgup: '\x1b[5~',
  pgdn: '\x1b[6~',
};
const MOBILE_TERM_REPEATABLE_KEYS = new Set(['up', 'down', 'left', 'right', 'backspace']);
const MOBILE_TERM_REPEAT_DELAY_MS = 320;
const MOBILE_TERM_REPEAT_INTERVAL_MS = 68;

function getXtermTheme(theme) {
  if (theme === 'dark') {
    return {
      background: '#040609',
      foreground: '#f4f7fa',
      cursor: '#f4f7fa',
      cursorAccent: '#040609',
      selectionBackground: 'rgba(148, 163, 184, 0.35)',
    };
  }
  return {
    background: '#131214',
    foreground: '#f5f5f4',
    cursor: '#f5f5f4',
    cursorAccent: '#131214',
    selectionBackground: 'rgba(251, 191, 36, 0.22)',
  };
}

function termWsUrl(sessionId) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return proto + '//' + location.host + '/ws/terminal?sessionId=' + encodeURIComponent(sessionId);
}

export function createTerminalController({ $, api, getTheme, onError }) {
  let termMode = 'none';
  let term = null;
  let fitAddon = null;
  let basicOut = null;
  let termWs = null;
  let activeSessionId = '';
  let pendingTermOutput = '';
  let termFlushTimer = 0;
  let resizeRafId = 0;
  let cursorRafId = 0;
  let viewportRafId = 0;
  let resizeObserver = null;
  let activeView = false;
  let mobileTermCtrlLock = false;
  let mobileTermAltLock = false;
  let mobileTermRepeatDelayTimer = 0;
  let mobileTermRepeatIntervalTimer = 0;

  function setTermConnection(status, label = '') {
    const pill = $('termConn');
    if (!pill) return;
    const normalized = String(status || 'disconnected');
    const map = {
      connected: '已连接',
      connecting: '连接中',
      disconnected: '未连接',
      error: '连接异常',
    };
    pill.className = 'chip state ' + normalized;
    pill.textContent = label || map[normalized] || normalized;
  }

  function updateTermCursorIndicator() {
    const pill = $('termCursor');
    if (!pill) return;
    if (termMode === 'xterm' && term && term.buffer && term.buffer.active) {
      const row = term.buffer.active.cursorY + 1;
      const col = term.buffer.active.cursorX + 1;
      pill.textContent = '光标 ' + row + ':' + col;
      return;
    }
    pill.textContent = '光标 -:-';
  }

  function scheduleCursorRefresh() {
    if (cursorRafId) return;
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn) => setTimeout(fn, 16);
    cursorRafId = raf(() => {
      cursorRafId = 0;
      updateTermCursorIndicator();
    });
  }

  function flushTermOutput() {
    termFlushTimer = 0;
    const chunk = pendingTermOutput;
    pendingTermOutput = '';
    if (!chunk) return;
    if (termMode === 'xterm' && term) {
      term.write(chunk, () => scheduleCursorRefresh());
      return;
    }
    if (termMode === 'basic' && basicOut) {
      const next = (basicOut.textContent || '') + chunk;
      basicOut.textContent = next.length > BASIC_TERM_MAX_CHARS ? next.slice(-BASIC_TERM_MAX_CHARS) : next;
      basicOut.scrollTop = basicOut.scrollHeight;
    }
  }

  function write(text) {
    const next = String(text || '');
    if (!next) return;
    pendingTermOutput += next;
    if (termFlushTimer) return;
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn) => setTimeout(fn, 16);
    termFlushTimer = raf(() => flushTermOutput());
  }

  function resetOutput() {
    pendingTermOutput = '';
    if (termFlushTimer) {
      try {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(termFlushTimer);
      } catch {}
      clearTimeout(termFlushTimer);
      termFlushTimer = 0;
    }
    if (termMode === 'xterm' && term) {
      term.reset();
      scheduleCursorRefresh();
      return;
    }
    if (termMode === 'basic' && basicOut) basicOut.textContent = '';
    updateTermCursorIndicator();
  }

  function getTermCols() {
    return termMode === 'xterm' && term ? term.cols : DEFAULT_TERM_COLS;
  }

  function getTermRows() {
    return termMode === 'xterm' && term ? term.rows : DEFAULT_TERM_ROWS;
  }

  function focusInput() {
    if (termMode === 'xterm' && term) {
      try { term.focus(); } catch {}
      try {
        if (term.textarea && typeof term.textarea.focus === 'function') {
          term.textarea.focus({ preventScroll: true });
        }
      } catch {
        try {
          if (term.textarea && typeof term.textarea.focus === 'function') term.textarea.focus();
        } catch {}
      }
      return;
    }
    const input = document.querySelector('#termHost .basic-in');
    if (input && typeof input.focus === 'function') {
      try { input.focus({ preventScroll: true }); } catch {
        try { input.focus(); } catch {}
      }
    }
  }

  function sendTermInput(raw) {
    if (!termWs || termWs.readyState !== 1) return;
    const bytes = TERM_ENCODER.encode(String(raw || ''));
    if (bytes.length) termWs.send(bytes);
    focusInput();
  }

  function setViewportHeight() {
    const root = document.documentElement;
    if (!root) return;
    let height = window.innerHeight;
    if (window.visualViewport && Number.isFinite(window.visualViewport.height)) {
      height = Math.max(320, Math.floor(window.visualViewport.height));
    }
    root.style.setProperty('--app-height', height + 'px');
  }

  function detectKeyboardOpen() {
    if (!window.visualViewport) return false;
    const layoutHeight = window.innerHeight;
    const visualHeight = window.visualViewport.height;
    if (!layoutHeight || !visualHeight) return false;
    return (layoutHeight - visualHeight) > 110;
  }

  function applyViewportState() {
    setViewportHeight();
    document.body.classList.toggle('keyboard-open', activeView && detectKeyboardOpen());
  }

  function scheduleViewportRefresh() {
    if (viewportRafId) return;
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn) => setTimeout(fn, 16);
    viewportRafId = raf(() => {
      viewportRafId = 0;
      applyViewportState();
      scheduleResizeSync();
    });
  }

  function scheduleResizeSync() {
    if (resizeRafId) return;
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn) => setTimeout(fn, 16);
    resizeRafId = raf(() => {
      resizeRafId = 0;
      sendResize();
    });
  }

  function sendResize() {
    if (termMode === 'xterm' && fitAddon) fitAddon.fit();
    scheduleCursorRefresh();
    if (!termWs || termWs.readyState !== 1) return;
    termWs.send(JSON.stringify({ type: 'resize', cols: getTermCols(), rows: getTermRows() }));
  }

  function clearMobileTermRepeat(clearPressed = true) {
    if (mobileTermRepeatDelayTimer) {
      clearTimeout(mobileTermRepeatDelayTimer);
      mobileTermRepeatDelayTimer = 0;
    }
    if (mobileTermRepeatIntervalTimer) {
      clearInterval(mobileTermRepeatIntervalTimer);
      mobileTermRepeatIntervalTimer = 0;
    }
    if (!clearPressed) return;
    const wrap = $('termMobileKeys');
    if (!wrap) return;
    for (const btn of wrap.querySelectorAll('button.pressed')) btn.classList.remove('pressed');
  }

  function syncMobileModifierPills() {
    const wrap = $('termMobileKeys');
    if (!wrap) return;
    for (const btn of wrap.querySelectorAll('button[data-mod]')) {
      const mod = String(btn.getAttribute('data-mod') || '').toLowerCase();
      const active = (mod === 'ctrl' && mobileTermCtrlLock) || (mod === 'alt' && mobileTermAltLock);
      btn.classList.toggle('mod-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function resetMobileModifiers() {
    if (!mobileTermCtrlLock && !mobileTermAltLock) return;
    mobileTermCtrlLock = false;
    mobileTermAltLock = false;
    syncMobileModifierPills();
  }

  function toCtrlSequence(char) {
    const ch = String(char || '');
    if (ch.length !== 1) return '';
    const upper = ch.toUpperCase();
    const code = upper.charCodeAt(0);
    if (code >= 65 && code <= 90) return String.fromCharCode(code - 64);
    if (ch === ' ') return '\x00';
    if (ch === '[') return '\x1b';
    if (ch === '\\') return '\x1c';
    if (ch === ']') return '\x1d';
    if (ch === '^') return '\x1e';
    if (ch === '_') return '\x1f';
    return '';
  }

  function applyMobileModifiers(payload, actionKey = '') {
    let next = String(payload || '');
    if (!next) return '';
    const ctrlOn = mobileTermCtrlLock;
    const altOn = mobileTermAltLock;
    const key = String(actionKey || '').toLowerCase();

    if (ctrlOn) {
      if (next.length === 1) {
        const ctrlChar = toCtrlSequence(next);
        if (ctrlChar) next = ctrlChar;
      } else if (key === 'left') {
        next = '\x1b[1;5D';
      } else if (key === 'right') {
        next = '\x1b[1;5C';
      } else if (key === 'up') {
        next = '\x1b[1;5A';
      } else if (key === 'down') {
        next = '\x1b[1;5B';
      } else if (key === 'backspace') {
        next = '\x17';
      }
    }

    if (altOn) next = '\x1b' + next;

    if (ctrlOn || altOn) {
      mobileTermCtrlLock = false;
      mobileTermAltLock = false;
      syncMobileModifierPills();
    }
    return next;
  }

  function sendCtrlChar(letter) {
    const upper = String(letter || '').toUpperCase();
    if (!upper || upper.length !== 1) return;
    const code = upper.charCodeAt(0);
    if (code < 65 || code > 90) return;
    sendTermInput(String.fromCharCode(code - 64));
  }

  function sendMobileTermAction(actionKey) {
    const key = String(actionKey || '').toLowerCase();
    const payload = MOBILE_TERM_ACTIONS[key];
    if (!payload) return false;
    sendTermInput(applyMobileModifiers(payload, key));
    return true;
  }

  function sendMobileTermKey(action) {
    const key = String(action || '').toLowerCase();
    if (!key) return;
    if (key === 'keyboard') {
      focusInput();
      return;
    }
    if (key === 'ctrl') {
      mobileTermCtrlLock = !mobileTermCtrlLock;
      syncMobileModifierPills();
      return;
    }
    if (key === 'alt') {
      mobileTermAltLock = !mobileTermAltLock;
      syncMobileModifierPills();
      return;
    }
    if (key === 'ctrlc') {
      sendTermInput(applyMobileModifiers('\x03', key));
      return;
    }
    if (key === 'ctrld') {
      sendTermInput(applyMobileModifiers('\x04', key));
      return;
    }
    if (sendMobileTermAction(key)) return;
    if (key.length === 1) {
      sendTermInput(applyMobileModifiers(key, key));
      return;
    }
    if (key.startsWith('ctrl+') && key.length === 6) {
      sendCtrlChar(key.slice(5));
    }
  }

  function startMobileTermRepeat(target, action) {
    const key = String(action || '').toLowerCase();
    if (!key || !MOBILE_TERM_REPEATABLE_KEYS.has(key)) return;
    clearMobileTermRepeat();
    target.classList.add('pressed');
    target.dataset.skipClick = '1';
    sendMobileTermKey(key);
    mobileTermRepeatDelayTimer = setTimeout(() => {
      mobileTermRepeatDelayTimer = 0;
      mobileTermRepeatIntervalTimer = setInterval(() => {
        sendMobileTermKey(key);
      }, MOBILE_TERM_REPEAT_INTERVAL_MS);
    }, MOBILE_TERM_REPEAT_DELAY_MS);
  }

  function setupBasicTerminal() {
    const host = $('termHost');
    if (!host) return;
    host.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'basic-wrap';

    const out = document.createElement('pre');
    out.className = 'basic-out';

    const input = document.createElement('textarea');
    input.className = 'basic-in';
    input.placeholder = 'basic terminal input: 键入、回车、退格、粘贴';

    input.addEventListener('paste', (ev) => {
      if (!termWs || termWs.readyState !== 1) return;
      const text = (ev.clipboardData && ev.clipboardData.getData('text')) || '';
      if (text) {
        ev.preventDefault();
        sendTermInput(text);
      }
    });

    input.addEventListener('keydown', (ev) => {
      if (!termWs || termWs.readyState !== 1) return;
      if (ev.key === 'Enter') { ev.preventDefault(); sendTermInput('\r'); return; }
      if (ev.key === 'Backspace') { ev.preventDefault(); sendTermInput('\x7f'); return; }
      if (ev.key === 'Tab') { ev.preventDefault(); sendTermInput('\t'); return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); sendTermInput('\x1b[A'); return; }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); sendTermInput('\x1b[B'); return; }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); sendTermInput('\x1b[C'); return; }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); sendTermInput('\x1b[D'); return; }

      if (ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key && ev.key.length === 1) {
        const upper = ev.key.toUpperCase();
        const code = upper.charCodeAt(0);
        if (code >= 65 && code <= 90) {
          ev.preventDefault();
          sendTermInput(String.fromCharCode(code - 64));
          return;
        }
      }

      if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key && ev.key.length === 1) {
        ev.preventDefault();
        sendTermInput(ev.key);
      }
    });

    wrap.appendChild(out);
    wrap.appendChild(input);
    host.appendChild(wrap);
    basicOut = out;
    termMode = 'basic';
    updateTermCursorIndicator();
    syncMobileModifierPills();
    write('[basic terminal mode enabled]\r\n');
  }

  function initTerminal() {
    const host = $('termHost');
    if (!host) return;
    host.innerHTML = '';

    if (typeof window.Terminal === 'undefined' || typeof window.FitAddon === 'undefined' || !window.FitAddon.FitAddon) {
      setupBasicTerminal();
      return;
    }

    const compact = window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
    term = new window.Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline',
      fontFamily: '"IBM Plex Mono", "JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
      fontSize: compact ? 14 : 13,
      allowTransparency: false,
      theme: getXtermTheme(getTheme()),
      scrollback: 5000,
    });
    fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    fitAddon.fit();
    termMode = 'xterm';
    term.onData((data) => sendTermInput(data));
    term.onCursorMove(() => scheduleCursorRefresh());
    host.addEventListener('click', () => {
      try { term.focus(); } catch {}
    });
    host.addEventListener('touchstart', () => {
      try { term.focus(); } catch {}
    }, { passive: true });
    scheduleCursorRefresh();
    syncMobileModifierPills();
  }

  function bindResizeHooks() {
    window.addEventListener('resize', () => scheduleViewportRefresh());
    window.addEventListener('orientationchange', () => scheduleViewportRefresh());
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => scheduleViewportRefresh());
      window.visualViewport.addEventListener('scroll', () => scheduleViewportRefresh());
    }
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => scheduleResizeSync());
      const host = $('termHost');
      if (host) resizeObserver.observe(host);
    }
  }

  function bindMobileKeys() {
    const termMobileKeys = $('termMobileKeys');
    if (!termMobileKeys) return;

    termMobileKeys.addEventListener('click', (ev) => {
      const target = ev.target instanceof Element ? ev.target.closest('button[data-term-key]') : null;
      if (!target) return;
      ev.preventDefault();
      if (target.dataset.skipClick === '1') {
        delete target.dataset.skipClick;
        return;
      }
      sendMobileTermKey(target.getAttribute('data-term-key') || '');
    });

    termMobileKeys.addEventListener('pointerdown', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      const target = ev.target instanceof Element ? ev.target.closest('button[data-term-key]') : null;
      if (!target) return;
      const key = String(target.getAttribute('data-term-key') || '').toLowerCase();
      if (!MOBILE_TERM_REPEATABLE_KEYS.has(key)) return;
      ev.preventDefault();
      startMobileTermRepeat(target, key);
    });

    const stopRepeat = () => clearMobileTermRepeat();
    termMobileKeys.addEventListener('pointerup', stopRepeat);
    termMobileKeys.addEventListener('pointercancel', stopRepeat);
    termMobileKeys.addEventListener('pointerleave', stopRepeat);
    window.addEventListener('pointerup', stopRepeat);
    window.addEventListener('blur', stopRepeat);
  }

  function applyTheme() {
    if (termMode !== 'xterm' || !term) return;
    try {
      term.options.theme = getXtermTheme(getTheme());
      term.refresh(0, Math.max(0, term.rows - 1));
    } catch {}
  }

  function disconnect(showHint = true) {
    clearMobileTermRepeat();
    if (termWs) {
      try { termWs.close(); } catch {}
    }
    termWs = null;
    setTermConnection('disconnected');
    if (showHint) write('\r\n[disconnected]\r\n');
  }

  async function connect(sessionId, options = {}) {
    activeSessionId = sessionId;
    resetOutput();
    const initialOutput = typeof options.initialOutput === 'string' ? options.initialOutput : '';
    if (initialOutput) write(initialOutput);
    setTermConnection('connecting');
    write('[connecting...]\r\n');

    let token = '';
    try {
      const grant = await api('POST', '/api/sessions/' + encodeURIComponent(sessionId) + '/terminal-token', {});
      token = String(grant && grant.token ? grant.token : '');
    } catch (error) {
      setTermConnection('error');
      const message = String((error && error.data && error.data.error) || (error && error.message) || 'unknown');
      write('[terminal token failed: ' + message + ']\r\n');
      if (typeof onError === 'function') onError(message);
      throw error;
    }

    if (!token) {
      const message = 'terminal token missing';
      setTermConnection('error');
      write('[' + message + ']\r\n');
      if (typeof onError === 'function') onError(message);
      return;
    }

    disconnect(false);
    setTermConnection('connecting');
    termWs = new WebSocket(termWsUrl(sessionId), 'token.' + token);
    termWs.binaryType = 'arraybuffer';

    termWs.onopen = () => {
      setTermConnection('connected');
      write('[connected]\r\n');
      scheduleResizeSync();
      focusInput();
    };

    termWs.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const text = TERM_DECODER.decode(new Uint8Array(ev.data), { stream: true });
        if (text) write(text);
        return;
      }
      if (typeof Blob !== 'undefined' && ev.data instanceof Blob) {
        ev.data.arrayBuffer().then((ab) => {
          const text = TERM_DECODER.decode(new Uint8Array(ab), { stream: true });
          if (text) write(text);
        }).catch(() => {});
        return;
      }
      if (typeof ev.data === 'string') write(ev.data);
    };

    termWs.onclose = () => {
      setTermConnection('disconnected');
      write('\r\n[disconnected]\r\n');
    };

    termWs.onerror = () => {
      setTermConnection('error');
      write('\r\n[ws error]\r\n');
      if (typeof onError === 'function') onError('terminal websocket error');
    };
  }

  function setActive(next) {
    activeView = !!next;
    if (!activeView) {
      clearMobileTermRepeat();
      resetMobileModifiers();
      disconnect(false);
      setTermConnection('disconnected');
    } else {
      setTermConnection('connecting');
      syncMobileModifierPills();
      scheduleCursorRefresh();
      scheduleResizeSync();
    }
    applyViewportState();
  }

  function init() {
    applyViewportState();
    setTermConnection('disconnected');
    updateTermCursorIndicator();
    initTerminal();
    bindResizeHooks();
    bindMobileKeys();
  }

  return {
    init,
    write,
    resetOutput,
    setActive,
    setTheme: applyTheme,
    connect,
    reconnect: () => activeSessionId ? connect(activeSessionId) : Promise.resolve(),
    disconnect,
    focusInput,
  };
}
