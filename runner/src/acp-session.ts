import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as acp from '@agentclientprotocol/sdk';
import { splitCommand, type ToolCommandSpec, type ToolName } from './tooling.js';

type ExitStatus = {
  exitCode?: number | null;
  signal?: string | null;
};

type PermissionWaiter = {
  resolve: (value: acp.RequestPermissionResponse) => void;
};

type LocalTerminal = {
  id: string;
  child: ChildProcess;
  output: string;
  outputByteLimit: number;
  truncated: boolean;
  exitStatus: ExitStatus | null;
  released: boolean;
  waiters: Array<(status: acp.WaitForTerminalExitResponse) => void>;
  snapshotTimer: NodeJS.Timeout | null;
};

type SessionEmit = (message: Record<string, unknown>) => void;

function trimOutputToLimit(output: string, limit: number): { output: string; truncated: boolean } {
  const safeLimit = Math.max(4096, Number(limit || 0));
  const raw = Buffer.from(String(output || ''), 'utf8');
  if (raw.length <= safeLimit) return { output, truncated: false };
  return {
    output: raw.subarray(raw.length - safeLimit).toString('utf8'),
    truncated: true,
  };
}

function buildEnvMap(
  overrides: Array<{ name: string; value: string }> | undefined | null,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const entry of overrides || []) {
    if (!entry || typeof entry.name !== 'string') continue;
    env[entry.name] = typeof entry.value === 'string' ? entry.value : '';
  }
  return env;
}

async function readAbsoluteTextFile(filePath: string, line?: number | null, limit?: number | null): Promise<string> {
  if (!path.isAbsolute(filePath)) throw new Error(`path must be absolute: ${filePath}`);
  const text = await fs.readFile(filePath, 'utf8');
  if (!line && !limit) return text;
  const lines = text.split(/\r?\n/);
  const start = Math.max(0, (Number(line || 1) || 1) - 1);
  const count = limit == null ? undefined : Math.max(0, Number(limit) || 0);
  return lines.slice(start, count == null ? undefined : start + count).join('\n');
}

function parseSpawnCommand(spec: ToolCommandSpec): { command: string; args: string[] } {
  const tokens = splitCommand(spec.command);
  const [command = '', ...args] = tokens;
  if (!command) throw new Error('empty ACP command');
  return { command, args };
}

export class AcpRunnerSession {
  readonly sessionId: string;
  readonly tool: ToolName;
  readonly cwd: string;
  readonly createdAt: number;

  private readonly emit: SessionEmit;
  private readonly spec: ToolCommandSpec;
  private readonly child: ChildProcessWithoutNullStreams;
  private connection!: acp.ClientSideConnection;
  private readonly permissionWaiters = new Map<string, PermissionWaiter>();
  private readonly terminals = new Map<string, LocalTerminal>();
  private nextPromptQueue: Promise<void> = Promise.resolve();
  private agentSessionId = '';
  private stopped = false;
  private stderrTail = '';
  private exitSent = false;

  private constructor(
    sessionId: string,
    tool: ToolName,
    cwd: string,
    spec: ToolCommandSpec,
    emit: SessionEmit,
    child: ChildProcessWithoutNullStreams,
  ) {
    this.sessionId = sessionId;
    this.tool = tool;
    this.cwd = cwd;
    this.createdAt = Date.now();
    this.emit = emit;
    this.spec = spec;
    this.child = child;
  }

