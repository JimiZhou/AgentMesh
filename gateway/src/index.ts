import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';
import { JsonStore, type SessionRecord } from './store.js';
import { loadConfig } from './config.js';
import { updateConfig } from './config-ops.js';
import { registerAdminRoutes } from './admin.js';
import { Buffer } from 'node:buffer';
import type { ServerResponse } from 'node:http';
import { readFileSync, promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const PORT = Number(process.env.AGENTMESH_PORT || 8787);
const HOST = process.env.AGENTMESH_HOST || '127.0.0.1';
const DATA_FILE = process.env.AGENTMESH_DATA_FILE || new URL('../data/state.json', import.meta.url).pathname;
const CONFIG_FILE = process.env.AGENTMESH_CONFIG_FILE || new URL('../data/config.json', import.meta.url).pathname;

function parseEnvBool(raw: string | undefined, fallback: boolean): boolean {
  if (typeof raw !== 'string') return fallback;
  const v = raw.trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

const TRUST_PROXY = parseEnvBool(process.env.AGENTMESH_TRUST_PROXY, false);

// IMPORTANT: resolve dist/ relative to project root so it works for both:
// - src/index.ts (ts-node/esm)
// - dist/index.js (compiled)
const ROOT_DIR = dirname(fileURLToPath(new URL('..', import.meta.url)));
const DIST_DIR = join(ROOT_DIR, 'gateway', 'dist');
const UI_FILE = join(DIST_DIR, 'ui.html');
const ASSETS_DIR = join(DIST_DIR, 'assets');
const ASSET_MIME_TYPE: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

let cfg = loadConfig(CONFIG_FILE);

function reloadConfig() {
  cfg = loadConfig(CONFIG_FILE);
  return cfg;
}

const PASSWORD_HASH_PREFIX = 'scrypt';
const PASSWORD_SCRYPT_N = 16384;
const PASSWORD_SCRYPT_R = 8;
const PASSWORD_SCRYPT_P = 1;
const PASSWORD_KEYLEN = 32;

const scryptAsync = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

function hashPassword(rawPassword: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(rawPassword, salt, PASSWORD_KEYLEN, {
    N: PASSWORD_SCRYPT_N,
    r: PASSWORD_SCRYPT_R,
    p: PASSWORD_SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    PASSWORD_HASH_PREFIX,
    String(PASSWORD_SCRYPT_N),
    String(PASSWORD_SCRYPT_R),
    String(PASSWORD_SCRYPT_P),
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

async function verifyPasswordHash(storedHash: string, rawPassword: string): Promise<boolean> {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 6) return false;
  const [prefix, rawN, rawR, rawP, saltB64, hashB64] = parts;
  if (prefix !== PASSWORD_HASH_PREFIX) return false;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64url');
    expected = Buffer.from(hashB64, 'base64url');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;

  let actual: Buffer;
  try {
    actual = await scryptAsync(rawPassword, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }

  if (actual.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function setAuthConfig(next: { user?: string; password?: string }) {
  updateConfig(CONFIG_FILE, (c) => {
    c.web = c.web || {};
    if (typeof next.user === 'string') c.web.user = next.user;
    if (typeof next.password === 'string') {
      c.web.passwordHash = hashPassword(next.password);
      delete (c.web as any).password;
    }
  });
  reloadConfig();
}

function setTotpConfig(next: { enabled?: boolean; provisioned?: boolean; secretBase32?: string; issuer?: string }) {
  updateConfig(CONFIG_FILE, (c) => {
    c.web = c.web || {};
    c.web.totp = c.web.totp || {};
    if (typeof next.enabled === 'boolean') c.web.totp.enabled = next.enabled;
    if (typeof next.provisioned === 'boolean') c.web.totp.provisioned = next.provisioned;
    if (typeof next.secretBase32 === 'string') c.web.totp.secretBase32 = next.secretBase32;
    if (typeof next.issuer === 'string') c.web.totp.issuer = next.issuer;
  });
  reloadConfig();
}

function cfgWebUser() {
  return cfg.web?.user || 'admin';
}

function cfgWebPasswordHash() {
  return String(cfg.web?.passwordHash || '').trim();
}

function cfgLegacyWebPassword() {
  return String((cfg.web as any)?.password || '');
}

async function verifyWebPassword(rawPassword: string): Promise<boolean> {
  const hash = cfgWebPasswordHash();
  if (hash) return verifyPasswordHash(hash, rawPassword);
  const legacy = cfgLegacyWebPassword();
  if (!legacy) return false;
  return timingSafeEqualString(legacy, rawPassword);
}

let defaultCredentialCache: { user: string; hash: string; value: boolean } | null = null;

async function isDefaultCredentialInUse(): Promise<boolean> {
  const user = cfgWebUser();
  const hash = cfgWebPasswordHash() || cfgLegacyWebPassword();
  if (defaultCredentialCache && defaultCredentialCache.user === user && defaultCredentialCache.hash === hash) {
    return defaultCredentialCache.value;
  }
  const value = user === 'admin' && (await verifyWebPassword('agentmesh'));
  defaultCredentialCache = { user, hash, value };
  return value;
}

function ensurePasswordHashConfigured(): void {
  reloadConfig();
  if (cfgWebPasswordHash()) return;

  const fromEnv = String(process.env.AGENTMESH_BOOTSTRAP_PASSWORD || '');
  const legacy = cfgLegacyWebPassword();
  const bootstrapPassword = fromEnv || legacy;
  if (!bootstrapPassword) {
    throw new Error(
      [
        'missing gateway password hash configuration.',
        'Set AGENTMESH_BOOTSTRAP_PASSWORD for first boot,',
        'or set web.passwordHash in gateway/data/config.json.',
      ].join(' '),
    );
  }

  updateConfig(CONFIG_FILE, (c) => {
    c.web = c.web || {};
    if (!String(c.web.user || '').trim()) c.web.user = 'admin';
    c.web.passwordHash = hashPassword(bootstrapPassword);
    delete (c.web as any).password;
  });
  reloadConfig();
}

function cfgWebSessionTtlMs() {
  return Number(cfg.web?.sessionTtlMs || 12 * 60 * 60 * 1000);
}

function cfgTotpIssuer() {
  return String(cfg.web?.totp?.issuer || 'AgentMesh').trim() || 'AgentMesh';
}

function cfgTotpEnabled() {
  return cfg.web?.totp?.enabled !== false;
}

function cfgTotpProvisioned() {
  return cfg.web?.totp?.provisioned === true;
}

function cfgTotpSecret() {
  return String(cfg.web?.totp?.secretBase32 || '').trim();
}

function cfgAllowedOrigins() {
  return new Set((cfg.web?.allowedOrigins || []).map((x) => String(x).trim()).filter(Boolean));
}

function cfgPublicHttp() {
  return String(cfg.publicUrls?.http || '').trim();
}

function cfgPublicWs() {
  return String(cfg.publicUrls?.ws || '').trim();
}

function cfgEnrollTokenTtlMs() {
  return Number(cfg.enroll?.tokenTtlMs || 10 * 60 * 1000);
}

const AUTH_COOKIE_NAME = 'agentmesh_sid';

const app = Fastify({ logger: true, disableRequestLogging: true, trustProxy: TRUST_PROXY });
await app.register(websocket);

ensurePasswordHashConfigured();

await registerAdminRoutes(app, {
  requireSession: requireWebSession,
  touchSession: touchWebSession,
  setAuthCookie,
  clearAuthCookie,
  checkCsrf: enforceCsrf,
  cfgWebUser,
  verifyWebPassword,
  revokeAllSessions: revokeAllWebSessions,
  cfgTotpEnabled,
  cfgTotpProvisioned,
  cfgTotpSecret,
  cfgTotpIssuer,
  totpVerify: totpVerifyDefault,
  setAuthConfig,
  setTotpConfig,
  reloadConfig,
});

const store = new JsonStore(DATA_FILE);
type UiSseClient = {
  id: string;
  res: ServerResponse;
  heartbeat: NodeJS.Timeout;
  closed: boolean;
};

const uiSseClients = new Map<string, UiSseClient>();
let uiUpdateVersion = 0;
let uiUpdateFlushTimer: NodeJS.Timeout | null = null;

type SessionActivityClient = {
  ws: any;
};

type SessionActivityEvent =
  | {
      id: string;
      type: 'update';
      ts: number;
      update: any;
    }
  | {
      id: string;
      type: 'prompt_result';
      ts: number;
      promptId?: string | null;
      ok: boolean;
      stopReason?: string | null;
      usage?: any;
      userMessageId?: string | null;
      error?: string;
    }
  | {
      id: string;
      type: 'system';
      ts: number;
      level: 'info' | 'error';
      message: string;
    };

type SessionActivityState = {
  events: SessionActivityEvent[];
  terminals: Record<
    string,
    {
      terminalId: string;
      output: string;
      truncated: boolean;
      exitStatus?: any;
      ts: number;
    }
  >;
  pendingPermissions: Record<
    string,
    {
      requestId: string;
      toolCall: any;
      options: any[];
      ts: number;
    }
  >;
  meta: {
    agentInfo?: any;
    authMethods?: any[];
    agentCapabilities?: any;
  };
};

const sessionActivityClients = new Map<string, Set<SessionActivityClient>>();
const sessionActivities = new Map<string, SessionActivityState>();
const SESSION_ACTIVITY_MAX_EVENTS = 400;
const SESSION_TERMINAL_OUTPUT_MAX_CHARS = 64 * 1024;

type WebSession = {
  id: string;
  user: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
};

const webSessions = new Map<string, WebSession>();
const loginAttempts = new Map<string, { count: number; firstTs: number; blockedUntil: number }>();

function revokeAllWebSessions(): void {
  webSessions.clear();
}

type EnrollTokenRecord = {
  token: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
};

const enrollTokens = new Map<string, EnrollTokenRecord>();
const RUNNER_WS_BACKPRESSURE_LIMIT = 512 * 1024;
const LOGIN_WINDOW_MS = Number(process.env.AGENTMESH_LOGIN_WINDOW_MS || 10 * 60 * 1000);
const LOGIN_MAX_ATTEMPTS = Number(process.env.AGENTMESH_LOGIN_MAX_ATTEMPTS || 10);
const LOGIN_BLOCK_MS = Number(process.env.AGENTMESH_LOGIN_BLOCK_MS || 15 * 60 * 1000);
const TOOL_ORDER = ['codex', 'claude', 'gemini'] as const;
type ToolName = (typeof TOOL_ORDER)[number];

// Ephemeral online tracking (WS-connected runners)
const runnerOnline = new Set<string>();
const runnerConns = new Map<string, any>();
const runnerLastMetrics = new Map<string, any>();

type GatewayMetrics = {
  startedAt: number;
  authLogins: number;
  authFailures: number;
  authSessionExpired: number;
  enrollIssued: number;
  enrollConsumed: number;
  enrollRejected: number;
  reconcileRequests: number;
  reconcileResults: number;
  reconcileSessionUpdates: number;
};

const metrics: GatewayMetrics = {
  startedAt: Date.now(),
  authLogins: 0,
  authFailures: 0,
  authSessionExpired: 0,
  enrollIssued: 0,
  enrollConsumed: 0,
  enrollRejected: 0,
  reconcileRequests: 0,
  reconcileResults: 0,
  reconcileSessionUpdates: 0,
};

function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  // Use node's timingSafeEqual to avoid leaking credentials via timing.
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function base32Decode(raw: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = String(raw || '')
    .toUpperCase()
    .replace(/=+$/g, '')
    .replace(/[^A-Z2-7]/g, '');

  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  // big-endian counter
  let c = Math.floor(counter);
  for (let i = 7; i >= 0; i -= 1) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }

  const hmac = crypto.createHmac('sha1', secret).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = 10 ** digits;
  return String(code % mod).padStart(digits, '0');
}

let totpLastUsedCounter = -1;

function totpVerify(base32Secret: string, token: string, window = 1, stepSeconds = 30): boolean {
  const t = String(token || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(t)) return false;
  const secret = base32Decode(base32Secret);
  if (!secret.length) return false;

  const nowCounter = Math.floor(Date.now() / 1000 / stepSeconds);
  for (let w = -window; w <= window; w += 1) {
    const counter = nowCounter + w;
    const expected = hotp(secret, counter, 6);
    if (timingSafeEqualString(expected, t)) {
      if (counter <= totpLastUsedCounter) return false;
      totpLastUsedCounter = counter;
      return true;
    }
  }
  return false;
}

function totpVerifyDefault(secretBase32: string, token: string): boolean {
  return totpVerify(secretBase32, token, 1, 30);
}

function buildTotpOtpAuthUrl(issuerRaw: string, secretBase32: string, account: string): string {
  const issuerClean = String(issuerRaw || 'AgentMesh').trim() || 'AgentMesh';
  const label = encodeURIComponent(`${issuerClean}:${account}`);
  const issuer = encodeURIComponent(issuerClean);
  const secret = encodeURIComponent(secretBase32.replace(/\s+/g, ''));
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

function parseCookieHeader(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  const parts = raw.split(';');
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function extractBearerToken(rawHeader: string | undefined): string {
  const raw = String(rawHeader || '').trim();
  if (!raw) return '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : '';
}

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSecureRequest(req: any): boolean {
  const xfp = TRUST_PROXY
    ? String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase()
    : '';
  if (xfp) return xfp === 'https';
  return String(req.protocol || '').toLowerCase() === 'https';
}

function expectedRequestOrigin(req: any): string {
  const protoRaw = String(
    (TRUST_PROXY ? req.headers['x-forwarded-proto'] : '') || req.protocol || 'http',
  ).split(',')[0].trim();
  const hostRaw = String(
    (TRUST_PROXY ? req.headers['x-forwarded-host'] : '') || req.headers.host || '',
  ).split(',')[0].trim();
  if (!hostRaw) return '';
  return `${protoRaw || 'http'}://${hostRaw}`;
}

function isOriginAllowed(req: any): boolean {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  const allowed = cfgAllowedOrigins();
  if (allowed.size) return allowed.has(origin);
  const expected = expectedRequestOrigin(req);
  if (!expected) return true;
  return origin === expected;
}

function normalizeHttpUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function resolveAssetPath(rawPath: string): string | null {
  const trimmed = rawPath.trim().replace(/^\/+/, '');
  if (!trimmed) return null;
  const normalized = normalize(trimmed).replace(/\\/g, '/');
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return join(ASSETS_DIR, normalized);
}

function resolvePublicGateway(req: any): { gatewayHttp: string; gatewayWs: string } {
  let gatewayHttp = cfgPublicHttp();
  if (!gatewayHttp) {
    gatewayHttp = expectedRequestOrigin(req);
  }
  if (!gatewayHttp) {
    const host = String(req.headers.host || '').trim();
    gatewayHttp = host ? `http://${host}` : 'http://127.0.0.1:8787';
  }
  gatewayHttp = normalizeHttpUrl(gatewayHttp);

  let gatewayWs = cfgPublicWs();
  if (!gatewayWs) {
    gatewayWs = gatewayHttp.replace(/^http/i, 'ws');
  }
  gatewayWs = normalizeHttpUrl(gatewayWs);
  return { gatewayHttp, gatewayWs };
}

function normalizeTtlMs(value: any, fallbackMs: number, minMs: number, maxMs: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallbackMs;
  const ms = Math.floor(n);
  if (ms < minMs) return minMs;
  if (ms > maxMs) return maxMs;
  return ms;
}

function setAuthCookie(req: any, reply: any, sid: string, expiresAt: number) {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(sid)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  reply.header('set-cookie', parts.join('; '));
}

function clearAuthCookie(req: any, reply: any) {
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  reply.header('set-cookie', parts.join('; '));
}

function createWebSession(user: string): WebSession {
  const now = Date.now();
  return {
    id: nanoid(24),
    user,
    csrfToken: nanoid(20),
    createdAt: now,
    expiresAt: now + cfgWebSessionTtlMs(),
  };
}

function getWebSessionFromRequest(req: any): WebSession | null {
  const cookieHeader = String(req.headers.cookie || '');
  const cookies = parseCookieHeader(cookieHeader);
  const sid = cookies[AUTH_COOKIE_NAME];
  if (!sid) return null;
  const session = webSessions.get(sid);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    webSessions.delete(sid);
    metrics.authSessionExpired += 1;
    return null;
  }
  return session;
}

function touchWebSession(session: WebSession): void {
  session.expiresAt = Date.now() + cfgWebSessionTtlMs();
}

function getLoginClientKey(req: any): string {
  const directIp = String(req.socket?.remoteAddress || '').trim();
  if (!TRUST_PROXY && directIp) return directIp;
  const observedIp = String(req.ip || '').trim();
  return observedIp || directIp || 'unknown';
}

function isLoginRateLimited(req: any): boolean {
  const key = getLoginClientKey(req);
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (!attempt) return false;
  if (attempt.blockedUntil > now) return true;
  if (attempt.blockedUntil > 0 || now - attempt.firstTs > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
  }
  return false;
}

function noteLoginFailure(req: any): void {
  const key = getLoginClientKey(req);
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (!attempt || now - attempt.firstTs > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstTs: now, blockedUntil: 0 });
    return;
  }
  const nextCount = attempt.count + 1;
  const blockedUntil = nextCount >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_BLOCK_MS : 0;
  loginAttempts.set(key, { count: nextCount, firstTs: attempt.firstTs, blockedUntil });
}

function clearLoginFailures(req: any): void {
  loginAttempts.delete(getLoginClientKey(req));
}

function requireSessionAccess(session: SessionRecord, user: string): boolean {
  return !session.createdBy || session.createdBy === user;
}

function writeSseEvent(res: ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function closeUiSseClient(clientId: string): void {
  const client = uiSseClients.get(clientId);
  if (!client || client.closed) return;
  client.closed = true;
  clearInterval(client.heartbeat);
  uiSseClients.delete(clientId);
  try {
    client.res.end();
  } catch {
    // ignore close errors
  }
}

function broadcastUiUpdate(nowTs = Date.now()): void {
  const payload = { ts: nowTs, version: uiUpdateVersion };
  for (const [clientId, client] of uiSseClients.entries()) {
    if (client.closed) {
      uiSseClients.delete(clientId);
      continue;
    }
    try {
      writeSseEvent(client.res, 'update', payload);
    } catch {
      closeUiSseClient(clientId);
    }
  }
}

function scheduleUiUpdate(): void {
  uiUpdateVersion += 1;
  if (uiUpdateFlushTimer) return;
  uiUpdateFlushTimer = setTimeout(() => {
    uiUpdateFlushTimer = null;
    broadcastUiUpdate();
  }, 120);
  uiUpdateFlushTimer.unref();
}

function patchStore(mutator: Parameters<JsonStore['patch']>[0]): void {
  store.patch(mutator);
  scheduleUiUpdate();
}

function parseBoolFlag(value: any): boolean {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function normalizeToolName(value: any): string {
  return String(value ?? '').trim().toLowerCase();
}

function getRunnerSupportedTools(runner: any): ToolName[] {
  const rawTools = runner?.capabilities?.tools;
  if (!rawTools || typeof rawTools !== 'object') {
    return ['codex', 'claude'];
  }
  return TOOL_ORDER.filter((tool) => rawTools[tool] === true);
}

function runnerSupportsTool(runner: any, tool: string): tool is ToolName {
  if (!TOOL_ORDER.includes(tool as ToolName)) return false;
  return getRunnerSupportedTools(runner).includes(tool as ToolName);
}

function sanitizeRunner(runner: any) {
  const { token, ...rest } = runner || {};
  return {
    ...rest,
    supportedTools: getRunnerSupportedTools(rest),
    online: !!runnerOnline.has(rest.id),
  };
}

function getSessionActivityState(sessionId: string): SessionActivityState {
  const existing = sessionActivities.get(sessionId);
  if (existing) return existing;
  const created: SessionActivityState = {
    events: [],
    terminals: {},
    pendingPermissions: {},
    meta: {},
  };
  sessionActivities.set(sessionId, created);
  return created;
}

function broadcastSessionActivity(sessionId: string, payload: Record<string, unknown>): void {
  const clients = sessionActivityClients.get(sessionId);
  if (!clients || !clients.size) return;
  const raw = JSON.stringify(payload);
  for (const client of clients) {
    try {
      const sock = client.ws as any;
      if (sock.readyState !== 1) continue;
      if (Number(sock.bufferedAmount || 0) > RUNNER_WS_BACKPRESSURE_LIMIT) {
        client.ws.close(1013, 'backpressure');
        continue;
      }
      client.ws.send(raw);
    } catch {
      // ignore broken clients; close handler will clean up
    }
  }
}

function snapshotSessionActivity(sessionId: string) {
  const state = getSessionActivityState(sessionId);
  return {
    events: state.events,
    terminals: state.terminals,
    pendingPermissions: state.pendingPermissions,
    meta: state.meta,
  };
}

function pushSessionActivityEvent(sessionId: string, event: SessionActivityEvent): void {
  const state = getSessionActivityState(sessionId);
  state.events.push(event);
  if (state.events.length > SESSION_ACTIVITY_MAX_EVENTS) {
    state.events.splice(0, state.events.length - SESSION_ACTIVITY_MAX_EVENTS);
  }
  broadcastSessionActivity(sessionId, { type: 'activity_event', event });
}

function updateSessionActivityMeta(
  sessionId: string,
  patch: { agentInfo?: any; authMethods?: any[]; agentCapabilities?: any },
): void {
  const state = getSessionActivityState(sessionId);
  if (patch.agentInfo !== undefined) state.meta.agentInfo = patch.agentInfo;
  if (patch.authMethods !== undefined) state.meta.authMethods = patch.authMethods;
  if (patch.agentCapabilities !== undefined) state.meta.agentCapabilities = patch.agentCapabilities;
  broadcastSessionActivity(sessionId, { type: 'activity_meta', meta: state.meta });
}

function updateSessionTerminal(
  sessionId: string,
  terminal: {
    terminalId: string;
    output: string;
    truncated: boolean;
    exitStatus?: any;
    ts: number;
  },
): void {
  const state = getSessionActivityState(sessionId);
  if (terminal.output.length > SESSION_TERMINAL_OUTPUT_MAX_CHARS) {
    terminal = {
      ...terminal,
      output: terminal.output.slice(terminal.output.length - SESSION_TERMINAL_OUTPUT_MAX_CHARS),
      truncated: true,
    };
  }
  state.terminals[terminal.terminalId] = terminal;
  broadcastSessionActivity(sessionId, { type: 'terminal_snapshot', terminal });
}

function setPendingPermission(
  sessionId: string,
  permission: {
    requestId: string;
    toolCall: any;
    options: any[];
    ts: number;
  },
): void {
  const state = getSessionActivityState(sessionId);
  state.pendingPermissions[permission.requestId] = permission;
  broadcastSessionActivity(sessionId, { type: 'permission_pending', permission });
}

function clearPendingPermission(sessionId: string, requestId: string): void {
  const state = getSessionActivityState(sessionId);
  if (!state.pendingPermissions[requestId]) return;
  delete state.pendingPermissions[requestId];
  broadcastSessionActivity(sessionId, { type: 'permission_resolved', requestId });
}

function clearSessionArtifacts(sessionId: string): void {
  const activityClients = sessionActivityClients.get(sessionId);
  if (activityClients) {
    for (const client of activityClients) {
      try {
        client.ws.close(1000, 'session deleted');
      } catch {
        // ignore close errors
      }
    }
    sessionActivityClients.delete(sessionId);
  }
  sessionActivities.delete(sessionId);
}

function cleanupRunnerConnection(runnerId: string): void {
  const conn = runnerConns.get(runnerId);
  if (conn) {
    try {
      conn.close(1000, 'runner deleted');
    } catch {
      // ignore close errors
    }
  }
  runnerOnline.delete(runnerId);
  runnerConns.delete(runnerId);
  runnerLastMetrics.delete(runnerId);
  scheduleUiUpdate();
}

function getSession(sessionId: string): SessionRecord | null {
  return store.get().sessions[sessionId] || null;
}

function setSessionStatus(
  sessionId: string,
  patch: Partial<SessionRecord> & { status?: SessionRecord['status'] },
): void {
  patchStore((s) => {
    const session = s.sessions[sessionId];
    if (!session) return;
    Object.assign(session, patch);
  });
}

function sendReconcileRequest(runnerId: string, ws: any): void {
  const knownSessions = Object.values(store.get().sessions)
    .filter((s) => s.runnerId === runnerId)
    .map((s) => ({ sessionId: s.id, status: s.status, tool: s.tool, projectPath: s.projectPath || null }));

  try {
    ws.send(JSON.stringify({ type: 'reconcile_sessions', knownSessions, ts: Date.now() }));
    metrics.reconcileRequests += 1;
  } catch (e: any) {
    app.log.warn({ runnerId, err: e?.message || e }, 'failed to send reconcile_sessions request');
  }
}

function applyReconcileResult(runnerId: string, activeSessionsRaw: any[]): void {
  const activeById = new Map<string, any>();
  for (const raw of activeSessionsRaw || []) {
    const sid = typeof raw?.sessionId === 'string' ? raw.sessionId : '';
    if (!sid) continue;
    activeById.set(sid, raw);
  }

  let updates = 0;
  const now = Date.now();
  patchStore((s) => {
    for (const session of Object.values(s.sessions)) {
      if (session.runnerId !== runnerId) continue;
      const active = activeById.get(session.id);
      if (active) {
        if (session.status !== 'running') {
          session.status = 'running';
          updates += 1;
        }
        if (!session.startedAt) session.startedAt = now;
        if (!session.projectPath && typeof active.cwd === 'string' && active.cwd.trim()) {
          session.projectPath = active.cwd.trim();
        }
        session.lastError = undefined;
        continue;
      }

      if (session.status === 'running' || session.status === 'starting' || session.status === 'stopping') {
        session.status = 'exited';
        session.exitedAt = now;
        session.lastError = 'runner reconnected but session process not found';
        updates += 1;
      }
    }
  });

  metrics.reconcileSessionUpdates += updates;
}

function snapshotGatewayMetrics() {
  const runnerBufferedAmount: Record<string, number> = {};
  for (const [runnerId, ws] of runnerConns.entries()) {
    runnerBufferedAmount[runnerId] = Number((ws as any).bufferedAmount || 0);
  }

  const runnerMetricsObj: Record<string, any> = {};
  for (const [runnerId, value] of runnerLastMetrics.entries()) {
    runnerMetricsObj[runnerId] = value;
  }

  return {
    ...metrics,
    uptimeMs: Date.now() - metrics.startedAt,
    runnerOnlineCount: runnerOnline.size,
    runnerOnlineIds: Array.from(runnerOnline.values()),
    enrollTokenCount: enrollTokens.size,
    webSessionCount: webSessions.size,
    runnerBufferedAmount,
    runnerLastMetrics: runnerMetricsObj,
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of webSessions.entries()) {
    if (session.expiresAt <= now) {
      webSessions.delete(sid);
      metrics.authSessionExpired += 1;
    }
  }
  for (const [token, enroll] of enrollTokens.entries()) {
    if (enroll.expiresAt <= now) enrollTokens.delete(token);
  }
  for (const [key, attempt] of loginAttempts.entries()) {
    const expired = attempt.blockedUntil > 0
      ? attempt.blockedUntil <= now
      : now - attempt.firstTs > LOGIN_WINDOW_MS;
    if (expired) loginAttempts.delete(key);
  }
}, 30_000).unref();

const BASE_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws: wss:",
  "font-src 'self' data:",
].join('; ');

app.addHook('onSend', async (req, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  reply.header('Content-Security-Policy', BASE_CSP);
  if (isSecureRequest(req)) {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return payload;
});

app.addHook('onRequest', async (req, reply) => {
  const path = String(req.url || '').split('?')[0] || '/';
  if (path === '/health' || path === '/' || path === '/ws/runner' || path === '/ws/session') return;
  if (path === '/api/auth/login' || path === '/api/auth/me' || path === '/api/runners/register' || path === '/api/runners/enroll') return;
  if (path === '/setup' || path === '/setup/qr' || path === '/setup/confirm') return;
  if (!path.startsWith('/api/')) return;

  const session = getWebSessionFromRequest(req);
  if (!session) {
    reply.code(401).send({ ok: false, error: 'unauthorized' });
    return reply;
  }

  touchWebSession(session);
  setAuthCookie(req, reply, session.id, session.expiresAt);

  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    const csrf = String(req.headers['x-agentmesh-csrf'] || '');
    if (!csrf || !timingSafeEqualString(csrf, session.csrfToken)) {
      reply.code(403).send({ ok: false, error: 'csrf mismatch' });
      return reply;
    }
  }
});

function requireWebSession(req: any, reply: any): WebSession | null {
  const session = getWebSessionFromRequest(req);
  if (!session) {
    reply.code(401).send({ ok: false, error: 'unauthorized' });
    return null;
  }
  return session;
}

function enforceCsrf(req: any, reply: any, session: WebSession): boolean {
  const method = String(req.method || 'GET').toUpperCase();
  if (!(method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) return true;
  const csrf = String(req.headers['x-agentmesh-csrf'] || '');
  if (!csrf || !timingSafeEqualString(csrf, session.csrfToken)) {
    reply.code(403).send({ ok: false, error: 'csrf mismatch' });
    return false;
  }
  return true;
}

app.get('/health', async () => ({ ok: true, name: 'agentmesh-gateway', ts: Date.now() }));

let uiHtmlCache: string | null = null;

app.get('/', async (_req, reply) => {
  if (uiHtmlCache === null) uiHtmlCache = readFileSync(UI_FILE, 'utf-8');
  reply.type('text/html; charset=utf-8').send(uiHtmlCache);
});

app.get('/manifest.webmanifest', async (_req, reply) => {
  reply.type('application/manifest+json; charset=utf-8').send({
    name: 'AgentMesh',
    short_name: 'AgentMesh',
    description: 'ACP-native mobile console for Codex, Claude, and Gemini sessions.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0f1722',
    theme_color: '#0f1722',
    icons: [
      {
        src: '/assets/ui/icon-app.svg',
        type: 'image/svg+xml',
        sizes: 'any',
        purpose: 'any maskable',
      },
    ],
  });
});

app.get('/sw.js', async (_req, reply) => {
  try {
    const body = await fs.readFile(join(ASSETS_DIR, 'ui', 'sw.js'));
    reply
      .header('Service-Worker-Allowed', '/')
      .type('application/javascript; charset=utf-8')
      .send(body);
    return;
  } catch {
    reply.code(404);
    return { ok: false, error: 'asset not found' };
  }
});

function generateTotpSecretBase32(bytes = 20): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const buf = crypto.randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += alphabet[(value << (5 - bits)) & 31];
  }
  return out;
}

app.get('/setup', async (req, reply) => {
  const session = requireWebSession(req, reply);
  if (!session) return;
  touchWebSession(session);
  setAuthCookie(req, reply, session.id, session.expiresAt);

  const totpEnabled = cfg.web?.totp?.enabled !== false;
  const provisioned = cfg.web?.totp?.provisioned === true;
  if (!totpEnabled) {
    reply.code(404);
    return reply.type('text/plain; charset=utf-8').send('setup disabled');
  }
  if (provisioned) {
    reply.code(404);
    return reply.type('text/plain; charset=utf-8').send('already provisioned');
  }

  const issuer = escapeHtml(cfgTotpIssuer());
  const account = escapeHtml(cfgWebUser());
  const csrfTokenLiteral = JSON.stringify(session.csrfToken);
  const html = `<!doctype html>
  <html lang="zh-CN"><head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>AgentMesh Setup</title>
    <style>
      :root{
        --bg:#0c1117;
        --bg-soft:#151b25;
        --panel:rgba(15,20,30,.92);
        --panel-soft:rgba(255,255,255,.04);
        --border:rgba(255,255,255,.10);
        --text:#eff3f8;
        --muted:#9aa8b7;
        --accent:#ff8958;
        --accent-strong:#ff6b2c;
        --danger:#ff8680;
      }
      *{box-sizing:border-box}
      body{font-family:"Sora","Avenir Next","PingFang SC","Segoe UI",sans-serif;background:radial-gradient(circle at 10% 10%, rgba(255,137,88,.16), transparent 24%),radial-gradient(circle at 85% 14%, rgba(99,102,241,.12), transparent 20%),linear-gradient(180deg, #0a0d12, #0c1117);margin:0;min-height:100vh;color:var(--text)}
      body::before{content:"";position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(180deg, rgba(0,0,0,.85), transparent 82%);pointer-events:none}
      .shell{position:relative;z-index:1;min-height:100vh;display:grid;place-items:center;padding:24px 16px}
      .card{width:min(980px,100%);background:var(--panel);border:1px solid var(--border);border-radius:30px;box-shadow:0 26px 70px rgba(0,0,0,.35);padding:24px;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
      .eyebrow{display:inline-flex;padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--panel-soft);color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
      h1{margin:10px 0 8px 0;font-size:clamp(30px,4vw,48px);line-height:.94;letter-spacing:-.05em}
      p{margin:0;color:var(--muted);line-height:1.65}
      .grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(300px,380px);gap:20px;margin-top:22px}
      .panel{border:1px solid var(--border);border-radius:24px;background:rgba(255,255,255,.03);padding:18px}
      .meta{font-size:12px;color:var(--muted);margin-bottom:10px}
      .hint{margin-top:14px;padding:14px;border-radius:18px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);display:grid;gap:6px}
      .hint strong{font-size:13px}
      img{max-width:320px;width:100%;height:auto;border-radius:20px;border:1px solid var(--border);background:#fff}
      label{display:grid;gap:8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
      input{width:100%;min-height:48px;padding:12px 14px;border-radius:16px;border:1px solid var(--border);background:rgba(255,255,255,.05);color:var(--text);outline:none}
      input:focus{border-color:rgba(255,137,88,.54);box-shadow:0 0 0 4px rgba(255,137,88,.14)}
      .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
      button,.link-btn{padding:12px 16px;border-radius:16px;border:1px solid transparent;background:linear-gradient(135deg,var(--accent),var(--accent-strong));color:#fff8f4;font-weight:700;cursor:pointer;text-decoration:none}
      .link-btn{display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.04);border-color:var(--border);color:var(--text)}
      .err{color:var(--danger);font-size:13px;min-height:18px;margin-top:10px}
      @media (max-width:820px){.card{padding:18px}.grid{grid-template-columns:1fr}}
    </style>
  </head><body>
    <div class="shell">
      <div class="card">
        <span class="eyebrow">Security Setup</span>
        <h1>初始化两步验证</h1>
        <p>用认证器扫码后，输入当前 6 位动态码确认。成功后会锁定初始化入口，后续只能在设置页里重置或删除。</p>
        <div class="grid">
          <div class="panel">
            <div class="meta">issuer: ${issuer} · account: ${account}</div>
            <img src="/setup/qr" alt="TOTP QR" />
            <div class="hint">
              <strong>上线建议</strong>
              <span>完成绑定后再暴露控制台，避免在仅凭密码的状态下对外开放。</span>
            </div>
          </div>
          <div class="panel">
            <label>
              6 位动态码
              <input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" />
            </label>
            <div class="actions">
              <button id="btn">确认并锁定</button>
              <a href="/" class="link-btn">返回控制台</a>
            </div>
            <div class="err" id="err"></div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const $ = (id) => document.getElementById(id);
      const CSRF_TOKEN = ${csrfTokenLiteral};
      $('btn').onclick = async () => {
        $('err').textContent = '';
        const totp = String($('code').value || '').trim();
        try {
          const res = await fetch('/setup/confirm', {
            method:'POST',
            headers:{
              'Content-Type':'application/json',
              'X-AgentMesh-CSRF': CSRF_TOKEN,
            },
            body: JSON.stringify({ totp })
          });
          const text = await res.text();
          let j; try{ j = JSON.parse(text);}catch{ j = {raw:text}; }
          if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
          location.href = '/';
        } catch (e) {
          $('err').textContent = String(e && e.message ? e.message : e);
        }
      };
    </script>
  </body></html>`;

  reply.type('text/html; charset=utf-8').send(html);
});

app.get('/setup/qr', async (req, reply) => {
  const session = requireWebSession(req, reply);
  if (!session) return;
  touchWebSession(session);
  setAuthCookie(req, reply, session.id, session.expiresAt);

  const totpEnabled = cfgTotpEnabled();
  const provisioned = cfgTotpProvisioned();
  if (!totpEnabled || provisioned) {
    reply.code(404);
    return { ok: false, error: 'not available' };
  }

  let secret = cfgTotpSecret();
  if (!secret) {
    secret = generateTotpSecretBase32(20);
    updateConfig(CONFIG_FILE, (c) => {
      c.web = c.web || {};
      c.web.totp = c.web.totp || {};
      c.web.totp.secretBase32 = secret;
      c.web.totp.enabled = c.web.totp.enabled !== false;
      c.web.totp.provisioned = false;
    });
    reloadConfig();
  }

  const otpauthUrl = buildTotpOtpAuthUrl(cfgTotpIssuer(), secret, cfgWebUser());
  const dataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, scale: 6 });
  const base64 = dataUrl.split(',')[1] || '';
  const img = Buffer.from(base64, 'base64');
  reply.type('image/png').send(img);
});

app.post('/setup/confirm', async (req, reply) => {
  const session = requireWebSession(req, reply);
  if (!session) return;
  if (!enforceCsrf(req, reply, session)) return;
  touchWebSession(session);
  setAuthCookie(req, reply, session.id, session.expiresAt);

  const totpEnabled = cfgTotpEnabled();
  const provisioned = cfgTotpProvisioned();
  if (!totpEnabled) {
    reply.code(404);
    return { ok: false, error: 'setup disabled' };
  }
  if (provisioned) {
    reply.code(409);
    return { ok: false, error: 'already provisioned' };
  }

  const secret = cfgTotpSecret();
  if (!secret) {
    reply.code(500);
    return { ok: false, error: 'missing secret; refresh /setup' };
  }

  const body = (req.body || {}) as any;
  const totp = typeof body.totp === 'string' ? body.totp.trim() : '';
  if (!totpVerify(secret, totp, 1, 30)) {
    reply.code(401);
    return { ok: false, error: 'invalid totp' };
  }

  updateConfig(CONFIG_FILE, (c) => {
    c.web = c.web || {};
    c.web.totp = c.web.totp || {};
    c.web.totp.provisioned = true;
  });
  reloadConfig();
  return { ok: true };
});

app.get('/assets/*', async (req, reply) => {
  const wildcard = String((req.params as any)?.['*'] || '');
  const assetPath = resolveAssetPath(wildcard);
  if (!assetPath) {
    reply.code(404);
    return { ok: false, error: 'asset not found' };
  }

  try {
    const body = await fs.readFile(assetPath);
    const ext = extname(assetPath).toLowerCase();
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.type(ASSET_MIME_TYPE[ext] || 'application/octet-stream').send(body);
    return;
  } catch {
    reply.code(404);
    return { ok: false, error: 'asset not found' };
  }
});

app.post('/api/auth/login', async (req, reply) => {
  if (isLoginRateLimited(req)) {
    metrics.authFailures += 1;
    reply.code(429);
    return { ok: false, error: 'too many login attempts, please retry later' };
  }

  const body = (req.body || {}) as any;
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const totp = typeof body.totp === 'string' ? body.totp.trim() : '';

  reloadConfig();

  const userOk = timingSafeEqualString(username, cfgWebUser());
  const passwordOk = await verifyWebPassword(password);
  if (!userOk || !passwordOk) {
    metrics.authFailures += 1;
    noteLoginFailure(req);
    reply.code(401);
    return { ok: false, error: 'invalid credentials' };
  }

  const totpEnabled = cfgTotpEnabled();
  const totpSecret = cfgTotpSecret();
  const totpProvisioned = cfgTotpProvisioned();
  const totpRequired = totpEnabled && totpProvisioned && !!totpSecret;

  if (totpRequired) {
    if (!totp) {
      return { ok: true, authenticated: false, needTotp: true };
    }
    if (!totpVerify(totpSecret, totp, 1, 30)) {
      metrics.authFailures += 1;
      noteLoginFailure(req);
      reply.code(401);
      return { ok: false, error: 'invalid totp' };
    }
  }

  clearLoginFailures(req);
  const session = createWebSession(username);
  webSessions.set(session.id, session);
  setAuthCookie(req, reply, session.id, session.expiresAt);
  metrics.authLogins += 1;

  return {
    ok: true,
    authenticated: true,
    user: session.user,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    security: {
      defaultPassword: await isDefaultCredentialInUse(),
      totpProvisioned: cfgTotpProvisioned(),
      totpEnabled: cfgTotpEnabled(),
    },
  };
});

app.post('/api/auth/logout', async (req, reply) => {
  const session = getWebSessionFromRequest(req);
  if (session) webSessions.delete(session.id);
  clearAuthCookie(req, reply);
  return { ok: true };
});

app.get('/api/auth/me', async (req, reply) => {
  const session = getWebSessionFromRequest(req);
  if (!session) {
    return { ok: true, authenticated: false };
  }

  touchWebSession(session);
  setAuthCookie(req, reply, session.id, session.expiresAt);
  return {
    ok: true,
    authenticated: true,
    user: session.user,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    security: {
      defaultPassword: await isDefaultCredentialInUse(),
      totpProvisioned: cfgTotpProvisioned(),
      totpEnabled: cfgTotpEnabled(),
    },
    totpConfigured: !!cfgTotpSecret(),
    totpEnabled: cfgTotpEnabled(),
    totpProvisioned: cfgTotpProvisioned(),
  };
});

app.get('/api/metrics', async (req, reply) => {
  const session = getWebSessionFromRequest(req);
  if (!session) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }
  touchWebSession(session);
  setAuthCookie(req, reply, session.id, session.expiresAt);
  return { ok: true, metrics: snapshotGatewayMetrics() };
});

app.get('/api/events/stream', async (req, reply) => {
  const session = getWebSessionFromRequest(req);
  if (!session) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }
  touchWebSession(session);
  setAuthCookie(req, reply, session.id, session.expiresAt);

  reply.hijack();
  const res = reply.raw;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const clientId = nanoid(10);
  const heartbeat = setInterval(() => {
    const client = uiSseClients.get(clientId);
    if (!client || client.closed) return;
    try {
      writeSseEvent(client.res, 'heartbeat', { ts: Date.now(), version: uiUpdateVersion });
    } catch {
      closeUiSseClient(clientId);
    }
  }, 30_000);
  heartbeat.unref();

  uiSseClients.set(clientId, {
    id: clientId,
    res,
    heartbeat,
    closed: false,
  });

  try {
    writeSseEvent(res, 'connected', { ts: Date.now(), version: uiUpdateVersion });
  } catch {
    closeUiSseClient(clientId);
    return;
  }

  const cleanup = () => closeUiSseClient(clientId);
  req.raw.on('close', cleanup);
  req.raw.on('aborted', cleanup);
});

