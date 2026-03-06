import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const GATEWAY_ENTRY = join(REPO_ROOT, 'gateway', 'dist', 'index.js');

async function getFreePort() {
  return await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('failed to allocate free port'));
        return;
      }
      const port = addr.port;
      server.close((err) => {
        if (err) reject(err);
        else resolvePort(port);
      });
    });
    server.on('error', reject);
  });
}

function parseCookie(setCookieHeader) {
  if (!setCookieHeader) return '';
  const [first] = String(setCookieHeader).split(';');
  return first || '';
}

async function waitForHealth(baseUrl, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await delay(100);
  }
  throw new Error(`gateway did not become healthy within ${timeoutMs}ms`);
}

async function startGateway({
  bootstrapPassword = 'IntegrationPassw0rd!!',
  configPayload,
  includeBootstrapPassword = true,
  statePayload,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'agentmesh-gateway-test-'));
  const configFile = join(root, 'config.json');
  const stateFile = join(root, 'state.json');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const defaultConfig = {
    web: {
      user: 'admin',
      passwordHash: '',
      sessionTtlMs: 60 * 60 * 1000,
      totp: {
        issuer: 'AgentMesh',
        secretBase32: '',
        enabled: true,
        provisioned: false,
      },
      allowedOrigins: [],
    },
    enroll: { tokenTtlMs: 10 * 60 * 1000 },
    publicUrls: { http: '', ws: '' },
  };

  await writeFile(configFile, JSON.stringify(configPayload || defaultConfig, null, 2));
  const defaultState = { runners: {}, projects: {}, sessions: {} };
  await writeFile(stateFile, JSON.stringify(statePayload || defaultState, null, 2));

  const env = {
    ...process.env,
    AGENTMESH_PORT: String(port),
    AGENTMESH_HOST: '127.0.0.1',
    AGENTMESH_CONFIG_FILE: configFile,
    AGENTMESH_DATA_FILE: stateFile,
    AGENTMESH_TRUST_PROXY: 'false',
  };
  if (includeBootstrapPassword) {
    env.AGENTMESH_BOOTSTRAP_PASSWORD = bootstrapPassword;
  } else {
    delete env.AGENTMESH_BOOTSTRAP_PASSWORD;
  }

  const child = spawn('node', [GATEWAY_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  return {
    root,
    configFile,
    stateFile,
    baseUrl,
    child,
    bootstrapPassword,
    async waitUntilReady() {
      await waitForHealth(baseUrl);
    },
    async stop() {
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([
          new Promise((resolveExit) => child.once('exit', () => resolveExit())),
          delay(3000).then(() => {
            if (!child.killed && child.exitCode === null) child.kill('SIGKILL');
          }),
        ]);
      }
      await rm(root, { recursive: true, force: true });
    },
    getLogs() {
      return { stdout, stderr };
    },
  };
}

test('gateway setup endpoints require auth and csrf', async (t) => {
  const gateway = await startGateway();
  t.after(async () => {
    await gateway.stop();
  });
  await gateway.waitUntilReady();

  const unauthSetup = await fetch(`${gateway.baseUrl}/setup`);
  assert.equal(unauthSetup.status, 401);

  const loginRes = await fetch(`${gateway.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: gateway.bootstrapPassword,
    }),
  });
  assert.equal(loginRes.status, 200);
  const loginBody = await loginRes.json();
  assert.equal(loginBody.ok, true);
  assert.equal(loginBody.authenticated, true);
  assert.equal(typeof loginBody.csrfToken, 'string');
  assert.ok(loginBody.csrfToken.length > 10);

  const cookie = parseCookie(loginRes.headers.get('set-cookie'));
  assert.ok(cookie.includes('agentmesh_sid='));

  const setupRes = await fetch(`${gateway.baseUrl}/setup`, {
    headers: { cookie },
  });
  assert.equal(setupRes.status, 200);
  const setupHtml = await setupRes.text();
  assert.match(setupHtml, /初始化两步验证/);

  const confirmNoCsrf = await fetch(`${gateway.baseUrl}/setup/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie,
    },
    body: JSON.stringify({ totp: '123456' }),
  });
  assert.equal(confirmNoCsrf.status, 403);
  const noCsrfBody = await confirmNoCsrf.json();
  assert.equal(noCsrfBody.error, 'csrf mismatch');
});