  static async start(options: {
    sessionId: string;
    tool: ToolName;
    cwd: string;
    spec: ToolCommandSpec;
    emit: SessionEmit;
  }): Promise<AcpRunnerSession> {
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

    const input = Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>;
    const output = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>;
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
    } catch (error: any) {
      child.kill();
      const stderr = session.stderrTail.trim();
      const suffix = stderr ? ` · ${stderr}` : '';
      throw new Error(`${error?.message || String(error)}${suffix}`);
    }
  }

  private attachConnection(connection: acp.ClientSideConnection): void {
    this.connection = connection;
  }

  private bindChildLifecycle(): void {
    this.child.stderr.on('data', (chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
      if (!text) return;
      const next = `${this.stderrTail}${text}`;
      this.stderrTail = next.slice(-4000);
    });

    this.child.on('error', (error) => {
      if (this.stopped) return;
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

  private createClientFacade() {
    return {
      sessionUpdate: async (params: acp.SessionNotification) => {
        this.emit({
          type: 'acp_update',
          sessionId: this.sessionId,
          ts: Date.now(),
          update: params.update,
        });
      },
      requestPermission: async (params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> => {
        const requestId = randomUUID();
        this.emit({
          type: 'acp_permission_request',
          sessionId: this.sessionId,
          requestId,
          ts: Date.now(),
          toolCall: params.toolCall,
          options: params.options,
        });
        return await new Promise<acp.RequestPermissionResponse>((resolve) => {
          this.permissionWaiters.set(requestId, { resolve });
        });
      },
      readTextFile: async (params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> => ({
        content: await readAbsoluteTextFile(params.path, params.line, params.limit),
      }),
      writeTextFile: async (params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> => {
        if (!path.isAbsolute(params.path)) throw new Error(`path must be absolute: ${params.path}`);
        await fs.mkdir(path.dirname(params.path), { recursive: true });
        await fs.writeFile(params.path, params.content, 'utf8');
        return {};
      },
      createTerminal: async (params: acp.CreateTerminalRequest): Promise<acp.CreateTerminalResponse> => {
        const terminal = this.createLocalTerminal(params);
        return { terminalId: terminal.id };
      },
      terminalOutput: async (params: acp.TerminalOutputRequest): Promise<acp.TerminalOutputResponse> => {
        const terminal = this.requireTerminal(params.terminalId);
        return {
          output: terminal.output,
          truncated: terminal.truncated,
          exitStatus: terminal.exitStatus || undefined,
        };
      },
      waitForTerminalExit: async (params: acp.WaitForTerminalExitRequest): Promise<acp.WaitForTerminalExitResponse> => {
        const terminal = this.requireTerminal(params.terminalId);
        if (terminal.exitStatus) return terminal.exitStatus;
        return await new Promise<acp.WaitForTerminalExitResponse>((resolve) => {
          terminal.waiters.push(resolve);
        });
      },
      killTerminal: async (params: acp.KillTerminalRequest): Promise<acp.KillTerminalResponse> => {
        const terminal = this.requireTerminal(params.terminalId);
        if (!terminal.exitStatus) terminal.child.kill('SIGTERM');
        return {};
      },
      releaseTerminal: async (params: acp.ReleaseTerminalRequest): Promise<acp.ReleaseTerminalResponse> => {
        this.releaseTerminal(params.terminalId);
        return {};
      },
    };
  }

  private requireTerminal(terminalId: string): LocalTerminal {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) throw new Error(`terminal not found: ${terminalId}`);
    return terminal;
  }

  private createLocalTerminal(params: acp.CreateTerminalRequest): LocalTerminal {
    const terminalId = randomUUID();
    const child = spawn(params.command, params.args || [], {
      cwd: params.cwd || this.cwd,
      env: buildEnvMap(params.env as Array<{ name: string; value: string }> | undefined),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const terminal: LocalTerminal = {
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

    const pushChunk = (chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
      if (!text) return;
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

  private scheduleTerminalSnapshot(terminal: LocalTerminal): void {
    if (terminal.snapshotTimer) return;
    terminal.snapshotTimer = setTimeout(() => {
      terminal.snapshotTimer = null;
      this.emitTerminalSnapshot(terminal);
    }, 150);
    terminal.snapshotTimer.unref?.();
  }

  private flushTerminalSnapshot(terminal: LocalTerminal): void {
    if (terminal.snapshotTimer) {
      clearTimeout(terminal.snapshotTimer);
      terminal.snapshotTimer = null;
    }
    this.emitTerminalSnapshot(terminal);
  }

  private emitTerminalSnapshot(terminal: LocalTerminal): void {
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

  private resolveTerminalWaiters(terminal: LocalTerminal): void {
    if (!terminal.exitStatus) return;
    const payload: acp.WaitForTerminalExitResponse = terminal.exitStatus;
    while (terminal.waiters.length) {
      const waiter = terminal.waiters.shift();
      if (waiter) waiter(payload);
    }
  }

  private releaseTerminal(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.released) return;
    terminal.released = true;
    if (terminal.snapshotTimer) this.flushTerminalSnapshot(terminal);
    if (!terminal.exitStatus) terminal.child.kill('SIGTERM');
    this.terminals.delete(terminalId);
  }

  private emitSystem(level: 'info' | 'error', message: string): void {
    this.emit({
      type: 'acp_system',
      sessionId: this.sessionId,
      level,
      ts: Date.now(),
      message,
    });
  }

  private killChild(): void {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill('SIGTERM');
    setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null) {
        this.child.kill('SIGKILL');
      }
    }, 1200).unref();
  }

  private finishSession(exitStatus: ExitStatus): void {
    if (this.exitSent) return;
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

  async submitPrompt(promptId: string, text: string): Promise<void> {
    this.nextPromptQueue = this.nextPromptQueue
      .then(async () => {
        const nextPrompt = String(text || '').trim();
        if (!nextPrompt) throw new Error('empty prompt');
        if (!this.agentSessionId) throw new Error('ACP session is not ready');
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
      .catch((error: any) => {
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

  resolvePermission(requestId: string, optionId?: string, cancelled = false): boolean {
    const waiter = this.permissionWaiters.get(requestId);
    if (!waiter) return false;
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

  async cancelPrompt(): Promise<void> {
    if (this.stopped) return;
    if (!this.agentSessionId) throw new Error('ACP session is not ready');
    await this.connection.cancel({ sessionId: this.agentSessionId });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
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
      } catch {
        // ignore cancellation failures during shutdown
      }
      try {
        await this.connection.unstable_closeSession?.({ sessionId: this.agentSessionId });
      } catch {
        // ignore optional close failures
      }
    }
    this.killChild();
  }
}