app.post('/api/enroll/create', async (req, reply) => {
  const webSession = getWebSessionFromRequest(req);
  if (!webSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const body = (req.body || {}) as any;
  const ttlMs = normalizeTtlMs(body.ttlMs, cfgEnrollTokenTtlMs(), 30 * 1000, 24 * 60 * 60 * 1000);
  const now = Date.now();
  const token = nanoid(36);
  const expiresAt = now + ttlMs;
  const { gatewayHttp, gatewayWs } = resolvePublicGateway(req);

  const enroll: EnrollTokenRecord = {
    token,
    createdBy: webSession.user,
    createdAt: now,
    expiresAt,
  };
  enrollTokens.set(token, enroll);
  metrics.enrollIssued += 1;

  const payload = {
    v: 1,
    token,
    exp: expiresAt,
    gatewayHttp,
    gatewayWs,
  };
  const enrollCode = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

  return {
    ok: true,
    enrollCode,
    expiresAt,
    ttlMs,
    gatewayHttp,
    gatewayWs,
  };
});

app.get('/api/auth/totp/setup', async (req, reply) => {
  const session = getWebSessionFromRequest(req);
  if (!session) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const totpSecret = cfgTotpSecret();
  if (!totpSecret) {
    reply.code(500);
    return { ok: false, error: 'totp not configured' };
  }

  touchWebSession(session);
  setAuthCookie(req, reply, session.id, session.expiresAt);

  const account = session.user || cfgWebUser();
  const issuer = cfgTotpIssuer();
  const otpauthUrl = buildTotpOtpAuthUrl(issuer, totpSecret, account);
  return { ok: true, issuer, account, otpauthUrl };
});

app.post('/api/runners/register', async (_req, reply) => {
  reply.code(404);
  return { ok: false, error: 'disabled; use enroll' };
});

app.post('/api/runners/enroll', async (req, reply) => {
  const body = (req.body || {}) as any;
  const enrollToken = typeof body.token === 'string' ? body.token.trim() : '';
  if (!enrollToken) {
    metrics.enrollRejected += 1;
    reply.code(400);
    return { ok: false, error: 'token is required' };
  }

  const record = enrollTokens.get(enrollToken);
  if (!record) {
    metrics.enrollRejected += 1;
    reply.code(401);
    return { ok: false, error: 'invalid enroll token' };
  }
  if (record.expiresAt <= Date.now()) {
    enrollTokens.delete(enrollToken);
    metrics.enrollRejected += 1;
    reply.code(401);
    return { ok: false, error: 'enroll token expired' };
  }

  enrollTokens.delete(enrollToken);
  metrics.enrollConsumed += 1;

  const id = nanoid(12);
  const runnerToken = nanoid(32);

  patchStore((s) => {
    s.runners[id] = {
      id,
      name: typeof body.name === 'string' ? body.name : undefined,
      createdAt: Date.now(),
      token: runnerToken,
      capabilities: body.capabilities || undefined,
      lastSeenAt: Date.now(),
      enrolledBy: record.createdBy,
      enrolledAt: Date.now(),
    };
  });

  const { gatewayWs } = resolvePublicGateway(req);
  return {
    ok: true,
    runnerId: id,
    runnerToken,
    wsUrl: `/ws/runner?runnerId=${id}`,
    gatewayWs,
  };
});

app.get('/api/runners', async (req) => {
  const s = store.get();
  const query = (req.query || {}) as any;
  const onlineOnly = parseBoolFlag(query.onlineOnly);

  const all = Object.values(s.runners)
    .map((runner) => sanitizeRunner(runner))
    .sort((a, b) => {
      const ao = a.online ? 1 : 0;
      const bo = b.online ? 1 : 0;
      if (ao !== bo) return bo - ao;
      return Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0);
    });

  const runners = onlineOnly ? all.filter((x) => x.online) : all;
  const online = all.filter((x) => x.online).length;
  return {
    ok: true,
    runners,
    summary: {
      total: all.length,
      online,
      offline: Math.max(0, all.length - online),
      returned: runners.length,
    },
  };
});

