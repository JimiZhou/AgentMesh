import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import * as acp from '@agentclientprotocol/sdk';
import { splitCommand } from './tooling.js';
function trimOutputToLimit(output, limit) {
    const safeLimit = Math.max(4096, Number(limit || 0));
    const raw = Buffer.from(String(output || ''), 'utf8');
    if (raw.length <= safeLimit)
        return { output, truncated: false };
    return {
        output: raw.subarray(raw.length - safeLimit).toString('utf8'),
        truncated: true,
    };
}
function buildEnvMap(overrides) {
    const env = { ...process.env };
    for (const entry of overrides || []) {
        if (!entry || typeof entry.name !== 'string')
            continue;
        env[entry.name] = typeof entry.value === 'string' ? entry.value : '';
    }
    return env;
}
async function readAbsoluteTextFile(filePath, line, limit) {
    if (!path.isAbsolute(filePath))
        throw new Error(`path must be absolute: ${filePath}`);
    const text = await fs.readFile(filePath, 'utf8');
    if (!line && !limit)
        return text;
    const lines = text.split(/\r?\n/);
    const start = Math.max(0, (Number(line || 1) || 1) - 1);
    const count = limit == null ? undefined : Math.max(0, Number(limit) || 0);
    return lines.slice(start, count == null ? undefined : start + count).join('\n');
}
function parseSpawnCommand(spec) {
    const tokens = splitCommand(spec.command);
    const [command = '', ...args] = tokens;
    if (!command)
        throw new Error('empty ACP command');
    return { command, args };
}
export class AcpRunnerSession {
    sessionId;
    tool;
    cwd;
    createdAt;
    emit;
    spec;
    child;
    connection;
    permissionWaiters = new Map();
    terminals = new Map();
    nextPromptQueue = Promise.resolve();
    agentSessionId = '';
    stopped = false;
    stderrTail = '';
    exitSent = false;
    constructor(sessionId, tool, cwd, spec, emit, child) {
        this.sessionId = sessionId;
        this.tool = tool;
        this.cwd = cwd;
        this.createdAt = Date.now();
        this.emit = emit;
        this.spec = spec;
        this.child = child;
    }
    static async start(options) {
        const { sessionId, tool, cwd, spec, emit } = options;
        const { command, args } = parseSpawnCommand(spec);
        const child = spawn(command, args, {
            cwd,
            env: { ...process.env },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        if (!child.stdin || !child.stdout || !child.stderr) {
            throw new Error('failed to create ACP stdio pipes');
        }
        const input = Writable.toWeb(child.stdin);
        const output = Readable.toWeb(child.stdout);
        const stream = acp.ndJsonStream(input, output);
        const session = new AcpRunnerSession(sessionId, tool, cwd, spec, emit, child);
        const connection = new acp.ClientSideConnection(() => session.createClientFacade(), stream);
        session.attachConnection(connection);
        session.bindChildLifecycle();
        try {
            const initialized = await connection.initialize({
                protocolVersion: acp.PROTOCOL_VERSION,
                clientInfo: {
                    name: 'agentmesh-runner',
                    title: 'AgentMesh Runner',
                    version: '0.1.0',
                },
                clientCapabilities: {
                    fs: {
                        readTextFile: true,
                        writeTextFile: true,
                    },
                    terminal: true,
                    auth: {
                        terminal: true,
                    },
                },
            });
            const created = await connection.newSession({
                cwd,
                mcpServers: [],
            });
            session.agentSessionId = created.sessionId;
            emit({
                type: 'start_session_result',
                ok: true,
                sessionId,
                ts: Date.now(),
                agentInfo: initialized.agentInfo || null,
                authMethods: initialized.authMethods || [],
                agentCapabilities: initialized.agentCapabilities || null,
            });
            emit({
                type: 'acp_system',
                sessionId,
                level: 'info',
                ts: Date.now(),
                message: `${tool} attached over ACP`,
            });
            return session;
        }
        catch (error) {
            child.kill();
            const stderr = session.stderrTail.trim();
            const suffix = stderr ? ` · ${stderr}` : '';
            throw new Error(`${error?.message || String(error)}${suffix}`);
        }
    }
    attachConnection(connection) {
        this.connection = connection;
    }
    bindChildLifecycle() {
        this.child.stderr.on('data', (chunk) => {
            const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
            if (!text)
                return;
            const next = `${this.stderrTail}${text}`;
            this.stderrTail = next.slice(-4000);
        });
        this.child.on('error', (error) => {
            if (this.stopped)
                return;
            this.emitSystem('error', `ACP agent process error: ${error.message || String(error)}`);
        });
        this.child.on('exit', (code, signal) => {
            this.finishSession({
                exitCode: typeof code === 'number' ? code : null,
                signal: signal || null,
            });
        });
        this.connection.closed
            .then(() => {
            this.finishSession({
                exitCode: null,
                signal: 'connection_closed',
            });
        })
            .catch(() => {
            this.finishSession({
                exitCode: null,
                signal: 'connection_error',
            });
        });
    }
    createClientFacade() {
        return {
            sessionUpdate: async (params) => {
                this.emit({
                    type: 'acp_update',
                    sessionId: this.sessionId,
                    ts: Date.now(),
                    update: params.update,
                });
            },
            requestPermission: async (params) => {
                const requestId = randomUUID();
                this.emit({
                    type: 'acp_permission_request',
                    sessionId: this.sessionId,
                    requestId,
                    ts: Date.now(),
                    toolCall: params.toolCall,
                    options: params.options,
                });
                return await new Promise((resolve) => {
                    this.permissionWaiters.set(requestId, { resolve });
                });
            },
            readTextFile: async (params) => ({
                content: await readAbsoluteTextFile(params.path, params.line, params.limit),
            }),
            writeTextFile: async (params) => {
                if (!path.isAbsolute(params.path))
                    throw new Error(`path must be absolute: ${params.path}`);
                await fs.mkdir(path.dirname(params.path), { recursive: true });
                await fs.writeFile(params.path, params.content, 'utf8');
                return {};
            },
            createTerminal: async (params) => {
                const terminal = this.createLocalTerminal(params);
                return { terminalId: terminal.id };
            },
            terminalOutput: async (params) => {
                const terminal = this.requireTerminal(params.terminalId);
                return {
                    output: terminal.output,
                    truncated: terminal.truncated,
                    exitStatus: terminal.exitStatus || undefined,
                };
            },
            waitForTerminalExit: async (params) => {
                const terminal = this.requireTerminal(params.terminalId);
                if (terminal.exitStatus)
                    return terminal.exitStatus;
                return await new Promise((resolve) => {
                    terminal.waiters.push(resolve);
                });
            },
            killTerminal: async (params) => {
                const terminal = this.requireTerminal(params.terminalId);
                if (!terminal.exitStatus)
                    terminal.child.kill('SIGTERM');
                return {};
            },
            releaseTerminal: async (params) => {
                this.releaseTerminal(params.terminalId);
                return {};
            },
        };
    }
    requireTerminal(terminalId) {
        const terminal = this.terminals.get(terminalId);
        if (!terminal)
            throw new Error(`terminal not found: ${terminalId}`);
        return terminal;
    }
    createLocalTerminal(params) {
        const terminalId = randomUUID();
        const child = spawn(params.command, params.args || [], {
            cwd: params.cwd || this.cwd,
            env: buildEnvMap(params.env),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const terminal = {
            id: terminalId,
            child,
            output: '',
            outputByteLimit: Math.max(8192, Number(params.outputByteLimit || 32768)),
            truncated: false,
            exitStatus: null,
            released: false,
            waiters: [],
            snapshotTimer: null,
        };
        this.terminals.set(terminalId, terminal);
        const pushChunk = (chunk) => {
            const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
            if (!text)
                return;
            const next = trimOutputToLimit(`${terminal.output}${text}`, terminal.outputByteLimit);
            terminal.output = next.output;
            terminal.truncated = next.truncated;
            this.scheduleTerminalSnapshot(terminal);
        };
        child.stdout.on('data', pushChunk);
        child.stderr.on('data', pushChunk);
        child.on('error', (error) => {
            pushChunk(`[agentmesh] terminal spawn failed: ${error.message || String(error)}\n`);
            terminal.exitStatus = { exitCode: 127, signal: 'spawn_error' };
            this.flushTerminalSnapshot(terminal);
            this.resolveTerminalWaiters(terminal);
        });
        child.on('exit', (code, signal) => {
            terminal.exitStatus = {
                exitCode: typeof code === 'number' ? code : null,
                signal: signal || null,
            };
            this.flushTerminalSnapshot(terminal);
            this.resolveTerminalWaiters(terminal);
        });
        this.emitTerminalSnapshot(terminal);
        return terminal;
    }
    scheduleTerminalSnapshot(terminal) {
        if (terminal.snapshotTimer)
            return;
        terminal.snapshotTimer = setTimeout(() => {
            terminal.snapshotTimer = null;
            this.emitTerminalSnapshot(terminal);
        }, 150);
        terminal.snapshotTimer.unref?.();
    }
    flushTerminalSnapshot(terminal) {
        if (terminal.snapshotTimer) {
            clearTimeout(terminal.snapshotTimer);
            terminal.snapshotTimer = null;
        }
        this.emitTerminalSnapshot(terminal);
    }
    emitTerminalSnapshot(terminal) {
        this.emit({
            type: 'acp_terminal',
            sessionId: this.sessionId,
            terminalId: terminal.id,
            ts: Date.now(),
            output: terminal.output,
            truncated: terminal.truncated,
            exitStatus: terminal.exitStatus,
        });
    }
    resolveTerminalWaiters(terminal) {
        if (!terminal.exitStatus)
            return;
        const payload = terminal.exitStatus;
        while (terminal.waiters.length) {
            const waiter = terminal.waiters.shift();
            if (waiter)
                waiter(payload);
        }
    }
    releaseTerminal(terminalId) {
        const terminal = this.terminals.get(terminalId);
        if (!terminal || terminal.released)
            return;
        terminal.released = true;
        if (terminal.snapshotTimer)
            this.flushTerminalSnapshot(terminal);
        if (!terminal.exitStatus)
            terminal.child.kill('SIGTERM');
        this.terminals.delete(terminalId);
    }
    emitSystem(level, message) {
        this.emit({
            type: 'acp_system',
            sessionId: this.sessionId,
            level,
            ts: Date.now(),
            message,
        });
    }
    killChild() {
        if (this.child.exitCode !== null || this.child.signalCode !== null)
            return;
        this.child.kill('SIGTERM');
        setTimeout(() => {
            if (this.child.exitCode === null && this.child.signalCode === null) {
                this.child.kill('SIGKILL');
            }
        }, 1200).unref();
    }
    finishSession(exitStatus) {
        if (this.exitSent)
            return;
        this.exitSent = true;
        this.stopped = true;
        this.killChild();
        for (const [requestId, waiter] of this.permissionWaiters.entries()) {
            this.permissionWaiters.delete(requestId);
            waiter.resolve({ outcome: { outcome: 'cancelled' } });
        }
        for (const terminalId of this.terminals.keys()) {
            this.releaseTerminal(terminalId);
        }
        this.emit({
            type: 'session_exit',
            sessionId: this.sessionId,
            ts: Date.now(),
            exitStatus,
        });
    }
    async submitPrompt(promptId, text) {
        this.nextPromptQueue = this.nextPromptQueue
            .then(async () => {
            const nextPrompt = String(text || '').trim();
            if (!nextPrompt)
                throw new Error('empty prompt');
            if (!this.agentSessionId)
                throw new Error('ACP session is not ready');
            const result = await this.connection.prompt({
                sessionId: this.agentSessionId,
                prompt: [{ type: 'text', text: nextPrompt }],
            });
            this.emit({
                type: 'prompt_result',
                sessionId: this.sessionId,
                promptId,
                ts: Date.now(),
                ok: true,
                stopReason: result.stopReason,
                usage: result.usage || null,
                userMessageId: result.userMessageId || null,
            });
        })
            .catch((error) => {
            this.emit({
                type: 'prompt_result',
                sessionId: this.sessionId,
                promptId,
                ts: Date.now(),
                ok: false,
                error: error?.message || String(error),
            });
        });
        await this.nextPromptQueue;
    }
    resolvePermission(requestId, optionId, cancelled = false) {
        const waiter = this.permissionWaiters.get(requestId);
        if (!waiter)
            return false;
        this.permissionWaiters.delete(requestId);
        if (cancelled || !optionId) {
            waiter.resolve({ outcome: { outcome: 'cancelled' } });
            return true;
        }
        waiter.resolve({
            outcome: {
                outcome: 'selected',
                optionId,
            },
        });
        return true;
    }
    async cancelPrompt() {
        if (this.stopped)
            return;
        if (!this.agentSessionId)
            throw new Error('ACP session is not ready');
        await this.connection.cancel({ sessionId: this.agentSessionId });
    }
    async stop() {
        if (this.stopped)
            return;
        this.stopped = true;
        for (const [requestId, waiter] of this.permissionWaiters.entries()) {
            this.permissionWaiters.delete(requestId);
            waiter.resolve({ outcome: { outcome: 'cancelled' } });
        }
        for (const terminalId of this.terminals.keys()) {
            this.releaseTerminal(terminalId);
        }
        if (this.agentSessionId) {
            try {
                await this.connection.cancel({ sessionId: this.agentSessionId });
            }
            catch {
                // ignore cancellation failures during shutdown
            }
            try {
                await this.connection.unstable_closeSession?.({ sessionId: this.agentSessionId });
            }
            catch {
                // ignore optional close failures
            }
        }
        this.killChild();
    }
}
