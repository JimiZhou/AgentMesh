import os from 'node:os';
import pty from 'node-pty';

export type PtySession = {
  sessionId: string;
  cwd: string;
  pty: pty.IPty;
  createdAt: number;
  cols: number;
  rows: number;
};

export function spawnCodexPty(sessionId: string, cwd: string, cols = 120, rows = 34): PtySession {
  // Run codex inside a login shell so PATH and env behave like a normal terminal.
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
  const isZsh = shell.includes('zsh');

  // We want an interactive shell. We'll send `codex` after spawn.
  const p = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    } as any,
  });

  // NOTE: do not write commands here; caller should attach onData first,
  // then send initial commands (e.g. start codex) to avoid losing early output.

  return { sessionId, cwd, pty: p, createdAt: Date.now(), cols, rows };
}

export function resizePty(s: PtySession, cols: number, rows: number) {
  s.cols = cols;
  s.rows = rows;
  s.pty.resize(cols, rows);
}

export function killPty(s: PtySession) {
  try { s.pty.kill(); } catch {}
}
