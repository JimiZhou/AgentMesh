import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';
import { JsonStore } from './store.js';
import { loadConfig } from './config.js';
import { updateConfig } from './config-ops.js';
import { registerAdminRoutes } from './admin.js';
import { Buffer } from 'node:buffer';
import { readFileSync, promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const PORT = Number(process.env.AGENTMESH_PORT || 8787);
const HOST = process.env.AGENTMESH_HOST || '127.0.0.1';
const DATA_FILE = process.env.AGENTMESH_DATA_FILE || new URL('../data/state.json', import.meta.url).pathname;
const CONFIG_FILE = process.env.AGENTMESH_CONFIG_FILE || new URL('../data/config.json', import.meta.url).pathname;
function parseEnvBool(raw, fallback) {
    if (typeof raw !== 'string')
        return fallback;
    const v = raw.trim().toLowerCase();
    if (!v)
        return fallback;
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
const ASSET_MIME_TYPE = {
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
function hashPassword(rawPassword) {
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
function verifyPasswordHash(storedHash, rawPassword) {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 6)
        return false;
    const [prefix, rawN, rawR, rawP, saltB64, hashB64] = parts;
    if (prefix !== PASSWORD_HASH_PREFIX)
        return false;
    const N = Number(rawN);
    const r = Number(rawR);
    const p = Number(rawP);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p))
        return false;
    let salt;
    let expected;
    try {
        salt = Buffer.from(saltB64, 'base64url');
        expected = Buffer.from(hashB64, 'base64url');
    }
    catch {
        return false;
    }
    if (!salt.length || !expected.length)
        return false;
    let actual;
    try {
        actual = crypto.scryptSync(rawPassword, salt, expected.length, {
            N,
            r,
            p,
            maxmem: 64 * 1024 * 1024,
        });
    }
    catch {
        return false;
    }
    if (actual.length !== expected.length)
        return false;
    try {
        return crypto.timingSafeEqual(actual, expected);
    }
    catch {
        return false;
    }
}
function setAuthConfig(next) {
    updateConfig(CONFIG_FILE, (c) => {
        c.web = c.web || {};
        if (typeof next.user === 'string')
            c.web.user = next.user;
        if (typeof next.password === 'string') {
            c.web.passwordHash = hashPassword(next.password);
            delete c.web.password;
        }
    });
    reloadConfig();
}
function setTotpConfig(next) {
    updateConfig(CONFIG_FILE, (c) => {
        c.web = c.web || {};
        c.web.totp = c.web.totp || {};
        if (typeof next.enabled === 'boolean')
            c.web.totp.enabled = next.enabled;
        if (typeof next.provisioned === 'boolean')
            c.web.totp.provisioned = next.provisioned;
        if (typeof next.secretBase32 === 'string')
            c.web.totp.secretBase32 = next.secretBase32;
        if (typeof next.issuer === 'string')
            c.web.totp.issuer = next.issuer;
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
    return String(cfg.web?.password || '');
}
function verifyWebPassword(rawPassword) {
    const hash = cfgWebPasswordHash();
    if (hash)
        return verifyPasswordHash(hash, rawPassword);
    const legacy = cfgLegacyWebPassword();
    if (!legacy)
        return false;
    return timingSafeEqualString(legacy, rawPassword);
}
function isDefaultCredentialInUse() {
    return cfgWebUser() === 'admin' && verifyWebPassword('agentmesh');
}
function ensurePasswordHashConfigured() {
    reloadConfig();
    if (cfgWebPasswordHash())
        return;
    const fromEnv = String(process.env.AGENTMESH_BOOTSTRAP_PASSWORD || '');
    const legacy = cfgLegacyWebPassword();
    const bootstrapPassword = fromEnv || legacy;
    if (!bootstrapPassword) {
        throw new Error([
            'missing gateway password hash configuration.',
            'Set AGENTMESH_BOOTSTRAP_PASSWORD for first boot,',
            'or set web.passwordHash in gateway/data/config.json.',
        ].join(' '));
    }
    updateConfig(CONFIG_FILE, (c) => {
        c.web = c.web || {};
        if (!String(c.web.user || '').trim())
            c.web.user = 'admin';
        c.web.passwordHash = hashPassword(bootstrapPassword);
        delete c.web.password;
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
const TERMINAL_GRANT_TTL_MS = Number(process.env.AGENTMESH_TERMINAL_GRANT_TTL_MS || 60 * 1000);
const AUTH_COOKIE_NAME = 'agentmesh_sid';
const app = Fastify({ logger: true, trustProxy: TRUST_PROXY });
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
const sessionSnapshots = new Map();
const sessionPtyBuffers = new Map();
const uiSseClients = new Map();
let uiUpdateVersion = 0;
let uiUpdateFlushTimer = null;
const sessionTerminalClients = new Map();
const webSessions = new Map();
const terminalGrants = new Map();
const loginAttempts = new Map();
const enrollTokens = new Map();
const BIN_MSG_PTY_DATA = 1;
const BIN_MSG_PTY_INPUT = 2;
const PTY_CHUNK_BYTES = 4096;
const PTY_BUFFER_LIMIT_BYTES = 200000;
const RUNNER_WS_BACKPRESSURE_LIMIT = 512 * 1024;
const TERMINAL_WS_BACKPRESSURE_LIMIT = 512 * 1024;
const TERMINAL_WS_HARD_LIMIT = 2 * 1024 * 1024;
const TERMINAL_DROP_LOG_EVERY = 256;
const LOGIN_WINDOW_MS = Number(process.env.AGENTMESH_LOGIN_WINDOW_MS || 10 * 60 * 1000);
const LOGIN_MAX_ATTEMPTS = Number(process.env.AGENTMESH_LOGIN_MAX_ATTEMPTS || 10);
const LOGIN_BLOCK_MS = Number(process.env.AGENTMESH_LOGIN_BLOCK_MS || 15 * 60 * 1000);
const TOOL_ORDER = ['codex', 'claude', 'gemini'];
// Ephemeral online tracking (WS-connected runners)
const runnerOnline = new Set();
const runnerConns = new Map();
const runnerLastMetrics = new Map();
const metrics = {
    startedAt: Date.now(),
    authLogins: 0,
    authFailures: 0,
    authSessionExpired: 0,
    enrollIssued: 0,
    enrollConsumed: 0,
    enrollRejected: 0,
    terminalGrantIssued: 0,
    terminalGrantDenied: 0,
    terminalConnectionsOpened: 0,
    terminalConnectionsClosed: 0,
    terminalFramesOut: 0,
    terminalBytesOut: 0,
    terminalFramesDropped: 0,
    terminalSlowClientClosed: 0,
    runnerBinaryFramesIn: 0,
    runnerBinaryBytesIn: 0,
    runnerInputFramesOut: 0,
    runnerInputBytesOut: 0,
    runnerInputDrops: 0,
    ptyBufferTrimOps: 0,
    ptyBufferBytesCurrent: 0,
    reconcileRequests: 0,
    reconcileResults: 0,
    reconcileSessionUpdates: 0,
};
function timingSafeEqualString(a, b) {
    const bufA = Buffer.from(String(a), 'utf8');
    const bufB = Buffer.from(String(b), 'utf8');
    if (bufA.length !== bufB.length)
        return false;
    // Use node's timingSafeEqual to avoid leaking credentials via timing.
    try {
        return crypto.timingSafeEqual(bufA, bufB);
    }
    catch {
        return false;
    }
}
function base32Decode(raw) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = String(raw || '')
        .toUpperCase()
        .replace(/=+$/g, '')
        .replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of cleaned) {
        const idx = alphabet.indexOf(ch);
        if (idx < 0)
            continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            out.push((value >>> bits) & 0xff);
        }
    }
    return Buffer.from(out);
}
function hotp(secret, counter, digits = 6) {
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
function totpVerify(base32Secret, token, window = 1, stepSeconds = 30) {
    const t = String(token || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(t))
        return false;
    const secret = base32Decode(base32Secret);
    if (!secret.length)
        return false;
    const nowCounter = Math.floor(Date.now() / 1000 / stepSeconds);
    for (let w = -window; w <= window; w += 1) {
        const expected = hotp(secret, nowCounter + w, 6);
        if (timingSafeEqualString(expected, t))
            return true;
    }
    return false;
}
function totpVerifyDefault(secretBase32, token) {
    return totpVerify(secretBase32, token, 1, 30);
}
function buildTotpOtpAuthUrl(issuerRaw, secretBase32, account) {
    const issuerClean = String(issuerRaw || 'AgentMesh').trim() || 'AgentMesh';
    const label = encodeURIComponent(`${issuerClean}:${account}`);
    const issuer = encodeURIComponent(issuerClean);
    const secret = encodeURIComponent(secretBase32.replace(/\s+/g, ''));
    return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}
function parseCookieHeader(raw) {
    const out = {};
    if (!raw)
        return out;
    const parts = raw.split(';');
    for (const part of parts) {
        const i = part.indexOf('=');
        if (i <= 0)
            continue;
        const key = part.slice(0, i).trim();
        const value = part.slice(i + 1).trim();
        if (!key)
            continue;
        try {
            out[key] = decodeURIComponent(value);
        }
        catch {
            out[key] = value;
        }
    }
    return out;
}
function parseWebSocketProtocols(raw) {
    return String(raw || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
}
function extractBearerToken(rawHeader) {
    const raw = String(rawHeader || '').trim();
    if (!raw)
        return '';
    const m = /^Bearer\s+(.+)$/i.exec(raw);
    return m ? m[1].trim() : '';
}
function extractTokenFromProtocolHeader(rawHeader) {
    for (const proto of parseWebSocketProtocols(rawHeader)) {
        if (proto.startsWith('token.'))
            return proto.slice('token.'.length).trim();
    }
    return '';
}
function escapeHtml(raw) {
    return String(raw || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function isSecureRequest(req) {
    const xfp = TRUST_PROXY
        ? String(req.headers['x-forwarded-proto'] || '')
            .split(',')[0]
            .trim()
            .toLowerCase()
        : '';
    if (xfp)
        return xfp === 'https';
    return String(req.protocol || '').toLowerCase() === 'https';
}
function expectedRequestOrigin(req) {
    const protoRaw = String((TRUST_PROXY ? req.headers['x-forwarded-proto'] : '') || req.protocol || 'http').split(',')[0].trim();
    const hostRaw = String((TRUST_PROXY ? req.headers['x-forwarded-host'] : '') || req.headers.host || '').split(',')[0].trim();
    if (!hostRaw)
        return '';
    return `${protoRaw || 'http'}://${hostRaw}`;
}
function isOriginAllowed(req) {
    const origin = String(req.headers.origin || '').trim();
    if (!origin)
        return true;
    const allowed = cfgAllowedOrigins();
    if (allowed.size)
        return allowed.has(origin);
    const expected = expectedRequestOrigin(req);
    if (!expected)
        return true;
    return origin === expected;
}
function normalizeHttpUrl(url) {
    return url.trim().replace(/\/+$/, '');
}
function resolveAssetPath(rawPath) {
    const trimmed = rawPath.trim().replace(/^\/+/, '');
    if (!trimmed)
        return null;
    const normalized = normalize(trimmed).replace(/\\/g, '/');
    if (normalized === '..' || normalized.startsWith('../'))
        return null;
    return join(ASSETS_DIR, normalized);
}
function resolvePublicGateway(req) {
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
function normalizeTtlMs(value, fallbackMs, minMs, maxMs) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallbackMs;
    const ms = Math.floor(n);
    if (ms < minMs)
        return minMs;
    if (ms > maxMs)
        return maxMs;
    return ms;
}
function setAuthCookie(req, reply, sid, expiresAt) {
    const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    const parts = [
        `${AUTH_COOKIE_NAME}=${encodeURIComponent(sid)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${maxAge}`,
    ];
    if (isSecureRequest(req))
        parts.push('Secure');
    reply.header('set-cookie', parts.join('; '));
}
function clearAuthCookie(req, reply) {
    const parts = [
        `${AUTH_COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=0',
    ];
    if (isSecureRequest(req))
        parts.push('Secure');
    reply.header('set-cookie', parts.join('; '));
}
function createWebSession(user) {
    const now = Date.now();
    return {
        id: nanoid(24),
        user,
        csrfToken: nanoid(20),
        createdAt: now,
        expiresAt: now + cfgWebSessionTtlMs(),
    };
}
function getWebSessionFromRequest(req) {
    const cookieHeader = String(req.headers.cookie || '');
    const cookies = parseCookieHeader(cookieHeader);
    const sid = cookies[AUTH_COOKIE_NAME];
    if (!sid)
        return null;
    const session = webSessions.get(sid);
    if (!session)
        return null;
    if (session.expiresAt <= Date.now()) {
        webSessions.delete(sid);
        metrics.authSessionExpired += 1;
        return null;
    }
    return session;
}
function touchWebSession(session) {
    session.expiresAt = Date.now() + cfgWebSessionTtlMs();
}
function getLoginClientKey(req) {
    const directIp = String(req.socket?.remoteAddress || '').trim();
    if (!TRUST_PROXY && directIp)
        return directIp;
    const observedIp = String(req.ip || '').trim();
    return observedIp || directIp || 'unknown';
}
function isLoginRateLimited(req) {
    const key = getLoginClientKey(req);
    const now = Date.now();
    const attempt = loginAttempts.get(key);
    if (!attempt)
        return false;
    if (attempt.blockedUntil > now)
        return true;
    if (attempt.blockedUntil > 0 || now - attempt.firstTs > LOGIN_WINDOW_MS) {
        loginAttempts.delete(key);
    }
    return false;
}
function noteLoginFailure(req) {
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
function clearLoginFailures(req) {
    loginAttempts.delete(getLoginClientKey(req));
}
function requireSessionAccess(session, user) {
    return !session.createdBy || session.createdBy === user;
}
function writeSseEvent(res, event, payload) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
function closeUiSseClient(clientId) {
    const client = uiSseClients.get(clientId);
    if (!client || client.closed)
        return;
    client.closed = true;
    clearInterval(client.heartbeat);
    uiSseClients.delete(clientId);
    try {
        client.res.end();
    }
    catch {
        // ignore close errors
    }
}
function broadcastUiUpdate(nowTs = Date.now()) {
    const payload = { ts: nowTs, version: uiUpdateVersion };
    for (const [clientId, client] of uiSseClients.entries()) {
        if (client.closed) {
            uiSseClients.delete(clientId);
            continue;
        }
        try {
            writeSseEvent(client.res, 'update', payload);
        }
        catch {
            closeUiSseClient(clientId);
        }
    }
}
function scheduleUiUpdate() {
    uiUpdateVersion += 1;
    if (uiUpdateFlushTimer)
        return;
    uiUpdateFlushTimer = setTimeout(() => {
        uiUpdateFlushTimer = null;
        broadcastUiUpdate();
    }, 120);
    uiUpdateFlushTimer.unref();
}
function patchStore(mutator) {
    store.patch(mutator);
    scheduleUiUpdate();
}
function encodeBinaryFrame(kind, sessionId, payload) {
    const sid = Buffer.from(sessionId, 'utf8');
    if (sid.length > 255)
        throw new Error('session id too long');
    const header = Buffer.from([kind, sid.length]);
    return Buffer.concat([header, sid, payload]);
}
function decodeBinaryFrame(raw) {
    if (!raw || raw.length < 2)
        return null;
    const kind = raw.readUInt8(0);
    const sidLen = raw.readUInt8(1);
    const sidStart = 2;
    const sidEnd = sidStart + sidLen;
    if (raw.length < sidEnd)
        return null;
    return {
        kind,
        sessionId: raw.subarray(sidStart, sidEnd).toString('utf8'),
        payload: raw.subarray(sidEnd),
    };
}
function rawDataToBuffer(data) {
    if (Buffer.isBuffer(data))
        return data;
    if (Array.isArray(data))
        return Buffer.concat(data);
    return Buffer.from(data);
}
function normalizeDim(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(400, Math.max(20, Math.floor(n)));
}
function parseBoolFlag(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}
function normalizeToolName(value) {
    return String(value ?? '').trim().toLowerCase();
}
function getRunnerSupportedTools(runner) {
    const rawTools = runner?.capabilities?.tools;
    if (!rawTools || typeof rawTools !== 'object') {
        return ['codex', 'claude'];
    }
    return TOOL_ORDER.filter((tool) => rawTools[tool] === true);
}
function runnerSupportsTool(runner, tool) {
    if (!TOOL_ORDER.includes(tool))
        return false;
    return getRunnerSupportedTools(runner).includes(tool);
}
function sanitizeRunner(runner) {
    const { token, ...rest } = runner || {};
    return {
        ...rest,
        supportedTools: getRunnerSupportedTools(rest),
        online: !!runnerOnline.has(rest.id),
    };
}
function clearSessionArtifacts(sessionId) {
    sessionSnapshots.delete(sessionId);
    const prev = sessionPtyBuffers.get(sessionId);
    if (prev) {
        metrics.ptyBufferBytesCurrent = Math.max(0, metrics.ptyBufferBytesCurrent - prev.length);
    }
    sessionPtyBuffers.delete(sessionId);
    const clients = sessionTerminalClients.get(sessionId);
    if (clients) {
        for (const client of clients) {
            try {
                client.ws.close(1000, 'session deleted');
            }
            catch {
                // ignore close errors
            }
        }
        sessionTerminalClients.delete(sessionId);
    }
}
function cleanupRunnerConnection(runnerId) {
    const conn = runnerConns.get(runnerId);
    if (conn) {
        try {
            conn.close(1000, 'runner deleted');
        }
        catch {
            // ignore close errors
        }
    }
    runnerOnline.delete(runnerId);
    runnerConns.delete(runnerId);
    runnerLastMetrics.delete(runnerId);
    scheduleUiUpdate();
}
function getSession(sessionId) {
    return store.get().sessions[sessionId] || null;
}
function setSessionStatus(sessionId, patch) {
    patchStore((s) => {
        const session = s.sessions[sessionId];
        if (!session)
            return;
        Object.assign(session, patch);
    });
}
function relayPtyInputToRunner(sessionId, dataBuf) {
    const session = getSession(sessionId);
    if (!session)
        return { ok: false, code: 404, error: 'session not found' };
    const conn = runnerConns.get(session.runnerId);
    if (!conn)
        return { ok: false, code: 409, error: 'runner offline' };
    if (!dataBuf.length)
        return { ok: true };
    if (conn.bufferedAmount > RUNNER_WS_BACKPRESSURE_LIMIT) {
        metrics.runnerInputDrops += 1;
        return { ok: false, code: 429, error: 'runner ws busy; retry' };
    }
    for (let i = 0; i < dataBuf.length; i += PTY_CHUNK_BYTES) {
        const chunk = dataBuf.subarray(i, i + PTY_CHUNK_BYTES);
        const frame = encodeBinaryFrame(BIN_MSG_PTY_INPUT, sessionId, chunk);
        conn.send(frame, { binary: true });
        metrics.runnerInputFramesOut += 1;
        metrics.runnerInputBytesOut += chunk.length;
    }
    return { ok: true };
}
function relayResizeToRunner(sessionId, cols, rows) {
    const session = getSession(sessionId);
    if (!session)
        return { ok: false, code: 404, error: 'session not found' };
    const conn = runnerConns.get(session.runnerId);
    if (!conn)
        return { ok: false, code: 409, error: 'runner offline' };
    conn.send(JSON.stringify({ type: 'pty_resize', sessionId, cols, rows, ts: Date.now() }));
    return { ok: true };
}
function appendPtyData(sessionId, chunk) {
    if (!chunk.length)
        return;
    const prev = sessionPtyBuffers.get(sessionId) || Buffer.alloc(0);
    const next = prev.length ? Buffer.concat([prev, chunk]) : chunk;
    const trimmed = next.subarray(Math.max(0, next.length - PTY_BUFFER_LIMIT_BYTES));
    sessionPtyBuffers.set(sessionId, trimmed);
    metrics.ptyBufferBytesCurrent += trimmed.length - prev.length;
    if (trimmed.length < next.length)
        metrics.ptyBufferTrimOps += 1;
    // Fan-out to connected browser terminal clients with slow-client drop policy.
    const clients = sessionTerminalClients.get(sessionId);
    if (!clients || !clients.size)
        return;
    for (const client of clients) {
        const ws = client.ws;
        if (ws.readyState !== 1 /* OPEN */)
            continue;
        const buffered = Number(ws.bufferedAmount || 0);
        if (buffered > TERMINAL_WS_HARD_LIMIT) {
            try {
                ws.close(1013, 'terminal slow client');
            }
            catch {
                // ignore close failures
            }
            metrics.terminalSlowClientClosed += 1;
            continue;
        }
        if (buffered > TERMINAL_WS_BACKPRESSURE_LIMIT) {
            client.droppedFrames += 1;
            metrics.terminalFramesDropped += 1;
            if (client.droppedFrames % TERMINAL_DROP_LOG_EVERY === 0) {
                app.log.warn({ sessionId, droppedFrames: client.droppedFrames, buffered }, 'terminal client dropping frames');
            }
            continue;
        }
        try {
            ws.send(chunk, { binary: true });
            metrics.terminalFramesOut += 1;
            metrics.terminalBytesOut += chunk.length;
        }
        catch {
            // ignore
        }
    }
}
function issueTerminalGrant(sessionId, user) {
    const now = Date.now();
    const grant = {
        token: nanoid(26),
        sessionId,
        user,
        createdAt: now,
        expiresAt: now + TERMINAL_GRANT_TTL_MS,
    };
    terminalGrants.set(grant.token, grant);
    metrics.terminalGrantIssued += 1;
    return grant;
}
function consumeTerminalGrant(token, sessionId, user) {
    const grant = terminalGrants.get(token);
    if (!grant)
        return null;
    terminalGrants.delete(token);
    if (grant.expiresAt <= Date.now())
        return null;
    if (grant.sessionId !== sessionId)
        return null;
    if (grant.user !== user)
        return null;
    return grant;
}
function sendReconcileRequest(runnerId, ws) {
    const knownSessions = Object.values(store.get().sessions)
        .filter((s) => s.runnerId === runnerId)
        .map((s) => ({ sessionId: s.id, status: s.status, tool: s.tool, projectPath: s.projectPath || null }));
    try {
        ws.send(JSON.stringify({ type: 'reconcile_sessions', knownSessions, ts: Date.now() }));
        metrics.reconcileRequests += 1;
    }
    catch (e) {
        app.log.warn({ runnerId, err: e?.message || e }, 'failed to send reconcile_sessions request');
    }
}
function applyReconcileResult(runnerId, activeSessionsRaw) {
    const activeById = new Map();
    for (const raw of activeSessionsRaw || []) {
        const sid = typeof raw?.sessionId === 'string' ? raw.sessionId : '';
        if (!sid)
            continue;
        activeById.set(sid, raw);
    }
    let updates = 0;
    const now = Date.now();
    patchStore((s) => {
        for (const session of Object.values(s.sessions)) {
            if (session.runnerId !== runnerId)
                continue;
            const active = activeById.get(session.id);
            if (active) {
                if (session.status !== 'running') {
                    session.status = 'running';
                    updates += 1;
                }
                if (!session.startedAt)
                    session.startedAt = now;
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
    const terminalClientCount = Array.from(sessionTerminalClients.values()).reduce((sum, set) => sum + set.size, 0);
    const runnerBufferedAmount = {};
    for (const [runnerId, ws] of runnerConns.entries()) {
        runnerBufferedAmount[runnerId] = Number(ws.bufferedAmount || 0);
    }
    const runnerMetricsObj = {};
    for (const [runnerId, value] of runnerLastMetrics.entries()) {
        runnerMetricsObj[runnerId] = value;
    }
    return {
        ...metrics,
        uptimeMs: Date.now() - metrics.startedAt,
        runnerOnlineCount: runnerOnline.size,
        runnerOnlineIds: Array.from(runnerOnline.values()),
        terminalClientCount,
        terminalGrantCount: terminalGrants.size,
        enrollTokenCount: enrollTokens.size,
        webSessionCount: webSessions.size,
        ptyBufferSessionCount: sessionPtyBuffers.size,
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
    for (const [token, grant] of terminalGrants.entries()) {
        if (grant.expiresAt <= now)
            terminalGrants.delete(token);
    }
    for (const [token, enroll] of enrollTokens.entries()) {
        if (enroll.expiresAt <= now)
            enrollTokens.delete(token);
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
    if (path === '/health' || path === '/' || path === '/ws/runner' || path === '/ws/terminal')
        return;
    if (path === '/api/auth/login' || path === '/api/auth/me' || path === '/api/runners/register' || path === '/api/runners/enroll')
        return;
    if (path === '/setup' || path === '/setup/qr' || path === '/setup/confirm')
        return;
    if (!path.startsWith('/api/'))
        return;
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
        if (!csrf || csrf !== session.csrfToken) {
            reply.code(403).send({ ok: false, error: 'csrf mismatch' });
            return reply;
        }
    }
});
function requireWebSession(req, reply) {
    const session = getWebSessionFromRequest(req);
    if (!session) {
        reply.code(401).send({ ok: false, error: 'unauthorized' });
        return null;
    }
    return session;
}
function enforceCsrf(req, reply, session) {
    const method = String(req.method || 'GET').toUpperCase();
    if (!(method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'))
        return true;
    const csrf = String(req.headers['x-agentmesh-csrf'] || '');
    if (!csrf || csrf !== session.csrfToken) {
        reply.code(403).send({ ok: false, error: 'csrf mismatch' });
        return false;
    }
    return true;
}
app.get('/health', async () => ({ ok: true, name: 'agentmesh-gateway', ts: Date.now() }));
app.get('/', async (_req, reply) => {
    const html = readFileSync(UI_FILE, 'utf-8');
    reply.type('text/html; charset=utf-8').send(html);
});
function generateTotpSecretBase32(bytes = 20) {
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
    if (!session)
        return;
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
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgentMesh Setup</title>
    <style>
      body{font-family:ui-sans-serif,system-ui,-apple-system,"PingFang SC","Segoe UI",sans-serif;background:#f6f7f9;margin:0;min-height:100vh;display:grid;place-items:center;color:#0f172a}
      .card{width:min(640px,96vw);background:#fff;border:1px solid rgba(15,23,42,.10);border-radius:18px;box-shadow:0 18px 50px rgba(15,23,42,.08);padding:28px}
      h1{margin:0 0 8px 0;font-size:22px;letter-spacing:-.4px}
      p{margin:0 0 16px 0;color:rgba(15,23,42,.55);line-height:1.5}
      img{max-width:280px;width:100%;height:auto;border-radius:14px;border:1px solid rgba(15,23,42,.10);background:#fff}
      .row{display:flex;gap:18px;flex-wrap:wrap;align-items:center}
      .meta{font-size:12px;color:rgba(15,23,42,.60)}
      input{width:100%;padding:12px 14px;border-radius:14px;border:1px solid rgba(15,23,42,.10);background:rgba(15,23,42,.03);outline:none}
      button{margin-top:10px;padding:12px 16px;border-radius:14px;border:1px solid transparent;background:rgba(15,23,42,.92);color:#fff;font-weight:700;cursor:pointer}
      button.secondary{background:rgba(15,23,42,.03);border-color:rgba(15,23,42,.10);color:#0f172a}
      .err{color:#b91c1c;font-size:13px;min-height:18px;margin-top:8px}
    </style>
  </head><body>
    <div class="card">
      <h1>初始化两步验证</h1>
      <p>用 Google Authenticator 扫码后，输入当前 6 位动态码确认。确认成功后将永久锁定初始化入口。</p>
      <div class="row">
        <div>
          <div class="meta">issuer: ${issuer} · account: ${account}</div>
          <img src="/setup/qr" alt="TOTP QR" />
        </div>
        <div style="flex:1;min-width:260px">
          <div class="meta" style="margin-bottom:6px">6 位动态码</div>
          <input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" />
          <button id="btn">确认并锁定</button>
          <div class="err" id="err"></div>
          <div style="margin-top:10px">
            <a href="/" style="text-decoration:none"><button class="secondary" type="button">返回登录</button></a>
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
    if (!session)
        return;
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
    if (!session)
        return;
    if (!enforceCsrf(req, reply, session))
        return;
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
    const body = (req.body || {});
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
    const wildcard = String(req.params?.['*'] || '');
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
    }
    catch {
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
    const body = (req.body || {});
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const totp = typeof body.totp === 'string' ? body.totp.trim() : '';
    reloadConfig();
    if (username !== cfgWebUser() || !verifyWebPassword(password)) {
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
            defaultPassword: isDefaultCredentialInUse(),
            totpProvisioned: cfgTotpProvisioned(),
            totpEnabled: cfgTotpEnabled(),
        },
    };
});
app.post('/api/auth/logout', async (req, reply) => {
    const session = getWebSessionFromRequest(req);
    if (session)
        webSessions.delete(session.id);
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
            defaultPassword: isDefaultCredentialInUse(),
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
        if (!client || client.closed)
            return;
        try {
            writeSseEvent(client.res, 'heartbeat', { ts: Date.now(), version: uiUpdateVersion });
        }
        catch {
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
    }
    catch {
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
    const body = (req.body || {});
    const ttlMs = normalizeTtlMs(body.ttlMs, cfgEnrollTokenTtlMs(), 30 * 1000, 24 * 60 * 60 * 1000);
    const now = Date.now();
    const token = nanoid(36);
    const expiresAt = now + ttlMs;
    const { gatewayHttp, gatewayWs } = resolvePublicGateway(req);
    const enroll = {
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
    const body = (req.body || {});
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
    const query = (req.query || {});
    const onlineOnly = parseBoolFlag(query.onlineOnly);
    const all = Object.values(s.runners)
        .map((runner) => sanitizeRunner(runner))
        .sort((a, b) => {
        const ao = a.online ? 1 : 0;
        const bo = b.online ? 1 : 0;
        if (ao !== bo)
            return bo - ao;
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
    const runnerId = String(req.params.id || '');
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
    const runnerId = String(req.params.id || '');
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
    const body = (req.body || {});
    const supportedTools = getRunnerSupportedTools(runner);
    if (!supportedTools.length) {
        reply.code(409);
        return { ok: false, error: 'runner reports no supported tools' };
    }
    const requestedTool = normalizeToolName(body.tool);
    const tool = requestedTool || supportedTools[0];
    if (!TOOL_ORDER.includes(tool)) {
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
    const runnerId = String(req.params.id || '');
    const query = (req.query || {});
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
    const sessionIdsToDelete = [];
    const projectIdsToDelete = [];
    for (const session of Object.values(s.sessions)) {
        if (session.runnerId === runnerId)
            sessionIdsToDelete.push(session.id);
    }
    for (const project of Object.values(s.projects)) {
        if (project.runnerId === runnerId)
            projectIdsToDelete.push(project.id);
    }
    patchStore((st) => {
        delete st.runners[runnerId];
        for (const sid of sessionIdsToDelete)
            delete st.sessions[sid];
        for (const pid of projectIdsToDelete)
            delete st.projects[pid];
    });
    for (const sid of sessionIdsToDelete)
        clearSessionArtifacts(sid);
    cleanupRunnerConnection(runnerId);
    return {
        ok: true,
        removedRunnerId: runnerId,
        removedSessions: sessionIdsToDelete.length,
        removedProjects: projectIdsToDelete.length,
    };
});
app.post('/api/projects', async (req) => {
    const body = (req.body || {});
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
    const ws = conn.socket || conn;
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const runnerId = url.searchParams.get('runnerId') || '';
    const tokenFromQuery = url.searchParams.get('token') || '';
    const tokenFromAuth = extractBearerToken(String(req.headers.authorization || ''));
    const token = tokenFromAuth || tokenFromQuery;
    const runner = store.get().runners[runnerId];
    if (!runner || runner.token !== token) {
        ws.close(1008, 'unauthorized');
        return;
    }
    patchStore((s) => {
        if (s.runners[runnerId])
            s.runners[runnerId].lastSeenAt = Date.now();
    });
    runnerOnline.add(runnerId);
    runnerConns.set(runnerId, ws);
    scheduleUiUpdate();
    ws.send(JSON.stringify({ type: 'hello', runnerId, ts: Date.now() }));
    sendReconcileRequest(runnerId, ws);
    ws.on('close', (code, reason) => {
        app.log.info({ runnerId, code, reason: reason?.toString() || '' }, 'runner ws closed');
        runnerOnline.delete(runnerId);
        runnerConns.delete(runnerId);
        scheduleUiUpdate();
    });
    ws.on('error', (err) => {
        app.log.error({ runnerId, err: err?.message || err }, 'runner ws error');
    });
    ws.on('message', (data, isBinary) => {
        if (isBinary) {
            const raw = rawDataToBuffer(data);
            const parsed = decodeBinaryFrame(raw);
            if (!parsed) {
                app.log.warn({ runnerId }, 'invalid binary ws frame');
                return;
            }
            metrics.runnerBinaryFramesIn += 1;
            metrics.runnerBinaryBytesIn += parsed.payload.length;
            if (parsed.kind === BIN_MSG_PTY_DATA) {
                appendPtyData(parsed.sessionId, parsed.payload);
                return;
            }
            app.log.warn({ runnerId, kind: parsed.kind }, 'unknown binary ws frame kind');
            return;
        }
        try {
            const msg = JSON.parse(data.toString());
            if (msg?.type === 'pty_data' && typeof msg.sessionId === 'string' && typeof msg.data === 'string') {
                const payload = Buffer.from(msg.data, 'utf8');
                metrics.runnerBinaryFramesIn += 1;
                metrics.runnerBinaryBytesIn += payload.length;
                appendPtyData(msg.sessionId, payload);
                return;
            }
            if (msg?.type === 'snapshot_result' && typeof msg.sessionId === 'string' && typeof msg.text === 'string') {
                sessionSnapshots.set(msg.sessionId, { ts: Date.now(), text: msg.text });
                return;
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
                    queueBytes: Number(msg.queueBytes || 0),
                    queueFrames: Number(msg.queueFrames || 0),
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
                }
                else {
                    setSessionStatus(msg.sessionId, {
                        status: 'error',
                        lastError: typeof msg.error === 'string' ? msg.error : 'start session failed',
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
                setSessionStatus(msg.sessionId, { status: 'exited', exitedAt: Date.now() });
                return;
            }
        }
        catch {
            // ignore parse errors
        }
    });
});
// Browser terminal WS: client connects with ?sessionId=... and token via Sec-WebSocket-Protocol.
app.get('/ws/terminal', { websocket: true }, (conn, req) => {
    const ws = conn.socket || conn;
    if (!isOriginAllowed(req)) {
        ws.close(1008, 'origin not allowed');
        return;
    }
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId') || '';
    const tokenFromQuery = url.searchParams.get('token') || '';
    const tokenFromProtocol = extractTokenFromProtocolHeader(String(req.headers['sec-websocket-protocol'] || ''));
    const terminalToken = tokenFromProtocol || tokenFromQuery;
    if (!sessionId || !terminalToken) {
        ws.close(1008, 'missing sessionId/token');
        return;
    }
    const webSession = getWebSessionFromRequest(req);
    if (!webSession) {
        ws.close(1008, 'unauthorized');
        return;
    }
    const session = getSession(sessionId);
    if (!session) {
        ws.close(1008, 'session not found');
        return;
    }
    if (!requireSessionAccess(session, webSession.user)) {
        ws.close(1008, 'forbidden');
        return;
    }
    const grant = consumeTerminalGrant(terminalToken, sessionId, webSession.user);
    if (!grant) {
        ws.close(1008, 'invalid terminal token');
        return;
    }
    const client = { ws, droppedFrames: 0 };
    const set = sessionTerminalClients.get(sessionId) || new Set();
    set.add(client);
    sessionTerminalClients.set(sessionId, set);
    metrics.terminalConnectionsOpened += 1;
    // Send buffered tail immediately so UI has context.
    const buf = sessionPtyBuffers.get(sessionId);
    if (buf && buf.length) {
        try {
            ws.send(buf, { binary: true });
        }
        catch {
            // ignore
        }
    }
    ws.on('close', () => {
        const clients = sessionTerminalClients.get(sessionId);
        if (clients) {
            clients.delete(client);
            if (!clients.size)
                sessionTerminalClients.delete(sessionId);
        }
        metrics.terminalConnectionsClosed += 1;
    });
    ws.on('message', (data, isBinary) => {
        if (isBinary) {
            const result = relayPtyInputToRunner(sessionId, rawDataToBuffer(data));
            if (!result.ok) {
                app.log.debug({ sessionId, error: result.error }, 'terminal binary input dropped');
            }
            return;
        }
        // Compatibility mode for old browser clients using JSON messages.
        let msg;
        try {
            msg = JSON.parse(data.toString());
        }
        catch {
            return;
        }
        if (msg?.type === 'input' && typeof msg.data === 'string') {
            const result = relayPtyInputToRunner(sessionId, Buffer.from(msg.data, 'utf8'));
            if (!result.ok) {
                app.log.debug({ sessionId, error: result.error }, 'terminal json input dropped');
            }
            return;
        }
        if (msg?.type === 'resize') {
            const cols = normalizeDim(msg.cols, 120);
            const rows = normalizeDim(msg.rows, 34);
            const result = relayResizeToRunner(sessionId, cols, rows);
            if (!result.ok) {
                app.log.debug({ sessionId, error: result.error }, 'terminal resize dropped');
            }
        }
    });
});
app.post('/api/sessions', async (req, reply) => {
    const authSession = getWebSessionFromRequest(req);
    if (!authSession) {
        reply.code(401);
        return { ok: false, error: 'unauthorized' };
    }
    const body = (req.body || {});
    const projectId = String(body.projectId || '');
    const requestedRunnerId = typeof body.runnerId === 'string' ? body.runnerId.trim() : '';
    const tool = normalizeToolName(body.tool);
    if (!projectId || !tool) {
        reply.code(400);
        return { ok: false, error: 'projectId and tool are required' };
    }
    if (!TOOL_ORDER.includes(tool)) {
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
    const projectPath = typeof body.projectPath === 'string' && body.projectPath.trim()
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
    const sessionId = req.params.id;
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
app.post('/api/sessions/:id/start', async (req, reply) => {
    const authSession = getWebSessionFromRequest(req);
    if (!authSession) {
        reply.code(401);
        return { ok: false, error: 'unauthorized' };
    }
    const sessionId = req.params.id;
    const body = (req.body || {});
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
    const projectPath = typeof body.projectPath === 'string' && body.projectPath.trim()
        ? body.projectPath.trim()
        : session.projectPath || project?.path || null;
    const cols = normalizeDim(body.cols, 120);
    const rows = normalizeDim(body.rows, 34);
    const cmd = {
        type: 'start_session',
        sessionId,
        tool: session.tool,
        projectId: session.projectId,
        projectPath,
        cols,
        rows,
        ts: Date.now(),
    };
    app.log.info({ runnerId: session.runnerId, sessionId, tool: session.tool, projectPath }, 'start_session send');
    try {
        conn.send(JSON.stringify(cmd));
    }
    catch (e) {
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
app.post('/api/sessions/:id/stop', async (req, reply) => {
    const authSession = getWebSessionFromRequest(req);
    if (!authSession) {
        reply.code(401);
        return { ok: false, error: 'unauthorized' };
    }
    const sessionId = req.params.id;
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
        conn.send(JSON.stringify({ type: 'stop_session', sessionId, ts: Date.now() }));
    }
    catch (e) {
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
    const sessionId = String(req.params.id || '');
    const query = (req.query || {});
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
                conn.send(JSON.stringify({ type: 'stop_session', sessionId, ts: Date.now() }));
            }
            catch {
                // ignore stop errors when force deleting
            }
        }
    }
    const projectId = session.projectId;
    let removedProjectId = null;
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
app.post('/api/sessions/:id/terminal-token', async (req, reply) => {
    const authSession = getWebSessionFromRequest(req);
    if (!authSession) {
        reply.code(401);
        return { ok: false, error: 'unauthorized' };
    }
    const sessionId = req.params.id;
    const session = getSession(sessionId);
    if (!session) {
        reply.code(404);
        return { ok: false, error: 'session not found' };
    }
    if (!requireSessionAccess(session, authSession.user)) {
        metrics.terminalGrantDenied += 1;
        reply.code(403);
        return { ok: false, error: 'forbidden' };
    }
    const grant = issueTerminalGrant(sessionId, authSession.user);
    return {
        ok: true,
        sessionId,
        token: grant.token,
        expiresAt: grant.expiresAt,
    };
});
app.get('/api/sessions/:id/snapshot/latest', async (req, reply) => {
    const authSession = getWebSessionFromRequest(req);
    if (!authSession) {
        reply.code(401);
        return { ok: false, error: 'unauthorized' };
    }
    const sessionId = req.params.id;
    const session = getSession(sessionId);
    if (!session) {
        reply.code(404);
        return { ok: false, error: 'session not found' };
    }
    if (!requireSessionAccess(session, authSession.user)) {
        reply.code(403);
        return { ok: false, error: 'forbidden' };
    }
    const snap = sessionSnapshots.get(sessionId);
    if (!snap) {
        reply.code(404);
        return { ok: false, error: 'no snapshot yet' };
    }
    return { ok: true, sessionId, ...snap };
});
app.get('/api/sessions/:id/snapshot', async (req, reply) => {
    const authSession = getWebSessionFromRequest(req);
    if (!authSession) {
        reply.code(401);
        return { ok: false, error: 'unauthorized' };
    }
    const sessionId = req.params.id;
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
    const requestId = nanoid(10);
    conn.send(JSON.stringify({ type: 'snapshot', requestId, sessionId, ts: Date.now() }));
    return { ok: true, requestId };
});
app.get('/api/sessions/:id/pty/latest', async (req, reply) => {
    const authSession = getWebSessionFromRequest(req);
    if (!authSession) {
        reply.code(401);
        return { ok: false, error: 'unauthorized' };
    }
    const sessionId = req.params.id;
    const session = getSession(sessionId);
    if (!session) {
        reply.code(404);
        return { ok: false, error: 'session not found' };
    }
    if (!requireSessionAccess(session, authSession.user)) {
        reply.code(403);
        return { ok: false, error: 'forbidden' };
    }
    const buf = sessionPtyBuffers.get(sessionId);
    if (!buf || !buf.length) {
        reply.code(404);
        return { ok: false, error: 'no pty data yet' };
    }
    return { ok: true, sessionId, ts: Date.now(), data: buf.toString('utf8') };
});
app.post('/api/sessions/:id/pty/input', async (req, reply) => {
    const authSession = getWebSessionFromRequest(req);
    if (!authSession) {
        reply.code(401);
        return { ok: false, error: 'unauthorized' };
    }
    const sessionId = req.params.id;
    const session = getSession(sessionId);
    if (!session) {
        reply.code(404);
        return { ok: false, error: 'session not found' };
    }
    if (!requireSessionAccess(session, authSession.user)) {
        reply.code(403);
        return { ok: false, error: 'forbidden' };
    }
    const body = (req.body || {});
    const dataBuf = typeof body.dataBase64 === 'string'
        ? Buffer.from(body.dataBase64, 'base64')
        : Buffer.from(typeof body.data === 'string' ? body.data : '', 'utf8');
    const result = relayPtyInputToRunner(sessionId, dataBuf);
    if (!result.ok) {
        reply.code(result.code || 500);
        return { ok: false, error: result.error || 'failed to relay input' };
    }
    app.log.debug({ runnerId: session.runnerId, sessionId, n: dataBuf.length }, 'pty_input relayed');
    return { ok: true, sentBytes: dataBuf.length };
});
app.post('/api/sessions/:id/pty/resize', async (req, reply) => {
    const authSession = getWebSessionFromRequest(req);
    if (!authSession) {
        reply.code(401);
        return { ok: false, error: 'unauthorized' };
    }
    const sessionId = req.params.id;
    const session = getSession(sessionId);
    if (!session) {
        reply.code(404);
        return { ok: false, error: 'session not found' };
    }
    if (!requireSessionAccess(session, authSession.user)) {
        reply.code(403);
        return { ok: false, error: 'forbidden' };
    }
    const body = (req.body || {});
    const cols = normalizeDim(body.cols, 120);
    const rows = normalizeDim(body.rows, 34);
    const result = relayResizeToRunner(sessionId, cols, rows);
    if (!result.ok) {
        reply.code(result.code || 500);
        return { ok: false, error: result.error || 'failed to relay resize' };
    }
    return { ok: true };
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
