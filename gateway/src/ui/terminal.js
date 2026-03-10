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
const MOBILE_LAYOUT_QUERY = '(max-width: 820px), (pointer: coarse)';
const DEFAULT_TERM_FONT_SIZE_DESKTOP = 13;
const DEFAULT_TERM_FONT_SIZE_MOBILE = 14;
const MIN_TERM_FONT_SIZE = 11;
const MAX_TERM_FONT_SIZE = 22;

const TERMINAL_PALETTE_MAP = {
  noir: {
    background: '#040609',
    foreground: '#f4f7fa',
    cursor: '#f4f7fa',
    cursorAccent: '#040609',
    selectionBackground: 'rgba(148, 163, 184, 0.35)',
    muted: 'rgba(244, 247, 250, 0.58)',
    black: '#000000', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#bfbfbf',
    brightBlack: '#4d4d4d', brightRed: '#ff6e67', brightGreen: '#5af78e', brightYellow: '#f4f99d', brightBlue: '#caa9fa', brightMagenta: '#ff92d0', brightCyan: '#9aedfe', brightWhite: '#e6e6e6'
  },
  dracula: {
    background: '#191a21',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    cursorAccent: '#191a21',
    selectionBackground: 'rgba(189, 147, 249, 0.26)',
    muted: 'rgba(248, 248, 242, 0.56)',
    black: '#000000', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#bfbfbf',
    brightBlack: '#4d4d4d', brightRed: '#ff6e67', brightGreen: '#5af78e', brightYellow: '#f4f99d', brightBlue: '#caa9fa', brightMagenta: '#ff92d0', brightCyan: '#9aedfe', brightWhite: '#e6e6e6'
  },
  gruvbox: {
    background: '#1d2021',
    foreground: '#ebdbb2',
    cursor: '#ebdbb2',
    cursorAccent: '#1d2021',
    selectionBackground: 'rgba(250, 189, 47, 0.24)',
    muted: 'rgba(235, 219, 178, 0.58)',
    black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
    brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2'
  },
  nord: {
    background: '#2e3440',
    foreground: '#e5e9f0',
    cursor: '#88c0d0',
    cursorAccent: '#2e3440',
    selectionBackground: 'rgba(136, 192, 208, 0.24)',
    muted: 'rgba(229, 233, 240, 0.56)',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4'
  },
  'tokyo-night': {
    background: '#1a1b26',
    foreground: '#c0caf5',
    cursor: '#7aa2f7',
    cursorAccent: '#1a1b26',
    selectionBackground: 'rgba(122, 162, 247, 0.26)',
    muted: 'rgba(192, 202, 245, 0.58)',
    black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5'
  },
  'solarized-dark': {
    background: '#002b36',
    foreground: '#93a1a1',
    cursor: '#93a1a1',
    cursorAccent: '#002b36',
    selectionBackground: 'rgba(38, 139, 210, 0.24)',
    muted: 'rgba(147, 161, 161, 0.58)',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
  },
  'solarized-light': {
    background: '#fdf6e3',
    foreground: '#586e75',
    cursor: '#586e75',
    cursorAccent: '#fdf6e3',
    selectionBackground: 'rgba(38, 139, 210, 0.16)',
    muted: 'rgba(88, 110, 117, 0.58)',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
  },
  paper: {
    background: '#f7f3ea',
    foreground: '#111111',
    cursor: '#111111',
    cursorAccent: '#f7f3ea',
    selectionBackground: 'rgba(17, 17, 17, 0.16)',
    muted: 'rgba(17, 17, 17, 0.56)',
    black: '#000000', red: '#de3d35', green: '#3e953a', yellow: '#d2b67b', blue: '#2f5af3', magenta: '#a00095', cyan: '#3e953a', white: '#bbbbbb',
    brightBlack: '#666666', brightRed: '#ff5c57', brightGreen: '#5af78e', brightYellow: '#f3f99d', brightBlue: '#57c7ff', brightMagenta: '#ff6ac1', brightCyan: '#9aedfe', brightWhite: '#f1f1f1'
  },
  amber: {
    background: '#0a0907',
    foreground: '#f3c776',
    cursor: '#f3c776',
    cursorAccent: '#0a0907',
    selectionBackground: 'rgba(243, 199, 118, 0.26)',
    muted: 'rgba(243, 199, 118, 0.62)',
    black: '#000000', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#bfbfbf',
    brightBlack: '#4d4d4d', brightRed: '#ff6e67', brightGreen: '#5af78e', brightYellow: '#f4f99d', brightBlue: '#caa9fa', brightMagenta: '#ff92d0', brightCyan: '#9aedfe', brightWhite: '#e6e6e6'
  },
};

