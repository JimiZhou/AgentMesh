import fs from 'node:fs';
import path from 'node:path';

export type RunnerRecord = {
  id: string;
  name?: string;
  createdAt: number;
  token: string;
  lastSeenAt?: number;
  capabilities?: any;
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
  status: 'created' | 'running' | 'ended' | 'error';
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
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_STATE, ...parsed };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
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
