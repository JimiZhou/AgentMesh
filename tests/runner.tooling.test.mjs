import assert from 'node:assert/strict';
import test from 'node:test';

const toolingModuleUrl = new URL('../runner/dist/tooling.js', import.meta.url);
const {
  detectToolCapabilities,
  extractPrimaryCommand,
  resolveToolAvailability,
  resolveToolCommands,
} = await import(toolingModuleUrl);

test('runner tooling resolves gemini to npx fallback when gemini binary is missing', () => {
  const env = {};
  const exists = (cmd) => cmd === 'npx';
  const commands = resolveToolCommands(env, exists);

  assert.equal(commands.gemini.command, 'npx -y @google/gemini-cli --experimental-acp');
  assert.equal(commands.gemini.source, 'fallback');
  assert.match(String(commands.gemini.note || ''), /acp mode/i);
});

test('runner tooling respects AGENTMESH_*_CMD overrides', () => {
  const env = {
    AGENTMESH_CODEX_CMD: 'codex --quiet',
    AGENTMESH_CLAUDE_CMD: 'claude --dangerously-skip-permissions',
    AGENTMESH_GEMINI_CMD: 'bunx @google/gemini-cli',
  };
  const commands = resolveToolCommands(env, () => false);

  assert.equal(commands.codex.command, 'codex --quiet');
  assert.equal(commands.codex.source, 'env');
  assert.equal(commands.claude.command, 'claude --dangerously-skip-permissions');
  assert.equal(commands.claude.source, 'env');
  assert.equal(commands.gemini.command, 'bunx @google/gemini-cli');
  assert.equal(commands.gemini.source, 'env');
});

test('runner tooling force enable/disable flags override command existence checks', () => {
  const forcedDisable = resolveToolAvailability(
    'gemini',
    'gemini',
    { AGENTMESH_TOOL_GEMINI: '0' },
    () => true,
  );
  assert.equal(forcedDisable.available, false);
  assert.match(String(forcedDisable.reason || ''), /forced disabled/i);

  const forcedEnable = resolveToolAvailability(
    'gemini',
    'gemini',
    { AGENTMESH_TOOL_GEMINI: '1' },
    () => false,
  );
  assert.equal(forcedEnable.available, true);
  assert.match(String(forcedEnable.reason || ''), /forced enabled/i);
});

test('runner tooling detection carries override reason into tool details', () => {
  const commands = {
    codex: { command: 'codex', source: 'default' },
    claude: { command: 'claude', source: 'default' },
    gemini: { command: 'gemini', source: 'default' },
  };
  const detected = detectToolCapabilities(commands, { AGENTMESH_TOOL_GEMINI: '0' }, () => true);

  assert.equal(detected.tools.gemini, false);
  assert.match(String(detected.toolDetails.gemini.reason || ''), /forced disabled/i);
  assert.equal(detected.unsupported.length, 1);
  assert.equal(detected.unsupported[0].tool, 'gemini');
});

test('runner tooling keeps ACP tools enabled without any PTY backend dependency', () => {
  const commands = {
    codex: { command: 'codex-acp', source: 'default', protocol: 'acp' },
    claude: { command: 'claude-agent-acp', source: 'default', protocol: 'acp' },
    gemini: { command: 'gemini --experimental-acp', source: 'default', protocol: 'acp' },
  };
  const detected = detectToolCapabilities(commands, {}, () => true);

  assert.equal(detected.tools.codex, true);
  assert.equal(detected.tools.claude, true);
  assert.equal(detected.tools.gemini, true);
  assert.equal(detected.unsupported.length, 0);
});

test('runner tooling extracts command executable token from command strings with env and args', () => {
  assert.equal(extractPrimaryCommand('NODE_ENV=test npx -y @google/gemini-cli'), 'npx');
  assert.equal(extractPrimaryCommand('"gemini" -p "hello world"'), 'gemini');
  assert.equal(extractPrimaryCommand("PATH='/usr/bin' claude --resume 123"), 'claude');
});
