import fs from 'node:fs';
import { execFile, spawnSync } from 'node:child_process';
const TMUX_POLL_MS = Math.max(80, Number(process.env.AGENTMESH_TMUX_POLL_MS || 250));
const TMUX_CAPTURE_PADDING = Math.max(20, Number(process.env.AGENTMESH_TMUX_CAPTURE_PADDING || 80));
const TMUX_CAPTURE_MIN_LINES = Math.max(80, Number(process.env.AGENTMESH_TMUX_CAPTURE_MIN_LINES || 160));
const TMUX_SEND_HEX_BATCH = Math.max(1, Number(process.env.AGENTMESH_TMUX_SEND_HEX_BATCH || 48));
const CLEAR_SCREEN = '\u001b[2J\u001b[H';
function commandResultFromSpawn(raw) {
    const code = typeof raw.status === 'number' ? raw.status : raw.error ? 1 : 0;
    const out = typeof raw.stdout === 'string' ? raw.stdout : String(raw.stdout || '');
    const errBase = typeof raw.stderr === 'string' ? raw.stderr : String(raw.stderr || '');
    const err = raw.error ? `${errBase}${errBase ? '\n' : ''}${raw.error.message || raw.error}` : errBase;
    return { code, out, err };
}
function runTmuxSync(args) {
    return commandResultFromSpawn(spawnSync('tmux', args, { encoding: 'utf8' }));
}
function runTmux(args) {
    return new Promise((resolve) => {
        execFile('tmux', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
            const numericCode = typeof error?.code === 'number' ? error.code : null;
            const code = numericCode ?? (error ? 1 : 0);
            const errExtra = error && numericCode === null ? String(error.message || error) : '';
            resolve({
                code,
                out: String(stdout || ''),
                err: `${String(stderr || '')}${errExtra ? `${stderr ? '\n' : ''}${errExtra}` : ''}`,
            });
        });
    });
}
function resolveShell() {
    if (process.platform === 'win32')
        return 'powershell.exe';
    const candidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', 'bash']
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    for (const candidate of candidates) {
        if (!candidate.includes('/'))
            return candidate;
        if (fs.existsSync(candidate))
            return candidate;
    }
    return '/bin/bash';
}
function ensureTmuxAvailable() {
    const probe = runTmuxSync(['-V']);
    if (probe.code !== 0) {
        throw new Error(`tmux is required on runner host: ${probe.err || probe.out || 'not found'}`);
    }
}
function ensureSpawnableCwd(cwd) {
    let stat;
    try {
        stat = fs.statSync(cwd);
    }
    catch {
        throw new Error(`project path not found: ${cwd}`);
    }
    if (!stat.isDirectory()) {
        throw new Error(`project path is not a directory: ${cwd}`);
    }
    try {
        fs.accessSync(cwd, fs.constants.R_OK | fs.constants.X_OK);
    }
    catch {
        throw new Error(`project path is not accessible: ${cwd}`);
    }
}
function tmuxSessionName(sessionId) {
    const safe = String(sessionId || '')
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, '_')
        .slice(0, 48) || 'session';
    return `agentmesh_${safe}`;
}
function normalizeCapture(raw) {
    return String(raw || '').replace(/\r?\n/g, '\r\n');
}
export function encodeTmuxHexArgs(payload) {
    return Array.from(payload.values(), (value) => value.toString(16).padStart(2, '0'));
}
export function renderCapturedPaneDelta(previousCapture, nextCapture) {
    const prev = normalizeCapture(previousCapture);
    const next = normalizeCapture(nextCapture);
    if (!next || next === prev)
        return '';
    if (!prev)
        return next;
    if (next.startsWith(prev))
        return next.slice(prev.length);
    return `${CLEAR_SCREEN}${next}`;
}
function renderCapturedCursor(cursor) {
    if (!cursor)
        return '';
    const row = Math.max(1, Math.floor(cursor.y) + 1);
    const col = Math.max(1, Math.floor(cursor.x) + 1);
    return `${cursor.visible ? '\u001b[?25h' : '\u001b[?25l'}\u001b[${row};${col}H`;
}
function sameCursor(left, right) {
    if (!left && !right)
        return true;
    if (!left || !right)
        return false;
    return left.x === right.x && left.y === right.y && left.visible === right.visible;
}
function emitData(runtime, data) {
    if (!data)
        return;
    for (const handler of runtime.dataHandlers)
        handler(data);
}
function emitExit(runtime) {
    if (runtime.closed)
        return;
    runtime.closed = true;
    if (runtime.pollTimer) {
        clearTimeout(runtime.pollTimer);
        runtime.pollTimer = null;
    }
    for (const handler of runtime.exitHandlers)
        handler();
}
function enqueueTmux(runtime, args) {
    if (runtime.closed)
        return;
    runtime.commandQueue = runtime.commandQueue
        .then(async () => {
        const result = await runTmux(args);
        if (result.code === 0 || runtime.closed)
            return;
        const combined = `${result.err || ''}\n${result.out || ''}`;
        if (/can't find (session|window|pane)|no server running/i.test(combined)) {
            emitExit(runtime);
            return;
        }
        emitData(runtime, `\r\n[agentmesh] tmux command failed: ${combined.trim() || args.join(' ')}\r\n`);
    })
        .catch((error) => {
        if (runtime.closed)
            return;
        emitData(runtime, `\r\n[agentmesh] tmux command failed: ${error?.message || error}\r\n`);
    });
}
function schedulePoll(runtime) {
    if (runtime.closed)
        return;
    runtime.pollTimer = setTimeout(() => {
        runtime.pollTimer = null;
        void pollCapture(runtime);
    }, TMUX_POLL_MS);
    runtime.pollTimer.unref?.();
}
async function pollCapture(runtime) {
    if (runtime.closed)
        return;
    const lines = Math.max(TMUX_CAPTURE_MIN_LINES, runtime.rows + TMUX_CAPTURE_PADDING);
    const result = await runTmux(['capture-pane', '-p', '-t', runtime.target, '-S', `-${lines}`]);
    if (runtime.closed)
        return;
    if (result.code !== 0) {
        const combined = `${result.err || ''}\n${result.out || ''}`;
        if (/can't find (session|window|pane)|no server running/i.test(combined)) {
            emitExit(runtime);
            return;
        }
        emitData(runtime, `\r\n[agentmesh] tmux capture failed: ${combined.trim() || 'unknown error'}\r\n`);
        schedulePoll(runtime);
        return;
    }
    const nextCapture = normalizeCapture(result.out);
    const cursorProbe = await runTmux(['display-message', '-p', '-t', runtime.target, '#{cursor_x} #{cursor_y} #{cursor_flag}']);
    if (runtime.closed)
        return;
    if (cursorProbe.code !== 0) {
        const combined = `${cursorProbe.err || ''}\n${cursorProbe.out || ''}`;
        if (/can't find (session|window|pane)|no server running/i.test(combined)) {
            emitExit(runtime);
            return;
        }
    }
    const cursorParts = String(cursorProbe.out || '').trim().split(/\s+/);
    const nextCursor = cursorParts.length >= 3
        ? {
            x: Number(cursorParts[0]) || 0,
            y: Number(cursorParts[1]) || 0,
            visible: String(cursorParts[2]) === '1',
        }
        : null;
    const delta = renderCapturedPaneDelta(runtime.lastCapture, nextCapture);
    const cursorMoved = !sameCursor(runtime.lastCursor, nextCursor);
    runtime.lastCapture = nextCapture;
    runtime.lastCursor = nextCursor;
    const cursorControl = (delta || cursorMoved) ? renderCapturedCursor(nextCursor) : '';
    emitData(runtime, `${delta}${cursorControl}`);
    schedulePoll(runtime);
}
function queueBufferInput(runtime, payload) {
    const hex = encodeTmuxHexArgs(payload);
    for (let index = 0; index < hex.length; index += TMUX_SEND_HEX_BATCH) {
        const batch = hex.slice(index, index + TMUX_SEND_HEX_BATCH);
        const args = ['send-keys', '-t', runtime.target];
        for (const part of batch)
            args.push('-H', part);
        enqueueTmux(runtime, args);
    }
}
function createTmuxPty(sessionId, cwd, cols, rows) {
    ensureTmuxAvailable();
    const shell = resolveShell();
    const sessionName = tmuxSessionName(sessionId);
    const windowName = 'shell';
    const target = `${sessionName}:${windowName}`;
    runTmuxSync(['kill-session', '-t', sessionName]);
    const create = runTmuxSync([
        'new-session',
        '-d',
        '-s', sessionName,
        '-n', windowName,
        '-c', cwd,
        '-x', String(cols),
        '-y', String(rows),
        shell,
    ]);
    if (create.code !== 0) {
        throw new Error(`tmux start failed: ${create.err || create.out || 'unknown error'}`);
    }
    const paneInfo = runTmuxSync(['display-message', '-p', '-t', target, '#{pane_pid}']);
    const panePid = Number(String(paneInfo.out || '').trim()) || 0;
    const runtime = {
        sessionName,
        windowName,
        target,
        shell,
        cwd,
        cols,
        rows,
        panePid,
        pollTimer: null,
        closed: false,
        lastCapture: '',
        lastCursor: null,
        commandQueue: Promise.resolve(),
        dataHandlers: new Set(),
        exitHandlers: new Set(),
    };
    void pollCapture(runtime);
    return {
        pid: panePid,
        write(data) {
            if (!data || runtime.closed)
                return;
            queueBufferInput(runtime, Buffer.from(data, 'utf8'));
        },
        resize(nextCols, nextRows) {
            if (runtime.closed)
                return;
            runtime.cols = nextCols;
            runtime.rows = nextRows;
            enqueueTmux(runtime, ['resize-window', '-t', runtime.target, '-x', String(nextCols), '-y', String(nextRows)]);
        },
        kill() {
            if (runtime.closed)
                return;
            enqueueTmux(runtime, ['kill-session', '-t', runtime.sessionName]);
            void runtime.commandQueue.finally(() => emitExit(runtime));
        },
        onData(cb) {
            runtime.dataHandlers.add(cb);
            if (runtime.lastCapture)
                cb(`${CLEAR_SCREEN}${runtime.lastCapture}${renderCapturedCursor(runtime.lastCursor)}`);
        },
        onExit(cb) {
            if (runtime.closed) {
                cb();
                return;
            }
            runtime.exitHandlers.add(cb);
        },
    };
}
export function spawnCodexPty(sessionId, cwd, cols = 120, rows = 34) {
    ensureSpawnableCwd(cwd);
    const pty = createTmuxPty(sessionId, cwd, cols, rows);
    return { sessionId, cwd, pty, createdAt: Date.now(), cols, rows };
}
export function resizePty(session, cols, rows) {
    session.cols = cols;
    session.rows = rows;
    session.pty.resize(cols, rows);
}
export function killPty(session) {
    try {
        session.pty.kill();
    }
    catch {
        // ignore cleanup errors
    }
}
