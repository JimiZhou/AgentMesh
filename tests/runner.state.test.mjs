import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const stateModuleUrl = new URL('../runner/dist/state.js', import.meta.url);
const { loadIdentity, saveIdentity } = await import(stateModuleUrl);

test('runner saveIdentity writes secure json and loadIdentity trims values', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agentmesh-runner-state-test-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const identityFile = join(root, 'identity.json');
  saveIdentity(identityFile, {
    runnerId: ' runner-1 ',
    runnerToken: ' token-1 ',
    createdAt: 123,
  });

  const raw = await readFile(identityFile, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.runnerId, ' runner-1 ');
  assert.equal(parsed.runnerToken, ' token-1 ');

  const loaded = loadIdentity(identityFile);
  assert.deepEqual(loaded, {
    runnerId: 'runner-1',
    runnerToken: 'token-1',
    createdAt: 123,
  });

  const st = await stat(identityFile);
  const mode = st.mode & 0o777;
  assert.equal(mode, 0o600);
});

test('runner loadIdentity rejects malformed or empty identity', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agentmesh-runner-state-test-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const identityFile = join(root, 'identity.json');
  await writeFile(identityFile, JSON.stringify({ runnerId: 'ok', runnerToken: '   ', createdAt: 1 }, null, 2));
  const loaded = loadIdentity(identityFile);
  assert.equal(loaded, null);
});