app.get('/api/runners/:id', async (req, reply) => {
  const webSession = getWebSessionFromRequest(req);
  if (!webSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const runnerId = String((req.params as any).id || '');
  const s = store.get();
  const runner = s.runners[runnerId];
  if (!runner) {
    reply.code(404);
    return { ok: false, error: 'runner not found' };
  }

  const sessions = Object.values(s.sessions)
    .filter((session) => session.runnerId === runnerId && requireSessionAccess(session, webSession.user))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

  const activeSessions = sessions.filter((x) => x.status === 'running' || x.status === 'starting' || x.status === 'stopping').length;

  return {
    ok: true,
    runner: sanitizeRunner(runner),
    sessions,
    summary: {
      totalSessions: sessions.length,
      activeSessions,
    },
    metrics: runnerLastMetrics.get(runnerId) || null,
  };
});

app.post('/api/runners/:id/sessions', async (req, reply) => {
  const webSession = getWebSessionFromRequest(req);
  if (!webSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const runnerId = String((req.params as any).id || '');
  const s = store.get();
  const runner = s.runners[runnerId];
  if (!runner) {
    reply.code(404);
    return { ok: false, error: 'runner not found' };
  }
  if (!runnerOnline.has(runnerId)) {
    reply.code(409);
    return { ok: false, error: 'runner offline' };
  }

  const body = (req.body || {}) as any;
  const supportedTools = getRunnerSupportedTools(runner);
  if (!supportedTools.length) {
    reply.code(409);
    return { ok: false, error: 'runner reports no supported tools' };
  }

  const requestedTool = normalizeToolName(body.tool);
  const tool = requestedTool || supportedTools[0];
  if (!TOOL_ORDER.includes(tool as ToolName)) {
    reply.code(400);
    return { ok: false, error: 'tool must be codex|claude|gemini' };
  }
  if (!runnerSupportsTool(runner, tool)) {
    reply.code(400);
    return {
      ok: false,
      error: `tool ${tool} is not supported by runner ${runnerId}; supported=${supportedTools.join('|')}`,
    };
  }

  const projectPath = typeof body.projectPath === 'string' && body.projectPath.trim() ? body.projectPath.trim() : undefined;
  const projectNameRaw = typeof body.projectName === 'string' && body.projectName.trim() ? body.projectName.trim() : '';
  const projectName = projectNameRaw || `${runner.name || runner.id}-${tool}`;

  const projectId = nanoid(12);
  const sessionId = nanoid(12);

  patchStore((st) => {
    st.projects[projectId] = {
      id: projectId,
      name: projectName,
      createdAt: Date.now(),
      runnerId,
      path: projectPath,
    };
    st.sessions[sessionId] = {
      id: sessionId,
      createdAt: Date.now(),
      runnerId,
      projectId,
      tool,
      projectPath,
      status: 'created',
      createdBy: webSession.user,
    };
  });

  return {
    ok: true,
    runnerId,
    projectId,
    sessionId,
    tool,
    projectPath: projectPath || null,
    status: 'created',
  };
});

app.delete('/api/runners/:id', async (req, reply) => {
  const webSession = getWebSessionFromRequest(req);
  if (!webSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const runnerId = String((req.params as any).id || '');
  const query = (req.query || {}) as any;
  const force = parseBoolFlag(query.force);

  const s = store.get();
  if (!s.runners[runnerId]) {
    reply.code(404);
    return { ok: false, error: 'runner not found' };
  }
  if (runnerOnline.has(runnerId) && !force) {
    reply.code(409);
    return { ok: false, error: 'runner online; use force=1 to delete' };
  }

  const sessionIdsToDelete: string[] = [];
  const projectIdsToDelete: string[] = [];
  for (const session of Object.values(s.sessions)) {
    if (session.runnerId === runnerId) sessionIdsToDelete.push(session.id);
  }
  for (const project of Object.values(s.projects)) {
    if (project.runnerId === runnerId) projectIdsToDelete.push(project.id);
  }

  patchStore((st) => {
    delete st.runners[runnerId];
    for (const sid of sessionIdsToDelete) delete st.sessions[sid];
    for (const pid of projectIdsToDelete) delete st.projects[pid];
  });

  for (const sid of sessionIdsToDelete) clearSessionArtifacts(sid);
  cleanupRunnerConnection(runnerId);

  return {
    ok: true,
    removedRunnerId: runnerId,
    removedSessions: sessionIdsToDelete.length,
    removedProjects: projectIdsToDelete.length,
  };
});

app.post('/api/projects', async (req) => {
  const body = (req.body || {}) as any;
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled';
  const id = nanoid(12);

  patchStore((s) => {
    s.projects[id] = {
      id,
      name,
      createdAt: Date.now(),
      runnerId: typeof body.runnerId === 'string' && body.runnerId.trim() ? body.runnerId.trim() : undefined,
      path: typeof body.path === 'string' && body.path.trim() ? body.path.trim() : undefined,
    };
  });

  return { ok: true, projectId: id };
});

app.get('/api/projects', async () => {
  const s = store.get();
  return { ok: true, projects: Object.values(s.projects) };
});

// Runner control channel
app.get('/ws/runner', { websocket: true }, (conn, req) => {
  const ws = (conn as any).socket || conn;
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const runnerId = url.searchParams.get('runnerId') || '';
  const tokenFromQuery = url.searchParams.get('token') || '';
  const tokenFromAuth = extractBearerToken(String(req.headers.authorization || ''));
  const token = tokenFromAuth || tokenFromQuery;

  const runner = store.get().runners[runnerId];
  if (!runner || !token || !timingSafeEqualString(runner.token, token)) {
    ws.close(1008, 'unauthorized');
    return;
  }

  patchStore((s) => {
    if (s.runners[runnerId]) s.runners[runnerId].lastSeenAt = Date.now();
  });

  const previousConn = runnerConns.get(runnerId);
  if (previousConn && previousConn !== ws) {
    try {
      previousConn.close(1000, 'superseded by new connection');
    } catch {
      // ignore close errors
    }
  }

  runnerOnline.add(runnerId);
  runnerConns.set(runnerId, ws);
  scheduleUiUpdate();
  ws.send(JSON.stringify({ type: 'hello', runnerId, ts: Date.now() }));
  sendReconcileRequest(runnerId, ws);

  let missedPongs = 0;
  ws.on('pong', () => {
    missedPongs = 0;
  });
  const pingTimer = setInterval(() => {
    if (missedPongs >= 2) {
      app.log.warn({ runnerId }, 'runner ws unresponsive; terminating');
      try {
        ws.terminate();
      } catch {
        // ignore terminate errors
      }
      return;
    }
    missedPongs += 1;
    try {
      ws.ping();
    } catch {
      // ignore ping errors
    }
  }, 20_000);
  pingTimer.unref();

  ws.on('close', (code: number, reason: Buffer) => {
    app.log.info({ runnerId, code, reason: reason?.toString() || '' }, 'runner ws closed');
    clearInterval(pingTimer);
    if (runnerConns.get(runnerId) !== ws) return;
    runnerOnline.delete(runnerId);
    runnerConns.delete(runnerId);
    scheduleUiUpdate();
  });

  ws.on('error', (err: any) => {
    app.log.error({ runnerId, err: err?.message || err }, 'runner ws error');
  });

  ws.on('message', (data: any, isBinary: boolean) => {
    if (isBinary) return;
    try {
      const msg = JSON.parse(data.toString());

      let session: SessionRecord | null = null;
      if (msg?.sessionId !== undefined) {
        session = typeof msg.sessionId === 'string' ? getSession(msg.sessionId) : null;
        if (!session || session.runnerId !== runnerId) return;
      }

      if (msg?.type === 'capabilities') {
        patchStore((s) => {
          if (s.runners[runnerId]) {
            s.runners[runnerId].capabilities = msg.capabilities;
            s.runners[runnerId].lastSeenAt = Date.now();
          }
        });
        return;
      }

      if (msg?.type === 'reconcile_sessions_result' && Array.isArray(msg.activeSessions)) {
        applyReconcileResult(runnerId, msg.activeSessions);
        metrics.reconcileResults += 1;
        return;
      }

      if (msg?.type === 'runner_metrics') {
        runnerLastMetrics.set(runnerId, {
          ts: Date.now(),
          counters: msg.counters || {},
          activeSessions: Array.isArray(msg.activeSessions) ? msg.activeSessions : [],
        });
        return;
      }

      if (msg?.type === 'start_session_result' && typeof msg.sessionId === 'string') {
        if (msg.ok) {
          setSessionStatus(msg.sessionId, {
            status: 'running',
            startedAt: Date.now(),
            lastError: undefined,
            exitedAt: undefined,
          });
          updateSessionActivityMeta(msg.sessionId, {
            agentInfo: msg.agentInfo || null,
            authMethods: Array.isArray(msg.authMethods) ? msg.authMethods : [],
            agentCapabilities: msg.agentCapabilities || null,
          });
        } else {
          setSessionStatus(msg.sessionId, {
            status: 'error',
            lastError: typeof msg.error === 'string' ? msg.error : 'start session failed',
          });
          pushSessionActivityEvent(msg.sessionId, {
            id: nanoid(10),
            type: 'system',
            ts: Date.now(),
            level: 'error',
            message: typeof msg.error === 'string' ? msg.error : 'start session failed',
          });
        }
        return;
      }

      if (msg?.type === 'stop_session_result' && typeof msg.sessionId === 'string') {
        if (!msg.ok) {
          setSessionStatus(msg.sessionId, {
            status: 'error',
            lastError: typeof msg.error === 'string' ? msg.error : 'stop session failed',
          });
        }
        return;
      }

      if (msg?.type === 'session_exit' && typeof msg.sessionId === 'string') {
        if (session?.status === 'error') {
          setSessionStatus(msg.sessionId, { exitedAt: Date.now() });
        } else {
          setSessionStatus(msg.sessionId, { status: 'exited', exitedAt: Date.now() });
        }
        const state = sessionActivities.get(msg.sessionId);
        if (state) {
          for (const requestId of Object.keys(state.pendingPermissions)) {
            clearPendingPermission(msg.sessionId, requestId);
          }
          state.terminals = {};
        }
        pushSessionActivityEvent(msg.sessionId, {
          id: nanoid(10),
          type: 'system',
          ts: Date.now(),
          level: 'info',
          message: 'session exited',
        });
        return;
      }

      if (msg?.type === 'acp_update' && typeof msg.sessionId === 'string') {
        pushSessionActivityEvent(msg.sessionId, {
          id: nanoid(10),
          type: 'update',
          ts: Number(msg.ts || Date.now()),
          update: msg.update,
        });
        return;
      }

      if (msg?.type === 'acp_system' && typeof msg.sessionId === 'string' && typeof msg.message === 'string') {
        pushSessionActivityEvent(msg.sessionId, {
          id: nanoid(10),
          type: 'system',
          ts: Number(msg.ts || Date.now()),
          level: msg.level === 'error' ? 'error' : 'info',
          message: msg.message,
        });
        return;
      }

      if (msg?.type === 'prompt_result' && typeof msg.sessionId === 'string') {
        pushSessionActivityEvent(msg.sessionId, {
          id: nanoid(10),
          type: 'prompt_result',
          ts: Number(msg.ts || Date.now()),
          promptId: typeof msg.promptId === 'string' ? msg.promptId : null,
          ok: msg.ok !== false,
          stopReason: typeof msg.stopReason === 'string' ? msg.stopReason : null,
          usage: msg.usage || null,
          userMessageId: typeof msg.userMessageId === 'string' ? msg.userMessageId : null,
          error: typeof msg.error === 'string' ? msg.error : undefined,
        });
        return;
      }

      if (msg?.type === 'acp_terminal' && typeof msg.sessionId === 'string' && typeof msg.terminalId === 'string') {
        updateSessionTerminal(msg.sessionId, {
          terminalId: msg.terminalId,
          output: typeof msg.output === 'string' ? msg.output : '',
          truncated: msg.truncated === true,
          exitStatus: msg.exitStatus || undefined,
          ts: Number(msg.ts || Date.now()),
        });
        return;
      }

      if (
        msg?.type === 'acp_permission_request'
        && typeof msg.sessionId === 'string'
        && typeof msg.requestId === 'string'
      ) {
        setPendingPermission(msg.sessionId, {
          requestId: msg.requestId,
          toolCall: msg.toolCall || null,
          options: Array.isArray(msg.options) ? msg.options : [],
          ts: Number(msg.ts || Date.now()),
        });
        return;
      }
    } catch {
      // ignore parse errors
    }
  });
});

app.get('/ws/session', { websocket: true }, (conn, req) => {
  const ws = (conn as any).socket || conn;

  if (!isOriginAllowed(req)) {
    ws.close(1008, 'origin not allowed');
    return;
  }

  const webSession = getWebSessionFromRequest(req);
  if (!webSession) {
    ws.close(1008, 'unauthorized');
    return;
  }

  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId') || '';
  const session = getSession(sessionId);
  if (!session) {
    ws.close(1008, 'session not found');
    return;
  }
  if (!requireSessionAccess(session, webSession.user)) {
    ws.close(1008, 'forbidden');
    return;
  }

  const client: SessionActivityClient = { ws };
  const set = sessionActivityClients.get(sessionId) || new Set<SessionActivityClient>();
  set.add(client);
  sessionActivityClients.set(sessionId, set);

  try {
    ws.send(JSON.stringify({ type: 'activity_snapshot', snapshot: snapshotSessionActivity(sessionId) }));
  } catch {
    ws.close(1011, 'snapshot failed');
    return;
  }

  ws.on('close', () => {
    const clients = sessionActivityClients.get(sessionId);
    if (!clients) return;
    clients.delete(client);
    if (!clients.size) sessionActivityClients.delete(sessionId);
  });
});

app.post('/api/sessions', async (req, reply) => {
  const authSession = getWebSessionFromRequest(req);
  if (!authSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const body = (req.body || {}) as any;
  const projectId = String(body.projectId || '');
  const requestedRunnerId = typeof body.runnerId === 'string' ? body.runnerId.trim() : '';
  const tool = normalizeToolName(body.tool);

  if (!projectId || !tool) {
    reply.code(400);
    return { ok: false, error: 'projectId and tool are required' };
  }

  if (!TOOL_ORDER.includes(tool as ToolName)) {
    reply.code(400);
    return { ok: false, error: 'tool must be codex|claude|gemini' };
  }

  const s = store.get();
  const project = s.projects[projectId];
  if (!project) {
    reply.code(404);
    return { ok: false, error: 'project not found' };
  }

  const runnerId = requestedRunnerId || project.runnerId || '';
  if (!runnerId) {
    reply.code(400);
    return { ok: false, error: 'runnerId is required (or bind project.runnerId first)' };
  }

  if (!s.runners[runnerId]) {
    reply.code(404);
    return { ok: false, error: 'runner not found' };
  }
  if (!runnerSupportsTool(s.runners[runnerId], tool)) {
    const supported = getRunnerSupportedTools(s.runners[runnerId]);
    reply.code(400);
    return {
      ok: false,
      error: `tool ${tool} is not supported by runner ${runnerId}; supported=${supported.join('|') || 'none'}`,
    };
  }

  const projectPath =
    typeof body.projectPath === 'string' && body.projectPath.trim()
      ? body.projectPath.trim()
      : project.path || undefined;

  const id = nanoid(12);
  patchStore((st) => {
    st.sessions[id] = {
      id,
      createdAt: Date.now(),
      runnerId,
      projectId,
      tool,
      projectPath,
      status: 'created',
      createdBy: authSession.user,
    };
  });

  return {
    ok: true,
    sessionId: id,
    status: 'created',
    runnerId,
    projectPath: projectPath || null,
    createdBy: authSession.user,
  };
});

app.get('/api/sessions/:id', async (req, reply) => {
  const authSession = getWebSessionFromRequest(req);
  if (!authSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const sessionId = (req.params as any).id as string;
  const session = getSession(sessionId);
  if (!session) {
    reply.code(404);
    return { ok: false, error: 'session not found' };
  }
  if (!requireSessionAccess(session, authSession.user)) {
    reply.code(403);
    return { ok: false, error: 'forbidden' };
  }
  return { ok: true, session };
});

app.get('/api/sessions/:id/activity', async (req, reply) => {
  const authSession = getWebSessionFromRequest(req);
  if (!authSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const sessionId = (req.params as any).id as string;
  const session = getSession(sessionId);
  if (!session) {
    reply.code(404);
    return { ok: false, error: 'session not found' };
  }
  if (!requireSessionAccess(session, authSession.user)) {
    reply.code(403);
    return { ok: false, error: 'forbidden' };
  }

  return { ok: true, sessionId, activity: snapshotSessionActivity(sessionId) };
});

app.post('/api/sessions/:id/start', async (req, reply) => {
  const authSession = getWebSessionFromRequest(req);
  if (!authSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const sessionId = (req.params as any).id as string;
  const body = (req.body || {}) as any;
  const s = store.get();
  const session = s.sessions[sessionId];
  if (!session) {
    reply.code(404);
    return { ok: false, error: 'session not found' };
  }
  if (!requireSessionAccess(session, authSession.user)) {
    reply.code(403);
    return { ok: false, error: 'forbidden' };
  }
  const runner = s.runners[session.runnerId];
  if (!runner) {
    reply.code(404);
    return { ok: false, error: 'runner not found' };
  }
  if (!runnerSupportsTool(runner, String(session.tool || '').toLowerCase())) {
    const supported = getRunnerSupportedTools(runner);
    reply.code(409);
    return {
      ok: false,
      error: `runner ${session.runnerId} does not support tool ${session.tool}; supported=${supported.join('|') || 'none'}`,
    };
  }

  if (session.status === 'running' || session.status === 'starting' || session.status === 'stopping') {
    reply.code(409);
    return { ok: false, error: `session already ${session.status}` };
  }

  const conn = runnerConns.get(session.runnerId);
  if (!conn) {
    reply.code(409);
    return { ok: false, error: 'runner offline' };
  }

  const project = s.projects[session.projectId];
  const projectPath =
    typeof body.projectPath === 'string' && body.projectPath.trim()
      ? body.projectPath.trim()
      : session.projectPath || project?.path || null;

  const cmd = {
    type: 'start_session',
    sessionId,
    tool: session.tool,
    projectId: session.projectId,
    projectPath,
    ts: Date.now(),
  };

  app.log.debug({ runnerId: session.runnerId, sessionId, tool: session.tool, projectPath }, 'start_session send');
  try {
    (conn as any).send(JSON.stringify(cmd));
  } catch (e: any) {
    app.log.error({ err: e?.message || e, runnerId: session.runnerId, sessionId }, 'start_session send failed');
    setSessionStatus(sessionId, {
      status: 'error',
      lastError: 'ws send failed',
    });
    reply.code(500);
    return { ok: false, error: 'ws send failed' };
  }

  setSessionStatus(sessionId, {
    status: 'starting',
    lastError: undefined,
    exitedAt: undefined,
    projectPath: projectPath || undefined,
  });

  return { ok: true, sent: true, status: 'starting', projectPath };
});

app.post('/api/sessions/:id/prompt', async (req, reply) => {
  const authSession = getWebSessionFromRequest(req);
  if (!authSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const sessionId = (req.params as any).id as string;
  const session = getSession(sessionId);
  if (!session) {
    reply.code(404);
    return { ok: false, error: 'session not found' };
  }
  if (!requireSessionAccess(session, authSession.user)) {
    reply.code(403);
    return { ok: false, error: 'forbidden' };
  }

  const conn = runnerConns.get(session.runnerId);
  if (!conn) {
    reply.code(409);
    return { ok: false, error: 'runner offline' };
  }

  const body = (req.body || {}) as any;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    reply.code(400);
    return { ok: false, error: 'empty prompt' };
  }

  const promptId = nanoid(12);
  try {
    (conn as any).send(JSON.stringify({ type: 'prompt_session', sessionId, promptId, text, ts: Date.now() }));
  } catch {
    reply.code(500);
    return { ok: false, error: 'ws send failed' };
  }

  return { ok: true, sessionId, promptId };
});

app.post('/api/sessions/:id/cancel', async (req, reply) => {
  const authSession = getWebSessionFromRequest(req);
  if (!authSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const sessionId = (req.params as any).id as string;
  const session = getSession(sessionId);
  if (!session) {
    reply.code(404);
    return { ok: false, error: 'session not found' };
  }
  if (!requireSessionAccess(session, authSession.user)) {
    reply.code(403);
    return { ok: false, error: 'forbidden' };
  }

  if (session.status !== 'running' && session.status !== 'starting') {
    reply.code(409);
    return { ok: false, error: `cannot cancel session in status ${session.status}` };
  }

  const conn = runnerConns.get(session.runnerId);
  if (!conn) {
    reply.code(409);
    return { ok: false, error: 'runner offline' };
  }

  try {
    (conn as any).send(JSON.stringify({ type: 'cancel_session_prompt', sessionId, ts: Date.now() }));
  } catch {
    reply.code(500);
    return { ok: false, error: 'ws send failed' };
  }

  return { ok: true, sessionId };
});

app.post('/api/sessions/:id/permission', async (req, reply) => {
  const authSession = getWebSessionFromRequest(req);
  if (!authSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const sessionId = (req.params as any).id as string;
  const session = getSession(sessionId);
  if (!session) {
    reply.code(404);
    return { ok: false, error: 'session not found' };
  }
  if (!requireSessionAccess(session, authSession.user)) {
    reply.code(403);
    return { ok: false, error: 'forbidden' };
  }

  const state = getSessionActivityState(sessionId);
  const body = (req.body || {}) as any;
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const optionId = typeof body.optionId === 'string' ? body.optionId.trim() : '';
  const cancelled = body.cancelled === true || !optionId;
  if (!requestId || !state.pendingPermissions[requestId]) {
    reply.code(404);
    return { ok: false, error: 'permission request not found' };
  }

  const conn = runnerConns.get(session.runnerId);
  if (!conn) {
    reply.code(409);
    return { ok: false, error: 'runner offline' };
  }

  try {
    (conn as any).send(JSON.stringify({ type: 'permission_response', sessionId, requestId, optionId, cancelled, ts: Date.now() }));
  } catch {
    reply.code(500);
    return { ok: false, error: 'ws send failed' };
  }

  clearPendingPermission(sessionId, requestId);
  return { ok: true, sessionId, requestId };
});

app.post('/api/sessions/:id/stop', async (req, reply) => {
  const authSession = getWebSessionFromRequest(req);
  if (!authSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const sessionId = (req.params as any).id as string;
  const session = getSession(sessionId);
  if (!session) {
    reply.code(404);
    return { ok: false, error: 'session not found' };
  }
  if (!requireSessionAccess(session, authSession.user)) {
    reply.code(403);
    return { ok: false, error: 'forbidden' };
  }

  if (session.status === 'created' || session.status === 'error' || session.status === 'exited' || session.status === 'ended') {
    reply.code(409);
    return { ok: false, error: `cannot stop session in status ${session.status}` };
  }

  if (session.status === 'stopping') {
    reply.code(409);
    return { ok: false, error: 'session already stopping' };
  }

  const conn = runnerConns.get(session.runnerId);
  if (!conn) {
    reply.code(409);
    return { ok: false, error: 'runner offline' };
  }

  try {
    (conn as any).send(JSON.stringify({ type: 'stop_session', sessionId, ts: Date.now() }));
  } catch (e: any) {
    app.log.error({ err: e?.message || e, runnerId: session.runnerId, sessionId }, 'stop_session send failed');
    reply.code(500);
    return { ok: false, error: 'ws send failed' };
  }

  setSessionStatus(sessionId, { status: 'stopping' });
  return { ok: true, sent: true, status: 'stopping' };
});

app.delete('/api/sessions/:id', async (req, reply) => {
  const authSession = getWebSessionFromRequest(req);
  if (!authSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const sessionId = String((req.params as any).id || '');
  const query = (req.query || {}) as any;
  const force = parseBoolFlag(query.force);

  const session = getSession(sessionId);
  if (!session) {
    reply.code(404);
    return { ok: false, error: 'session not found' };
  }
  if (!requireSessionAccess(session, authSession.user)) {
    reply.code(403);
    return { ok: false, error: 'forbidden' };
  }

  const runningLike = session.status === 'running' || session.status === 'starting' || session.status === 'stopping';
  if (runningLike && !force) {
    reply.code(409);
    return { ok: false, error: 'session is active; use force=1 to delete' };
  }

  if (runningLike) {
    const conn = runnerConns.get(session.runnerId);
    if (conn) {
      try {
        (conn as any).send(JSON.stringify({ type: 'stop_session', sessionId, ts: Date.now() }));
      } catch {
        // ignore stop errors when force deleting
      }
    }
  }

  const projectId = session.projectId;
  let removedProjectId: string | null = null;

  patchStore((st) => {
    delete st.sessions[sessionId];
    const projectStillUsed = Object.values(st.sessions).some((x) => x.projectId === projectId);
    if (!projectStillUsed && st.projects[projectId]) {
      delete st.projects[projectId];
      removedProjectId = projectId;
    }
  });

  clearSessionArtifacts(sessionId);
  return {
    ok: true,
    removedSessionId: sessionId,
    removedProjectId,
    forced: runningLike && force,
  };
});

app.get('/api/sessions', async (req, reply) => {
  const authSession = getWebSessionFromRequest(req);
  if (!authSession) {
    reply.code(401);
    return { ok: false, error: 'unauthorized' };
  }

  const s = store.get();
  return {
    ok: true,
    sessions: Object.values(s.sessions).filter((session) => requireSessionAccess(session, authSession.user)),
  };
});

await app.listen({ port: PORT, host: HOST });