function getTerminalPalette(palette) {
  return TERMINAL_PALETTE_MAP[String(palette || '').toLowerCase()] || TERMINAL_PALETTE_MAP.noir;
}

function isMobileLayout() {
  return !!(window.matchMedia && window.matchMedia(MOBILE_LAYOUT_QUERY).matches);
}

function termWsUrl(sessionId) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return proto + '//' + location.host + '/ws/terminal?sessionId=' + encodeURIComponent(sessionId);
}

export function createTerminalController({ $, api, getTheme, getPalette, t = (key) => key, translateError = (message) => message, onError, onStatusChange }) {
  let termMode = 'none';
  let term = null;
  let fitAddon = null;
  let basicOut = null;
  let termWs = null;
  let activeSessionId = '';
  let pendingTermOutput = '';
  let termFlushTimer = 0;
  let resizeRafId = 0;
  let viewportRafId = 0;
  let resizeObserver = null;
  let activeView = false;
  let mobileTermCtrlLock = false;
  let mobileTermAltLock = false;
  let mobileTermRepeatDelayTimer = 0;
  let mobileTermRepeatIntervalTimer = 0;
  let connectionState = 'disconnected';
  let connectionLabel = '';
  let termFontSize = isMobileLayout() ? DEFAULT_TERM_FONT_SIZE_MOBILE : DEFAULT_TERM_FONT_SIZE_DESKTOP;
  let termFontAuto = true;
  let pinchStartDistance = 0;
  let pinchStartFontSize = 0;

  function defaultTermFontSize() {
    return isMobileLayout() ? DEFAULT_TERM_FONT_SIZE_MOBILE : DEFAULT_TERM_FONT_SIZE_DESKTOP;
  }

  function clampTermFontSize(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return defaultTermFontSize();
    return Math.max(MIN_TERM_FONT_SIZE, Math.min(MAX_TERM_FONT_SIZE, Math.round(numeric)));
  }

  function touchDistance(touches) {
    if (!touches || touches.length < 2) return 0;
    const dx = Number(touches[0].clientX || 0) - Number(touches[1].clientX || 0);
    const dy = Number(touches[0].clientY || 0) - Number(touches[1].clientY || 0);
    return Math.hypot(dx, dy);
  }

  function currentPalette() {
    if (typeof getPalette === 'function') return String(getPalette() || 'dark').toLowerCase();
    return String((typeof getTheme === 'function' && getTheme()) || 'dark').toLowerCase();
  }

  function tt(key, params) {
    try {
      return t(key, params);
    } catch {
      return key;
    }
  }

  function setTermConnection(status, label = '') {
    const normalized = String(status || 'disconnected');
    connectionState = normalized;
    connectionLabel = label || '';
    if (typeof onStatusChange === 'function') onStatusChange(normalized, label || tt('terminal.status.' + normalized) || normalized);
  }

  function flushTermOutput() {
    termFlushTimer = 0;
    const chunk = pendingTermOutput;
    pendingTermOutput = '';
    if (!chunk) return;
    if (termMode === 'xterm' && term) {
      term.write(chunk);
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
      } catch { }
      clearTimeout(termFlushTimer);
      termFlushTimer = 0;
    }
    if (termMode === 'xterm' && term) {
      term.reset();
      return;
    }
    if (termMode === 'basic' && basicOut) basicOut.textContent = '';
  }

  function getTermCols() {
    return termMode === 'xterm' && term ? term.cols : DEFAULT_TERM_COLS;
  }

  function getTermRows() {
    return termMode === 'xterm' && term ? term.rows : DEFAULT_TERM_ROWS;
  }

  function focusInput() {
    if (termMode === 'xterm' && term) {
      try { term.focus(); } catch { }
      try {
        if (term.textarea && typeof term.textarea.focus === 'function') {
          term.textarea.focus({ preventScroll: true });
        }
      } catch {
        try {
          if (term.textarea && typeof term.textarea.focus === 'function') term.textarea.focus();
        } catch { }
      }
      return;
    }
    const input = document.querySelector('#termHost .basic-in');
    if (input && typeof input.focus === 'function') {
      try { input.focus({ preventScroll: true }); } catch {
        try { input.focus(); } catch { }
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
    if (!termWs || termWs.readyState !== 1) return;
    termWs.send(JSON.stringify({ type: 'resize', cols: getTermCols(), rows: getTermRows() }));
  }

  function applyTerminalSurface() {
    const host = $('termHost');
    if (!host) return;
    const palette = currentPalette();
    const colors = getTerminalPalette(palette);
    host.setAttribute('data-term-palette', palette);
    host.style.setProperty('--term-surface', colors.background);
    host.style.setProperty('--term-foreground', colors.foreground);
    host.style.setProperty('--term-muted', colors.muted);
    host.style.setProperty('--term-font-size', termFontSize + 'px');
  }

  function applyTerminalFontSize() {
    const host = $('termHost');
    if (host) host.style.setProperty('--term-font-size', termFontSize + 'px');
    if (termMode === 'xterm' && term) {
      try {
        term.options.fontSize = termFontSize;
        if (fitAddon) fitAddon.fit();
        term.refresh(0, Math.max(0, term.rows - 1));
      } catch { }
      scheduleResizeSync();
      return;
    }
    if (basicOut) basicOut.scrollTop = basicOut.scrollHeight;
  }

  function setFontSize(nextSize, userTriggered = false) {
    if (userTriggered) termFontAuto = false;
    const next = clampTermFontSize(nextSize);
    if (next === termFontSize) return;
    termFontSize = next;
    applyTerminalFontSize();
  }

  function adjustFontSize(delta) {
    setFontSize(termFontSize + Number(delta || 0), true);
  }

  function resetPinchZoom() {
    pinchStartDistance = 0;
    pinchStartFontSize = 0;
  }

  function bindTerminalHost(host) {
    if (!host || host.dataset.termBound === '1') return;
    host.dataset.termBound = '1';
    host.addEventListener('click', () => focusInput());
    host.addEventListener('touchstart', (ev) => {
      if (ev.touches && ev.touches.length === 2) {
        pinchStartDistance = touchDistance(ev.touches);
        pinchStartFontSize = termFontSize;
        ev.preventDefault();
        return;
      }
      focusInput();
    }, { passive: false });
    host.addEventListener('touchmove', (ev) => {
      if (!ev.touches || ev.touches.length !== 2 || !pinchStartDistance) return;
      const nextDistance = touchDistance(ev.touches);
      if (!nextDistance) return;
      ev.preventDefault();
      setFontSize(pinchStartFontSize * (nextDistance / pinchStartDistance), true);
    }, { passive: false });
    host.addEventListener('touchend', resetPinchZoom);
    host.addEventListener('touchcancel', resetPinchZoom);
    host.addEventListener('wheel', (ev) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      adjustFontSize(ev.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  function syncMobileAssistVisibility() {
    const visible = isMobileLayout();
    const wrap = $('termMobileKeys');
    const hint = $('termHint');
    if (wrap) wrap.classList.toggle('hidden', !visible);
    if (hint) hint.classList.toggle('hidden', !visible);
    if (visible) return;
    clearMobileTermRepeat();
    resetMobileModifiers();
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
    applyTerminalSurface();
    bindTerminalHost(host);

    const wrap = document.createElement('div');
    wrap.className = 'basic-wrap';

    const out = document.createElement('pre');
    out.className = 'basic-out';

    const input = document.createElement('textarea');
    input.className = 'basic-in';
    input.placeholder = tt('terminal.basicInputPlaceholder');

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
    applyTerminalFontSize();
    syncMobileModifierPills();
    write(tt('terminal.basicModeInline') + '\r\n');
  }

  function initTerminal() {
    if (termMode !== 'none') return;
    const host = $('termHost');
    if (!host) return;
    host.innerHTML = '';
    applyTerminalSurface();

    if (typeof window.Terminal === 'undefined' || typeof window.FitAddon === 'undefined' || !window.FitAddon.FitAddon) {
      setupBasicTerminal();
      return;
    }

    term = new window.Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'Menlo, Monaco, "IBM Plex Mono", "SFMono-Regular", "JetBrains Mono", Consolas, monospace',
      fontSize: termFontSize,
      lineHeight: 1.15,
      allowTransparency: false,
      theme: getTerminalPalette(currentPalette()),
      scrollback: 5000,
    });
    fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    termMode = 'xterm';
    applyTerminalFontSize();
    term.onData((data) => sendTermInput(data));
    bindTerminalHost(host);
    syncMobileModifierPills();
  }

  function bindResizeHooks() {
    const onResize = () => {
      if (termFontAuto) {
        const next = clampTermFontSize(defaultTermFontSize());
        if (next !== termFontSize) {
          termFontSize = next;
          applyTerminalFontSize();
        }
      }
      syncMobileAssistVisibility();
      scheduleViewportRefresh();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize);
      window.visualViewport.addEventListener('scroll', onResize);
    }
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => scheduleResizeSync());
      const host = $('termHost');
      if (host) resizeObserver.observe(host);
    }
    if (window.matchMedia) {
      const media = window.matchMedia(MOBILE_LAYOUT_QUERY);
      const onChange = () => syncMobileAssistVisibility();
      if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
      else if (typeof media.addListener === 'function') media.addListener(onChange);
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
    applyTerminalSurface();
    if (termMode !== 'xterm' || !term) return;
    try {
      term.options.theme = getTerminalPalette(currentPalette());
      term.refresh(0, Math.max(0, term.rows - 1));
    } catch { }
  }

  function disconnect(showHint = true) {
    clearMobileTermRepeat();
    if (termWs) {
      try { termWs.close(); } catch { }
    }
    termWs = null;
    setTermConnection('disconnected');
    if (showHint) write('\r\n' + tt('terminal.disconnectedInline') + '\r\n');
  }

  async function connect(sessionId, options = {}) {
    if (termMode === 'none') initTerminal();
    activeSessionId = sessionId;
    resetOutput();
    const initialOutput = typeof options.initialOutput === 'string' ? options.initialOutput : '';
    if (initialOutput) write(initialOutput);
    setTermConnection('connecting');
    write(tt('terminal.connectingInline') + '\r\n');

    let token = '';
    try {
      const grant = await api('POST', '/api/sessions/' + encodeURIComponent(sessionId) + '/terminal-token', {});
      token = String(grant && grant.token ? grant.token : '');
    } catch (error) {
      setTermConnection('error');
      const message = translateError(String((error && error.data && error.data.error) || (error && error.message) || 'unknown'));
      write(tt('terminal.tokenFailedInline', { message }) + '\r\n');
      if (typeof onError === 'function') onError(message);
      throw error;
    }

    if (!token) {
      const message = translateError('terminal token missing');
      setTermConnection('error');
      write(tt('terminal.tokenMissingInline') + '\r\n');
      if (typeof onError === 'function') onError(message);
      return;
    }

    disconnect(false);
    setTermConnection('connecting');
    termWs = new WebSocket(termWsUrl(sessionId), 'token.' + token);
    termWs.binaryType = 'arraybuffer';

    termWs.onopen = () => {
      setTermConnection('connected');
      write(tt('terminal.connectedInline') + '\r\n');
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
        }).catch(() => { });
        return;
      }
      if (typeof ev.data === 'string') write(ev.data);
    };

    termWs.onclose = () => {
      setTermConnection('disconnected');
      write('\r\n' + tt('terminal.disconnectedInline') + '\r\n');
    };

    termWs.onerror = () => {
      setTermConnection('error');
      write('\r\n' + tt('terminal.wsErrorInline') + '\r\n');
      if (typeof onError === 'function') onError(translateError('terminal websocket error'));
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
      if (termMode === 'none') initTerminal();
      setTermConnection('connecting');
      syncMobileModifierPills();
      scheduleResizeSync();
    }
    applyViewportState();
  }

  function init() {
    applyViewportState();
    applyTerminalSurface();
    syncMobileAssistVisibility();
    setTermConnection('disconnected');
    bindResizeHooks();
    bindMobileKeys();
  }

  function refreshCopy() {
    const basicInput = document.querySelector('#termHost .basic-in');
    if (basicInput) basicInput.setAttribute('placeholder', tt('terminal.basicInputPlaceholder'));
    setTermConnection(connectionState, connectionLabel);
  }

  return {
    init,
    write,
    resetOutput,
    setActive,
    setTheme: applyTheme,
    setPalette: applyTheme,
    adjustFontSize,
    connect,
    reconnect: () => activeSessionId ? connect(activeSessionId) : Promise.resolve(),
    disconnect,
    focusInput,
    refreshCopy,
  };
}
