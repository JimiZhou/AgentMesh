import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { nanoid } from 'nanoid';
import { JsonStore } from './store.js';

const PORT = Number(process.env.AGENTMESH_PORT || 8787);
const HOST = process.env.AGENTMESH_HOST || '127.0.0.1';
const DATA_FILE = process.env.AGENTMESH_DATA_FILE || new URL('../data/state.json', import.meta.url).pathname;

const app = Fastify({ logger: true });
await app.register(websocket);

const store = new JsonStore(DATA_FILE);

app.get('/health', async () => ({ ok: true, name: 'agentmesh-gateway', ts: Date.now() }));

app.post('/api/runners/register', async (req, reply) => {
  const body = (req.body || {}) as any;
  const id = nanoid(12);
  const token = nanoid(32);

  store.patch((s) => {
    s.runners[id] = {
      id,
      name: typeof body.name === 'string' ? body.name : undefined,
      createdAt: Date.now(),
      token,
      capabilities: body.capabilities || undefined,
      lastSeenAt: Date.now(),
    };
  });

  reply.send({ ok: true, runnerId: id, runnerToken: token, wsUrl: `/ws/runner?runnerId=${id}&token=${token}` });
});

app.get('/api/runners', async () => {
  const s = store.get();
  return { ok: true, runners: Object.values(s.runners).map(({ token, ...rest }) => rest) };
});

app.post('/api/projects', async (req) => {
  const body = (req.body || {}) as any;
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled';
  const id = nanoid(12);

  store.patch((s) => {
    s.projects[id] = {
      id,
      name,
      createdAt: Date.now(),
      runnerId: typeof body.runnerId === 'string' ? body.runnerId : undefined,
      path: typeof body.path === 'string' ? body.path : undefined,
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
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const runnerId = url.searchParams.get('runnerId') || '';
  const token = url.searchParams.get('token') || '';

  const runner = store.get().runners[runnerId];
  if (!runner || runner.token !== token) {
    conn.socket.close(1008, 'unauthorized');
    return;
  }

  store.patch((s) => {
    if (s.runners[runnerId]) s.runners[runnerId].lastSeenAt = Date.now();
  });

  conn.socket.send(JSON.stringify({ type: 'hello', runnerId, ts: Date.now() }));

  conn.socket.on('message', (buf: any) => {
    try {
      const msg = JSON.parse(buf.toString());
      if (msg?.type === 'capabilities') {
        store.patch((s) => {
          if (s.runners[runnerId]) {
            s.runners[runnerId].capabilities = msg.capabilities;
            s.runners[runnerId].lastSeenAt = Date.now();
          }
        });
      }
    } catch {
      // ignore
    }
  });
});

// Placeholder: create session (runner not implemented yet)
app.post('/api/sessions', async (req, reply) => {
  const body = (req.body || {}) as any;
  const runnerId = String(body.runnerId || '');
  const projectId = String(body.projectId || '');
  const tool = String(body.tool || '');

  if (!runnerId || !projectId || !tool) {
    reply.code(400);
    return { ok: false, error: 'runnerId, projectId, tool are required' };
  }

  const id = nanoid(12);
  store.patch((s) => {
    s.sessions[id] = { id, createdAt: Date.now(), runnerId, projectId, tool, status: 'created' };
  });

  return { ok: true, sessionId: id, status: 'created' };
});

app.get('/api/sessions', async () => {
  const s = store.get();
  return { ok: true, sessions: Object.values(s.sessions) };
});

await app.listen({ port: PORT, host: HOST });
