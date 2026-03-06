import fs from 'node:fs';
import { execFile, spawnSync } from 'node:child_process';

const TMUX_POLL_MS = Math.max(80, Number(process.env.AGENTMESH_TMUX_POLL_MS || 250));
const TMUX_CAPTURE_PADDING = Math.max(20, Number(process.env.AGENTMESH_TMUX_CAPTURE_PADDING || 80));
const TMUX_CAPTURE_MIN_LINES = Math.max(80, Number(process.env.AGENTMESH_TMUX_CAPTURE_MIN_LINES || 160));
const TMUX_SEND_HEX_BATCH = Math.max(1, Number(process.env.AGENTMESH_TMUX_SEND_HEX_BATCH || 48));
const CLEAR_SCREEN = '\u001b[2J\u001b[H';

export type RunnerPty = {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: () => void): void;
};

export type PtySession = {
  sessionId: string;
  cwd: string;
  pty: RunnerPty;
  createdAt: number;
  cols: number;
  rows: number;
};

type CommandResult = {
  code: number;
  out: string;
  err: string;
};

type TmuxRuntime = {
  sessionName: string;
  windowName: string;
  target: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  panePid: number;
  pollTimer: NodeJS.Timeout | null;
  closed: boolean;
  lastCapture: string;
  commandQueue: Promise<void>;
  dataHandlers: Set<(data: string) => void>;
  exitHandlers: Set<() => void>;
};

function commandResultFromSpawn(raw: ReturnType<typeof spawnSync>): CommandResult {
  const code = typeof raw.status === 'number' ? raw.status : raw.error ? 1 : 0;
  const out = typeof raw.stdout === 'string' ? raw.stdout : String(raw.stdout || '');
  const errBase = typeof raw.stderr === 'string' ? raw.stderr : String(raw.stderr || '');
  const err = raw.error ? `${errBase}${errBase ? '\n' : ''}${raw.error.message || raw.error}` : errBase;
  return { code, out, err };
}

function runTmuxSync(args: string[]): CommandResult {
  return commandResultFromSpawn(spawnSync('tmux', args, { encoding: 'utf8' }));
}

function runTmux(args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile('tmux', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const numericCode = typeof (error as any)?.code === 'number' ? (error as any).code : null;
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

function resolveShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  const candidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', 'bash']
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!candidate.includes('/')) return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }

  return '/bin/bash';
}

function ensureTmuxAvailable(): void {
  const probe = runTmuxSync(['-V']);
  if (probe.code !== 0) {
    throw new Error(`tmux is required on runner host: ${probe.err || probe.out || 'not found'}`);
  }
}

