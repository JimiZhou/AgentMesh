import fs from 'node:fs';
import path from 'node:path';

export type RunnerRecord = {
  id: string;
  name?: string;
  createdAt: number;
  token: string;
  lastSeenAt?: number;
  capabilities?: any;
  enrolledBy?: string;
  enrolledAt?: number;
};

export type ProjectRecord = {
  id: string;
  name: string;
  createdAt: number;
  runnerId?: string;
  path?: string;
};

export type SessionRecord = {
  id: string;
  createdAt: number;
  runnerId: string;
  projectId: string;
  tool: string;
  createdBy?: string;
  projectPath?: string;
  status: 'created' | 'starting' | 'running' | 'stopping' | 'ended' | 'exited' | 'error';
  startedAt?: number;
  exitedAt?: number;
  lastError?: string;
};

export type GatewayState = {
  runners: Record<string, RunnerRecord>;
  projects: Record<string, ProjectRecord>;
  sessions: Record<string, SessionRecord>;
};

const DEFAULT_STATE: GatewayState = { runners: {}, projects: {}, sessions: {} };

export class JsonStore {
  private filePath: string;
  private state: GatewayState;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.state = this.load();
  }

  private load(): GatewayState {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf-8');
    } catch (err: any) {
      if (err?.code !== 'ENOENT') this.backupCorruptFile(err);
      return { ...DEFAULT_STATE };
    }
    try {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_STATE, ...parsed };
    } catch (err) {
      this.backupCorruptFile(err);
      return { ...DEFAULT_STATE };
    }
  }

  private backupCorruptFile(err: unknown): void {
    const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
    try {
      fs.copyFileSync(this.filePath, backupPath);
    } catch {
      // best effort backup
    }
    console.error(
      `[agentmesh] FAILED to load state at ${this.filePath}: ${(err as any)?.message || err}. ` +
        `Corrupt file backed up to ${backupPath}; falling back to empty state.`,
    );
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {
      // ignore chmod errors on non-posix filesystems
    }
    fs.renameSync(tmpPath, this.filePath);
  }

  get(): GatewayState {
    return this.state;
  }

  set(next: GatewayState): void {
    this.state = next;
    this.save();
  }

  patch(mutator: (s: GatewayState) => void): GatewayState {
    mutator(this.state);
    this.save();
    return this.state;
  }
}