test('gateway enforces hashed-password bootstrap when no hash configured', async () => {
  const gateway = await startGateway({
    includeBootstrapPassword: false,
    configPayload: {
      web: {
        user: 'admin',
        passwordHash: '',
        password: '',
        sessionTtlMs: 60 * 60 * 1000,
        totp: { issuer: 'AgentMesh', secretBase32: '', enabled: true, provisioned: false },
        allowedOrigins: [],
      },
      enroll: { tokenTtlMs: 10 * 60 * 1000 },
      publicUrls: { http: '', ws: '' },
    },
  });
  try {
    const exitCode = await Promise.race([
      new Promise((resolveExit) => gateway.child.once('exit', (code) => resolveExit(code))),
      delay(6_000).then(() => 'timeout'),
    ]);
    assert.notEqual(exitCode, 'timeout');
    assert.notEqual(exitCode, 0);
    const logs = gateway.getLogs();
    assert.match(`${logs.stdout}\n${logs.stderr}`, /missing gateway password hash configuration/i);
  } finally {
    await gateway.stop();
  }
});

test('gateway returns 401 for unauthenticated sessions list and sets security headers', async (t) => {
  const gateway = await startGateway();
  t.after(async () => {
    await gateway.stop();
  });
  await gateway.waitUntilReady();

  const sessionsRes = await fetch(`${gateway.baseUrl}/api/sessions`);
  assert.equal(sessionsRes.status, 401);
  const sessionsBody = await sessionsRes.json();
  assert.equal(sessionsBody.ok, false);
  assert.equal(sessionsBody.error, 'unauthorized');

  const healthRes = await fetch(`${gateway.baseUrl}/health`);
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
  assert.ok(String(healthRes.headers.get('content-security-policy') || '').includes("default-src 'self'"));
});

test('gateway migrates legacy plaintext password to hash on startup', async (t) => {
  const legacyPassword = 'LegacyPassword!234';
  const gateway = await startGateway({
    includeBootstrapPassword: false,
    configPayload: {
      web: {
        user: 'admin',
        passwordHash: '',
        password: legacyPassword,
        sessionTtlMs: 60 * 60 * 1000,
        totp: { issuer: 'AgentMesh', secretBase32: '', enabled: true, provisioned: false },
        allowedOrigins: [],
      },
      enroll: { tokenTtlMs: 10 * 60 * 1000 },
      publicUrls: { http: '', ws: '' },
    },
  });
  t.after(async () => {
    await gateway.stop();
  });
  await gateway.waitUntilReady();

  const migratedRaw = await readFile(gateway.configFile, 'utf8');
  const migrated = JSON.parse(migratedRaw);
  assert.equal(typeof migrated.web.passwordHash, 'string');
  assert.ok(migrated.web.passwordHash.startsWith('scrypt$'));
  assert.equal('password' in migrated.web, false);

  const loginRes = await fetch(`${gateway.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: legacyPassword,
    }),
  });
  assert.equal(loginRes.status, 200);
  const loginBody = await loginRes.json();
  assert.equal(loginBody.authenticated, true);
});

test('gateway rejects unsupported tools based on runner capabilities', async (t) => {
  const now = Date.now();
  const gateway = await startGateway({
    statePayload: {
      runners: {
        runnerA: {
          id: 'runnerA',
          name: 'runner-A',
          createdAt: now,
          token: 'runner-token',
          lastSeenAt: now,
          capabilities: {
            tools: {
              codex: true,
              claude: true,
              gemini: false,
            },
          },
        },
      },
      projects: {
        projectA: {
          id: 'projectA',
          name: 'project-A',
          createdAt: now,
          runnerId: 'runnerA',
          path: '/tmp/project-a',
        },
      },
      sessions: {},
    },
  });
  t.after(async () => {
    await gateway.stop();
  });
  await gateway.waitUntilReady();

  const loginRes = await fetch(`${gateway.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: gateway.bootstrapPassword,
    }),
  });
  assert.equal(loginRes.status, 200);
  const loginBody = await loginRes.json();
  assert.equal(loginBody.authenticated, true);
  const cookie = parseCookie(loginRes.headers.get('set-cookie'));

  const unsupportedRes = await fetch(`${gateway.baseUrl}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie,
      'X-AgentMesh-CSRF': loginBody.csrfToken,
    },
    body: JSON.stringify({
      projectId: 'projectA',
      tool: 'gemini',
    }),
  });
  assert.equal(unsupportedRes.status, 400);
  const unsupportedBody = await unsupportedRes.json();
  assert.equal(unsupportedBody.ok, false);
  assert.match(String(unsupportedBody.error || ''), /not supported/i);

  const supportedRes = await fetch(`${gateway.baseUrl}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie,
      'X-AgentMesh-CSRF': loginBody.csrfToken,
    },
    body: JSON.stringify({
      projectId: 'projectA',
      tool: 'codex',
    }),
  });
  assert.equal(supportedRes.status, 200);
  const supportedBody = await supportedRes.json();
  assert.equal(supportedBody.ok, true);
  assert.equal(typeof supportedBody.sessionId, 'string');
  assert.ok(supportedBody.sessionId.length > 5);
});