function ensureSpawnableCwd(cwd: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    throw new Error(`project path not found: ${cwd}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`project path is not a directory: ${cwd}`);
  }

  try {
    fs.accessSync(cwd, fs.constants.R_OK | fs.constants.X_OK);
  } catch {
    throw new Error(`project path is not accessible: ${cwd}`);
  }
}

function tmuxSessionName(sessionId: string): string {
  const safe = String(sessionId || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 48) || 'session';
  return `agentmesh_${safe}`;
}

function normalizeCapture(raw: string): string {
  return String(raw || '').replace(/\r?\n/g, '\r\n');
}

export function encodeTmuxHexArgs(payload: Buffer): string[] {
  return Array.from(payload.values(), (value) => value.toString(16).padStart(2, '0'));
}

export function renderCapturedPaneDelta(previousCapture: string, nextCapture: string): string {
  const prev = normalizeCapture(previousCapture);
  const next = normalizeCapture(nextCapture);
  if (!next || next === prev) return '';
  if (!prev) return next;
  if (next.startsWith(prev)) return next.slice(prev.length);
  return `${CLEAR_SCREEN}${next}`;
}

function emitData(runtime: TmuxRuntime, data: string): void {
  if (!data) return;
  for (const handler of runtime.dataHandlers) handler(data);
}

function emitExit(runtime: TmuxRuntime): void {
  if (runtime.closed) return;
  runtime.closed = true;
  if (runtime.pollTimer) {
    clearTimeout(runtime.pollTimer);
    runtime.pollTimer = null;
  }
  for (const handler of runtime.exitHandlers) handler();
}

function enqueueTmux(runtime: TmuxRuntime, args: string[]): void {
  if (runtime.closed) return;
  runtime.commandQueue = runtime.commandQueue
    .then(async () => {
      const result = await runTmux(args);
      if (result.code === 0 || runtime.closed) return;
      const combined = `${result.err || ''}\n${result.out || ''}`;
      if (/can't find (session|window|pane)|no server running/i.test(combined)) {
        emitExit(runtime);
        return;
      }
      emitData(runtime, `\r\n[agentmesh] tmux command failed: ${combined.trim() || args.join(' ')}\r\n`);
    })
    .catch((error) => {
      if (runtime.closed) return;
      emitData(runtime, `\r\n[agentmesh] tmux command failed: ${error?.message || error}\r\n`);
    });
}

function schedulePoll(runtime: TmuxRuntime): void {
  if (runtime.closed) return;
  runtime.pollTimer = setTimeout(() => {
    runtime.pollTimer = null;
    void pollCapture(runtime);
  }, TMUX_POLL_MS);
  runtime.pollTimer.unref?.();
}

async function pollCapture(runtime: TmuxRuntime): Promise<void> {
  if (runtime.closed) return;
  const lines = Math.max(TMUX_CAPTURE_MIN_LINES, runtime.rows + TMUX_CAPTURE_PADDING);
  const result = await runTmux(['capture-pane', '-p', '-t', runtime.target, '-S', `-${lines}`]);
  if (runtime.closed) return;

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
  const delta = renderCapturedPaneDelta(runtime.lastCapture, nextCapture);
  runtime.lastCapture = nextCapture;
  emitData(runtime, delta);
  schedulePoll(runtime);
}

function queueBufferInput(runtime: TmuxRuntime, payload: Buffer): void {
  const hex = encodeTmuxHexArgs(payload);
  for (let index = 0; index < hex.length; index += TMUX_SEND_HEX_BATCH) {
    const batch = hex.slice(index, index + TMUX_SEND_HEX_BATCH);
    const args = ['send-keys', '-t', runtime.target];
    for (const part of batch) args.push('-H', part);
    enqueueTmux(runtime, args);
  }
}

function createTmuxPty(sessionId: string, cwd: string, cols: number, rows: number): RunnerPty {
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
  const runtime: TmuxRuntime = {
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
    commandQueue: Promise.resolve(),
    dataHandlers: new Set(),
    exitHandlers: new Set(),
  };

  void pollCapture(runtime);

  return {
    pid: panePid,
    write(data: string) {
      if (!data || runtime.closed) return;
      queueBufferInput(runtime, Buffer.from(data, 'utf8'));
    },
    resize(nextCols: number, nextRows: number) {
      if (runtime.closed) return;
      runtime.cols = nextCols;
      runtime.rows = nextRows;
      enqueueTmux(runtime, ['resize-window', '-t', runtime.target, '-x', String(nextCols), '-y', String(nextRows)]);
    },
    kill() {
      if (runtime.closed) return;
      enqueueTmux(runtime, ['kill-session', '-t', runtime.sessionName]);
      void runtime.commandQueue.finally(() => emitExit(runtime));
    },
    onData(cb: (data: string) => void) {
      runtime.dataHandlers.add(cb);
      if (runtime.lastCapture) cb(`${CLEAR_SCREEN}${runtime.lastCapture}`);
    },
    onExit(cb: () => void) {
      if (runtime.closed) {
        cb();
        return;
      }
      runtime.exitHandlers.add(cb);
    },
  };
}

export function spawnCodexPty(sessionId: string, cwd: string, cols = 120, rows = 34): PtySession {
  ensureSpawnableCwd(cwd);
  const pty = createTmuxPty(sessionId, cwd, cols, rows);
  return { sessionId, cwd, pty, createdAt: Date.now(), cols, rows };
}

export function resizePty(session: PtySession, cols: number, rows: number) {
  session.cols = cols;
  session.rows = rows;
  session.pty.resize(cols, rows);
}

export function killPty(session: PtySession) {
  try {
    session.pty.kill();
  } catch {
    // ignore cleanup errors
  }
}
