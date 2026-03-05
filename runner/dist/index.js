process.on('uncaughtException', (e) => { console.error('[runner] uncaughtException', e); });
process.on('unhandledRejection', (e) => { console.error('[runner] unhandledRejection', e); });
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { Buffer } from 'node:buffer';
import { loadIdentity, saveIdentity } from './state.js';
import { spawnCodexPty, resizePty, killPty } from './pty.js';
let gatewayHttp = process.env.AGENTMESH_GATEWAY_HTTP || 'http://127.0.0.1:8787';
let gatewayWs = process.env.AGENTMESH_GATEWAY_WS || gatewayHttp.replace(/^http/, 'ws');
const RUNNER_NAME = process.env.AGENTMESH_RUNNER_NAME || os.hostname();
const ID_FILE = process.env.AGENTMESH_RUNNER_ID_FILE || new URL('../data/identity.json', import.meta.url).pathname;
const ENROLL_CODE = String(process.env.AGENTMESH_ENROLL_CODE || '').trim();
const BIN_MSG_PTY_DATA = 1;
const BIN_MSG_PTY_INPUT = 2;
const WS_FLUSH_BATCH = 48;
const WS_BACKPRESSURE_LIMIT = 256 * 1024;
const WS_QUEUE_LIMIT_BYTES = 2 * 1024 * 1024;
const PTY_CHUNK_BYTES = 4096;
const SUPPORTED_TOOLS = new Set(['codex', 'claude', 'gemini']);
const METRICS_HEARTBEAT_MS = Number(process.env.AGENTMESH_RUNNER_METRICS_HEARTBEAT_MS || 5000);
gatewayHttp = gatewayHttp.trim().replace(/\/+$/, '');
gatewayWs = gatewayWs.trim().replace(/\/+$/, '');
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function normalizeGatewayUrl(url) {
    return url.trim().replace(/\/+$/, '');
}
function parseEnrollCode(rawCode) {
    const raw = rawCode.trim();
    if (!raw)
        throw new Error('empty enroll code');
    let decoded = '';
    try {
        decoded = Buffer.from(raw, 'base64url').toString('utf8');
    }
    catch (e) {
        throw new Error(`invalid enroll code encoding: ${e?.message || e}`);
    }
    let payload;
    try {
        payload = JSON.parse(decoded);
    }
    catch (e) {
        throw new Error(`invalid enroll code json: ${e?.message || e}`);
    }
    if (!payload || typeof payload.token !== 'string' || !payload.token.trim()) {
        throw new Error('invalid enroll code payload: token missing');
    }
    const exp = Number(payload.exp || 0);
    if (Number.isFinite(exp) && exp > 0 && exp <= Date.now()) {
        throw new Error('enroll code expired');
    }
    return payload;
}
async function registerRunner() {
    const res = await fetch(`${gatewayHttp}/api/runners/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: RUNNER_NAME, capabilities: detectCapabilities() }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`register failed: ${res.status} ${text}`);
    }
    const j = await res.json();
    if (!j?.runnerId || !j?.runnerToken)
        throw new Error(`bad register response: ${JSON.stringify(j)}`);
    const id = { runnerId: j.runnerId, runnerToken: j.runnerToken, createdAt: Date.now() };
    saveIdentity(ID_FILE, id);
    return id;
}
async function enrollRunner(enrollCode) {
    const payload = parseEnrollCode(enrollCode);
    if (typeof payload.gatewayHttp === 'string' && payload.gatewayHttp.trim()) {
        gatewayHttp = normalizeGatewayUrl(payload.gatewayHttp);
    }
    else {
        gatewayHttp = normalizeGatewayUrl(gatewayHttp);
    }
    if (typeof payload.gatewayWs === 'string' && payload.gatewayWs.trim()) {
        gatewayWs = normalizeGatewayUrl(payload.gatewayWs);
    }
    else {
        gatewayWs = gatewayHttp.replace(/^http/i, 'ws');
    }
    const res = await fetch(`${gatewayHttp}/api/runners/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: payload.token, name: RUNNER_NAME, capabilities: detectCapabilities() }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`enroll failed: ${res.status} ${text}`);
    }
    const j = await res.json();
    if (!j?.runnerId || !j?.runnerToken)
        throw new Error(`bad enroll response: ${JSON.stringify(j)}`);
    if (typeof j.gatewayWs === 'string' && j.gatewayWs.trim()) {
        gatewayWs = normalizeGatewayUrl(j.gatewayWs);
    }
    const id = { runnerId: j.runnerId, runnerToken: j.runnerToken, createdAt: Date.now() };
    saveIdentity(ID_FILE, id);
    return id;
}
function detectCapabilities() {
    return {
        tools: {
            codex: true,
            claude: true,
            gemini: true,
        },
        features: {
            tmux: true,
        },
        platform: {
            os: process.platform,
            arch: process.arch,
        },
    };
}
async function ensureIdentity() {
    const existing = loadIdentity(ID_FILE);
    if (existing)
        return existing;
    if (ENROLL_CODE)
        return enrollRunner(ENROLL_CODE);
    return registerRunner();
}
function resolveProjectPath(projectPath) {
    const p = typeof projectPath === 'string' && projectPath.trim() ? projectPath.trim() : process.cwd();
    return path.resolve(p);
}
function encodeBinaryFrame(kind, sessionId, payload) {
    const sid = Buffer.from(sessionId, 'utf8');
    if (sid.length > 255)
        throw new Error('session id too long');
    return Buffer.concat([Buffer.from([kind, sid.length]), sid, payload]);
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
async function connectLoop() {
    let attempt = 0;
    const sessions = new Map();
    const sessionTools = new Map();
    while (true) {
        attempt += 1;
        try {
            const id = await ensureIdentity();
            const wsUrl = `${gatewayWs}/ws/runner?runnerId=${encodeURIComponent(id.runnerId)}&token=${encodeURIComponent(id.runnerToken)}`;
            console.log(`[runner] connecting ws ${wsUrl}`);
            const ws = new WebSocket(wsUrl);
            await new Promise((resolve, reject) => {
                ws.once('open', () => resolve());
                ws.once('error', (e) => reject(e));
            });
            attempt = 0;
            console.log('[runner] ws connected');
            let wsClosed = false;
            const outQueue = [];
            let queuedBytes = 0;
            let flushTimer = null;
            let metricsTimer = null;
            const counters = {
                framesQueued: 0,
                bytesQueued: 0,
                framesSent: 0,
                bytesSent: 0,
                framesDropped: 0,
                bytesDropped: 0,
                queueHighWatermarkBytes: 0,
            };
            const flushOutgoing = () => {
                if (wsClosed || ws.readyState !== WebSocket.OPEN)
                    return;
                let sent = 0;
                while (outQueue.length && sent < WS_FLUSH_BATCH) {
                    if (ws.bufferedAmount > WS_BACKPRESSURE_LIMIT)
                        break;
                    const frame = outQueue.shift();
                    queuedBytes -= frame.length;
                    counters.framesSent += 1;
                    counters.bytesSent += frame.length;
                    ws.send(frame, { binary: true }, (err) => {
                        if (err)
                            console.error('[runner] ws send(binary) failed', err?.message || err);
                    });
                    sent += 1;
                }
                if (!outQueue.length && flushTimer) {
                    clearInterval(flushTimer);
                    flushTimer = null;
                }
            };
            const enqueuePtyData = (sessionId, data) => {
                if (!data)
                    return;
                const raw = Buffer.from(data, 'utf8');
                for (let i = 0; i < raw.length; i += PTY_CHUNK_BYTES) {
                    const chunk = raw.subarray(i, i + PTY_CHUNK_BYTES);
                    const frame = encodeBinaryFrame(BIN_MSG_PTY_DATA, sessionId, chunk);
                    outQueue.push(frame);
                    queuedBytes += frame.length;
                    counters.framesQueued += 1;
                    counters.bytesQueued += frame.length;
                    if (queuedBytes > counters.queueHighWatermarkBytes)
                        counters.queueHighWatermarkBytes = queuedBytes;
                }
                while (queuedBytes > WS_QUEUE_LIMIT_BYTES && outQueue.length) {
                    const dropped = outQueue.shift();
                    queuedBytes -= dropped.length;
                    counters.framesDropped += 1;
                    counters.bytesDropped += dropped.length;
                }
                if (queuedBytes > WS_QUEUE_LIMIT_BYTES * 0.8) {
                    console.warn('[runner] pty queue high watermark', { queuedBytes, frames: outQueue.length });
                }
                if (!flushTimer)
                    flushTimer = setInterval(flushOutgoing, 12);
                flushOutgoing();
            };
            const snapshotActiveSessions = () => Array.from(sessions.entries()).map(([sessionId, ps]) => ({
                sessionId,
                tool: sessionTools.get(sessionId) || 'unknown',
                cwd: ps.cwd,
                createdAt: ps.createdAt,
                cols: ps.cols,
                rows: ps.rows,
            }));
            ws.on('error', (e) => {
                console.error('[runner] ws error', e?.message || e);
            });
            ws.on('close', (code, reason) => {
                wsClosed = true;
                if (flushTimer) {
                    clearInterval(flushTimer);
                    flushTimer = null;
                }
                if (metricsTimer) {
                    clearInterval(metricsTimer);
                    metricsTimer = null;
                }
                console.log(`[runner] ws closed code=${code} reason=${reason?.toString() || ''}`);
            });
            ws.send(JSON.stringify({ type: 'capabilities', capabilities: detectCapabilities(), ts: Date.now() }));
            metricsTimer = setInterval(() => {
                if (wsClosed || ws.readyState !== WebSocket.OPEN)
                    return;
                ws.send(JSON.stringify({
                    type: 'runner_metrics',
                    ts: Date.now(),
                    queueBytes: queuedBytes,
                    queueFrames: outQueue.length,
                    counters,
                    activeSessions: snapshotActiveSessions(),
                }));
            }, METRICS_HEARTBEAT_MS);
            ws.on('message', async (data, isBinary) => {
                if (isBinary) {
                    const parsed = decodeBinaryFrame(rawDataToBuffer(data));
                    if (!parsed) {
                        console.warn('[runner] invalid binary frame');
                        return;
                    }
                    if (parsed.kind === BIN_MSG_PTY_INPUT) {
                        const ps = sessions.get(parsed.sessionId);
                        if (!ps)
                            return;
                        if (parsed.payload.length)
                            ps.pty.write(parsed.payload.toString('utf8'));
                        return;
                    }
                    console.warn('[runner] unknown binary frame kind', parsed.kind);
                    return;
                }
                const raw = data.toString();
                let msg;
                try {
                    msg = JSON.parse(raw);
                }
                catch {
                    console.log('[runner] msg(raw)', raw.slice(0, 2000));
                    return;
                }
                if (msg?.type === 'hello') {
                    console.log(`[runner] hello from gateway runnerId=${msg.runnerId}`);
                    return;
                }
                if (msg?.type === 'reconcile_sessions') {
                    ws.send(JSON.stringify({
                        type: 'reconcile_sessions_result',
                        ts: Date.now(),
                        activeSessions: snapshotActiveSessions(),
                    }));
                    return;
                }
                if (msg?.type === 'start_session') {
                    console.log('[runner] got start_session', msg);
                    try {
                        const sessionId = String(msg.sessionId || '');
                        const tool = String(msg.tool || '');
                        const projectPath = resolveProjectPath(msg.projectPath);
                        const cols = Number(msg.cols || 120);
                        const rows = Number(msg.rows || 34);
                        if (!sessionId || !SUPPORTED_TOOLS.has(tool)) {
                            ws.send(JSON.stringify({ type: 'start_session_result', ok: false, sessionId, error: 'unsupported tool' }));
                            return;
                        }
                        if (sessions.has(sessionId)) {
                            ws.send(JSON.stringify({ type: 'start_session_result', ok: false, sessionId, error: 'session already exists' }));
                            return;
                        }
                        const ps = spawnCodexPty(sessionId, projectPath, cols, rows);
                        console.log('[runner] spawned pty', { sessionId, pid: ps.pty.pid });
                        sessions.set(sessionId, ps);
                        sessionTools.set(sessionId, tool);
                        ps.pty.onData((chunk) => {
                            enqueuePtyData(sessionId, chunk);
                        });
                        // Start tool *after* onData is wired so we don't miss the initial screen.
                        ps.pty.write(`${tool}\r`);
                        ps.pty.onExit(() => {
                            sessions.delete(sessionId);
                            sessionTools.delete(sessionId);
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ type: 'session_exit', sessionId, ts: Date.now() }));
                            }
                        });
                        ws.send(JSON.stringify({ type: 'start_session_result', ok: true, sessionId, ts: Date.now() }));
                    }
                    catch (e) {
                        console.error('[runner] start_session error', e);
                        ws.send(JSON.stringify({
                            type: 'start_session_result',
                            ok: false,
                            sessionId: msg?.sessionId,
                            error: e?.message || String(e),
                            ts: Date.now(),
                        }));
                    }
                    return;
                }
                if (msg?.type === 'stop_session') {
                    const sessionId = String(msg.sessionId || '');
                    const ps = sessions.get(sessionId);
                    if (!ps) {
                        ws.send(JSON.stringify({
                            type: 'stop_session_result',
                            ok: false,
                            sessionId,
                            error: 'session not found',
                            ts: Date.now(),
                        }));
                        return;
                    }
                    killPty(ps);
                    ws.send(JSON.stringify({ type: 'stop_session_result', ok: true, sessionId, ts: Date.now() }));
                    return;
                }
                if (msg?.type === 'snapshot') {
                    ws.send(JSON.stringify({
                        type: 'snapshot_result',
                        ok: false,
                        requestId: msg?.requestId,
                        sessionId: msg?.sessionId,
                        error: 'snapshot deprecated; use pty streaming',
                        ts: Date.now(),
                    }));
                    return;
                }
                if (msg?.type === 'pty_input') {
                    const sessionId = String(msg.sessionId || '');
                    const input = typeof msg.data === 'string' ? msg.data : '';
                    const ps = sessions.get(sessionId);
                    if (ps && input)
                        ps.pty.write(input);
                    return;
                }
                if (msg?.type === 'pty_resize') {
                    const sessionId = String(msg.sessionId || '');
                    const cols = Number(msg.cols || 120);
                    const rows = Number(msg.rows || 34);
                    const ps = sessions.get(sessionId);
                    if (ps)
                        resizePty(ps, cols, rows);
                    return;
                }
                console.log('[runner] msg', msg);
            });
            await new Promise((resolve) => {
                ws.once('close', () => resolve());
            });
            console.log('[runner] ws closed; will reconnect');
        }
        catch (e) {
            console.error('[runner] connect loop error:', e?.message || e);
        }
        const backoff = Math.min(15000, 500 + attempt * 500);
        await sleep(backoff);
    }
}
await connectLoop();
