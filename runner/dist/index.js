import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { loadIdentity, saveIdentity } from './state.js';
import { AcpRunnerSession } from './acp-session.js';
import { detectToolCapabilities, resolveToolCommands, supportedToolsFrom, } from './tooling.js';
let gatewayHttp = process.env.AGENTMESH_GATEWAY_HTTP || 'http://127.0.0.1:8787';
let gatewayWs = process.env.AGENTMESH_GATEWAY_WS || gatewayHttp.replace(/^http/, 'ws');
const RUNNER_NAME = process.env.AGENTMESH_RUNNER_NAME || os.hostname();
const ID_FILE = process.env.AGENTMESH_RUNNER_ID_FILE || new URL('../data/identity.json', import.meta.url).pathname;
const ENROLL_CODE = String(process.env.AGENTMESH_ENROLL_CODE || '').trim();
const METRICS_HEARTBEAT_MS = Number(process.env.AGENTMESH_RUNNER_METRICS_HEARTBEAT_MS || 5000);
const RUNNER_DEBUG = parseEnvBool(process.env.AGENTMESH_RUNNER_DEBUG, false);
let toolCommands = resolveToolCommands();
let localCapabilities = detectCapabilities();
let supportedTools = supportedToolsFrom(localCapabilities.tools);
gatewayHttp = gatewayHttp.trim().replace(/\/+$/, '');
gatewayWs = gatewayWs.trim().replace(/\/+$/, '');
const counters = {
    outboundMessages: 0,
    outboundBytes: 0,
    promptsSubmitted: 0,
    permissionRequests: 0,
    terminalSpawns: 0,
};
function parseEnvBool(raw, fallback) {
    if (typeof raw !== 'string')
        return fallback;
    const v = raw.trim().toLowerCase();
    if (!v)
        return fallback;
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function normalizeGatewayUrl(url) {
    return url.trim().replace(/\/+$/, '');
}
function logInfo(message, extra) {
    if (extra === undefined) {
        console.log('[runner]', message);
        return;
    }
    console.log('[runner]', message, extra);
}
function logWarn(message, extra) {
    if (extra === undefined) {
        console.warn('[runner]', message);
        return;
    }
    console.warn('[runner]', message, extra);
}
function logError(message, extra) {
    if (extra === undefined) {
        console.error('[runner]', message);
        return;
    }
    console.error('[runner]', message, extra);
}
function logDebug(message, extra) {
    if (!RUNNER_DEBUG)
        return;
    if (extra === undefined) {
        console.log('[runner][debug]', message);
        return;
    }
    console.log('[runner][debug]', message, extra);
}
process.on('uncaughtException', (e) => {
    logError('uncaughtException', e);
});
process.on('unhandledRejection', (e) => {
    logError('unhandledRejection', e);
});
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
    if (!payload || typeof payload !== 'object' || typeof payload.token !== 'string') {
        throw new Error('invalid enroll code payload: token missing');
    }
    const exp = Number(payload.exp || 0);
    if (Number.isFinite(exp) && exp > 0 && exp <= Date.now()) {
        throw new Error('enroll code expired');
    }
    return payload;
}
async function enrollRunner(enrollCode) {
    const capabilities = refreshLocalCapabilities();
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
        body: JSON.stringify({ token: payload.token, name: RUNNER_NAME, capabilities }),
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
    const detected = detectToolCapabilities(toolCommands);
    const { tools, toolDetails, unsupported } = detected;
    if (unsupported.length) {
        logWarn('tool unavailable on this host', { unsupported });
    }
    return {
        tools,
        toolDetails,
        features: {
            acp: true,
        },
        platform: {
            os: process.platform,
            arch: process.arch,
        },
    };
}
function refreshLocalCapabilities() {
    toolCommands = resolveToolCommands();
    localCapabilities = detectCapabilities();
    supportedTools = supportedToolsFrom(localCapabilities.tools);
    return localCapabilities;
}
async function ensureIdentity() {
    const existing = loadIdentity(ID_FILE);
    if (existing)
        return existing;
    if (!ENROLL_CODE) {
        throw new Error('runner identity missing; set AGENTMESH_ENROLL_CODE and enroll via gateway first');
    }
    return enrollRunner(ENROLL_CODE);
}
function resolveProjectPath(projectPath) {
    const raw = typeof projectPath === 'string' && projectPath.trim() ? projectPath.trim() : process.cwd();
    return path.resolve(raw);
}
function serializeMessage(message) {
    return JSON.stringify(message);
}
function snapshotActiveSessions(sessions) {
    return Array.from(sessions.values()).map((session) => ({
        sessionId: session.sessionId,
        tool: session.tool,
        cwd: session.cwd,
        createdAt: session.createdAt,
    }));
}
async function connectLoop() {
    const identity = await ensureIdentity();
    let attempt = 0;
    const sessions = new Map();
    const pendingSessions = new Set();
    let activeWs = null;
    const send = (message) => {
        if (!activeWs || activeWs.readyState !== WebSocket.OPEN)
            return;
        const raw = serializeMessage(message);
        activeWs.send(raw);
        counters.outboundMessages += 1;
        counters.outboundBytes += Buffer.byteLength(raw, 'utf8');
    };
    const emitFromSession = (message) => {
        if (message.type === 'acp_permission_request')
            counters.permissionRequests += 1;
        if (message.type === 'session_exit' && typeof message.sessionId === 'string') {
            sessions.delete(message.sessionId);
        }
        send(message);
    };
    const stopAllSessions = async () => {
        for (const [sessionId, session] of sessions.entries()) {
            await session.stop().catch(() => undefined);
            sessions.delete(sessionId);
        }
    };
    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        logInfo(`received ${signal}; stopping sessions`);
        void stopAllSessions().finally(() => process.exit(0));
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    while (true) {
        attempt += 1;
        const runnerWsBase = gatewayWs.replace(/^http/i, 'ws');
        const wsUrl = `${runnerWsBase}/ws/runner?runnerId=${encodeURIComponent(identity.runnerId)}`;
        logInfo(`connecting to ${wsUrl}`);
        let closeCode = 0;
        try {
            const ws = new WebSocket(wsUrl, {
                headers: { Authorization: `Bearer ${identity.runnerToken}` },
            });
            activeWs = ws;
            let wsClosed = false;
            let metricsTimer = null;
            await new Promise((resolve, reject) => {
                ws.once('open', () => resolve());
                ws.once('error', reject);
            });
            logInfo('runner websocket connected');
            send({ type: 'capabilities', capabilities: localCapabilities, ts: Date.now() });
            metricsTimer = setInterval(() => {
                if (wsClosed || ws.readyState !== WebSocket.OPEN)
                    return;
                send({
                    type: 'runner_metrics',
                    ts: Date.now(),
                    counters,
                    activeSessions: snapshotActiveSessions(sessions),
                });
            }, METRICS_HEARTBEAT_MS);
            ws.on('error', (e) => {
                logError('ws error', e);
            });
            ws.on('close', (code, reason) => {
                wsClosed = true;
                closeCode = code;
                if (metricsTimer) {
                    clearInterval(metricsTimer);
                    metricsTimer = null;
                }
                logWarn(`ws closed code=${code} reason=${reason?.toString() || ''}`);
            });
            ws.on('message', async (data, isBinary) => {
                if (isBinary)
                    return;
                const raw = data.toString();
                let msg;
                try {
                    msg = JSON.parse(raw);
                }
                catch {
                    logDebug('msg(raw)', raw.slice(0, 2000));
                    return;
                }
                attempt = 0;
                if (msg?.type === 'hello') {
                    logDebug(`hello from gateway runnerId=${msg.runnerId}`);
                    return;
                }
                if (msg?.type === 'reconcile_sessions') {
                    send({
                        type: 'reconcile_sessions_result',
                        ts: Date.now(),
                        activeSessions: snapshotActiveSessions(sessions),
                    });
                    return;
                }
                if (msg?.type === 'start_session') {
                    const sessionId = String(msg.sessionId || '');
                    const tool = String(msg.tool || '').toLowerCase();
                    try {
                        if (!sessionId || !supportedTools.has(tool)) {
                            const supportedList = Array.from(supportedTools.values()).join('|') || 'none';
                            send({
                                type: 'start_session_result',
                                ok: false,
                                sessionId,
                                error: `unsupported tool: ${tool || '<empty>'}; supported=${supportedList}`,
                                ts: Date.now(),
                            });
                            return;
                        }
                        if (sessions.has(sessionId) || pendingSessions.has(sessionId)) {
                            send({
                                type: 'start_session_result',
                                ok: false,
                                sessionId,
                                error: 'session already exists',
                                ts: Date.now(),
                            });
                            return;
                        }
                        pendingSessions.add(sessionId);
                        try {
                            const session = await AcpRunnerSession.start({
                                sessionId,
                                tool,
                                cwd: resolveProjectPath(msg.projectPath),
                                spec: toolCommands[tool],
                                emit: emitFromSession,
                            });
                            sessions.set(sessionId, session);
                            logInfo('started ACP session', { sessionId, tool, cwd: session.cwd });
                        }
                        finally {
                            pendingSessions.delete(sessionId);
                        }
                    }
                    catch (error) {
                        logError('start_session error', error);
                        send({
                            type: 'start_session_result',
                            ok: false,
                            sessionId,
                            error: error?.message || String(error),
                            ts: Date.now(),
                        });
                    }
                    return;
                }
                if (msg?.type === 'prompt_session') {
                    const sessionId = String(msg.sessionId || '');
                    const promptId = String(msg.promptId || randomUUID());
                    const text = typeof msg.text === 'string' ? msg.text : '';
                    const session = sessions.get(sessionId);
                    if (!session) {
                        send({
                            type: 'prompt_result',
                            sessionId,
                            promptId,
                            ok: false,
                            error: 'session not found',
                            ts: Date.now(),
                        });
                        return;
                    }
                    counters.promptsSubmitted += 1;
                    void session.submitPrompt(promptId, text);
                    return;
                }
                if (msg?.type === 'permission_response') {
                    const sessionId = String(msg.sessionId || '');
                    const requestId = String(msg.requestId || '');
                    const optionId = typeof msg.optionId === 'string' ? msg.optionId : undefined;
                    const cancelled = msg.cancelled === true;
                    const session = sessions.get(sessionId);
                    if (!session || !requestId)
                        return;
                    session.resolvePermission(requestId, optionId, cancelled);
                    return;
                }
                if (msg?.type === 'cancel_session_prompt') {
                    const sessionId = String(msg.sessionId || '');
                    const session = sessions.get(sessionId);
                    if (!session) {
                        send({
                            type: 'prompt_result',
                            sessionId,
                            ok: false,
                            error: 'session not found',
                            ts: Date.now(),
                        });
                        return;
                    }
                    try {
                        await session.cancelPrompt();
                    }
                    catch (error) {
                        send({
                            type: 'prompt_result',
                            sessionId,
                            ok: false,
                            error: error?.message || String(error),
                            ts: Date.now(),
                        });
                    }
                    return;
                }
                if (msg?.type === 'stop_session') {
                    const sessionId = String(msg.sessionId || '');
                    const session = sessions.get(sessionId);
                    if (!session) {
                        send({
                            type: 'stop_session_result',
                            ok: false,
                            sessionId,
                            error: 'session not found',
                            ts: Date.now(),
                        });
                        return;
                    }
                    await session.stop();
                    sessions.delete(sessionId);
                    send({
                        type: 'stop_session_result',
                        ok: true,
                        sessionId,
                        ts: Date.now(),
                    });
                    return;
                }
            });
            await new Promise((resolve) => {
                ws.once('close', () => resolve());
            });
            logWarn('ws closed; will reconnect');
        }
        catch (e) {
            logWarn('connect loop error', e?.message || e);
        }
        finally {
            activeWs = null;
        }
        if (closeCode === 1008) {
            logError('unauthorized — token revoked, re-enroll needed');
            await stopAllSessions();
            process.exit(1);
        }
        const backoff = Math.min(15000, 500 + attempt * 500);
        await sleep(backoff);
    }
}
await connectLoop();
