import { exec as _exec } from 'node:child_process';
export function shEscape(s) {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}
export async function run(cmd) {
    return await new Promise((resolve) => {
        _exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            const code = error?.code ?? 0;
            resolve({ code, out: stdout?.toString() || '', err: stderr?.toString() || '' });
        });
    });
}
export async function startCodexSession(sessionId, projectPath) {
    const tmuxSession = `agentmesh_${sessionId}`;
    const tmuxWindow = 'shell';
    const cwd = projectPath;
    // Start a detached tmux session with an interactive shell in the project dir.
    // We run codex commands *inside* this shell via send-keys so the session stays usable.
    const cmd = `tmux new-session -d -s ${shEscape(tmuxSession)} -n ${shEscape(tmuxWindow)} -c ${shEscape(cwd)} ${shEscape('bash')}`;
    const r = await run(cmd);
    if (r.code !== 0) {
        throw new Error(`tmux start failed: ${r.err || r.out}`);
    }
    return { sessionId, tool: 'codex', tmuxSession, tmuxWindow, cwd, createdAt: Date.now() };
}
export async function captureSessionText(ls) {
    const target = `${ls.tmuxSession}:${ls.tmuxWindow}`;
    const cmd = `tmux capture-pane -pt ${shEscape(target)} -S -2000`;
    const r = await run(cmd);
    const text = (r.out || r.err || '').trimEnd();
    return text;
}
export async function sendSessionKeys(ls, text, enter = true) {
    const target = `${ls.tmuxSession}:${ls.tmuxWindow}`;
    const parts = [
        `tmux send-keys -t ${shEscape(target)} ${shEscape(text)}`,
        enter ? `tmux send-keys -t ${shEscape(target)} Enter` : '',
    ].filter(Boolean).join(' && ');
    const r = await run(parts);
    if (r.code !== 0) {
        throw new Error(`tmux send-keys failed: ${r.err || r.out}`);
    }
}
