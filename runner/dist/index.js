import os from 'node:os';
import { WebSocket } from 'ws';
import { loadIdentity, saveIdentity } from './state.js';
const GATEWAY_HTTP = process.env.AGENTMESH_GATEWAY_HTTP || 'http://127.0.0.1:8787';
const GATEWAY_WS = process.env.AGENTMESH_GATEWAY_WS || GATEWAY_HTTP.replace(/^http/, 'ws');
const RUNNER_NAME = process.env.AGENTMESH_RUNNER_NAME || os.hostname();
const ID_FILE = process.env.AGENTMESH_RUNNER_ID_FILE || new URL('../data/identity.json', import.meta.url).pathname;
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function registerRunner() {
    const res = await fetch(`${GATEWAY_HTTP}/api/runners/register`, {
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
function detectCapabilities() {
    // Keep it simple for Prototype 0.
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
    return registerRunner();
}
async function connectLoop() {
    let attempt = 0;
    while (true) {
        attempt += 1;
        try {
            const id = await ensureIdentity();
            const wsUrl = `${GATEWAY_WS}/ws/runner?runnerId=${encodeURIComponent(id.runnerId)}&token=${encodeURIComponent(id.runnerToken)}`;
            console.log(`[runner] connecting ws ${wsUrl}`);
            const ws = new WebSocket(wsUrl);
            await new Promise((resolve, reject) => {
                const onOpen = () => resolve();
                const onErr = (e) => reject(e);
                ws.once('open', onOpen);
                ws.once('error', onErr);
            });
            attempt = 0;
            console.log('[runner] ws connected');
            ws.send(JSON.stringify({ type: 'capabilities', capabilities: detectCapabilities(), ts: Date.now() }));
            ws.on('message', (buf) => {
                const raw = buf.toString();
                try {
                    const msg = JSON.parse(raw);
                    if (msg?.type === 'hello') {
                        console.log(`[runner] hello from gateway runnerId=${msg.runnerId}`);
                        return;
                    }
                    console.log('[runner] msg', msg);
                }
                catch {
                    console.log('[runner] msg(raw)', raw.slice(0, 2000));
                }
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
