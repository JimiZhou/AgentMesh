import fs from 'node:fs';
import path from 'node:path';

export type GatewayConfig = {
  web?: {
    user?: string;
    passwordHash?: string;
    // Legacy plaintext password field. Kept for migration only.
    password?: string;
    sessionTtlMs?: number;
    totp?: {
      issuer?: string;
      secretBase32?: string;
      enabled?: boolean;
      provisioned?: boolean;
    };
    allowedOrigins?: string[];
  };
  enroll?: {
    tokenTtlMs?: number;
  };
  publicUrls?: {
    http?: string;
    ws?: string;
  };
};

export const DEFAULT_CONFIG: Required<GatewayConfig> = {
  web: {
    user: 'admin',
    passwordHash: '',
    password: '',
    sessionTtlMs: 12 * 60 * 60 * 1000,
    totp: {
      issuer: 'AgentMesh',
      secretBase32: '',
      enabled: true,
      provisioned: false,
    },
    allowedOrigins: [],
  },
  enroll: {
    tokenTtlMs: 10 * 60 * 1000,
  },
  publicUrls: {
    http: '',
    ws: '',
  },
};

function deepMerge<T extends Record<string, any>>(base: T, patch: any): T {
  const out: any = Array.isArray(base) ? [...base] : { ...base };
  if (!patch || typeof patch !== 'object') return out;
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof (base as any)[k] === 'object' && !Array.isArray((base as any)[k])) {
      out[k] = deepMerge((base as any)[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function backupCorruptFile(filePath: string, err: unknown): void {
  const backupPath = `${filePath}.corrupt-${Date.now()}`;
  try {
    fs.copyFileSync(filePath, backupPath);
  } catch {
    // best effort backup
  }
  console.error(
    `[agentmesh] FAILED to load config at ${filePath}: ${(err as any)?.message || err}. ` +
      `Corrupt file backed up to ${backupPath}; falling back to defaults.`,
  );
}

export function loadConfig(filePath: string): GatewayConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err: any) {
    if (err?.code !== 'ENOENT') backupCorruptFile(filePath, err);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const parsed = JSON.parse(raw);
    return deepMerge(DEFAULT_CONFIG as any, parsed);
  } catch (err) {
    backupCorruptFile(filePath, err);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(filePath: string, cfg: GatewayConfig): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(tmpPath, 0o600);
  } catch {
    // ignore chmod errors on non-posix filesystems
  }
  fs.renameSync(tmpPath, filePath);
}
