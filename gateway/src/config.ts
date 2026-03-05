import fs from 'node:fs';
import path from 'node:path';

export type GatewayConfig = {
  web?: {
    user?: string;
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
    password: 'agentmesh',
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

export function loadConfig(filePath: string): GatewayConfig {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return deepMerge(DEFAULT_CONFIG as any, parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(filePath: string, cfg: GatewayConfig): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2));
}
