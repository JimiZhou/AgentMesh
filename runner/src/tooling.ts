import { spawnSync } from 'node:child_process';

export const TOOL_ORDER = ['codex', 'claude', 'gemini'] as const;

export type ToolName = (typeof TOOL_ORDER)[number];
export type ToolAvailability = Record<ToolName, boolean>;
export type ToolCommandSource = 'env' | 'default' | 'fallback';
export type ToolCommandSpec = {
  command: string;
  source: ToolCommandSource;
  note?: string;
};
export type ToolCommandMap = Record<ToolName, ToolCommandSpec>;
export type ToolCapabilityDetail = {
  command: string;
  source: ToolCommandSource;
  available: boolean;
  reason?: string;
};
export type ToolCapabilityDetails = Record<ToolName, ToolCapabilityDetail>;
export type ToolAvailabilityResult = { available: boolean; reason?: string };
export type ToolDetectionResult = {
  tools: ToolAvailability;
  toolDetails: ToolCapabilityDetails;
  unsupported: Array<{
    tool: ToolName;
    source: ToolCommandSource;
    command: string;
    reason: string;
  }>;
};

export type CommandExistsFn = (cmd: string) => boolean;

export function parseEnvToggle(raw: string | undefined): boolean | null {
  if (typeof raw !== 'string') return null;
  const val = raw.trim().toLowerCase();
  if (!val) return null;
  if (val === '1' || val === 'true' || val === 'yes' || val === 'on') return true;
  if (val === '0' || val === 'false' || val === 'no' || val === 'off') return false;
  return null;
}

function shellQuoteSingle(raw: string): string {
  return `'${String(raw || '').replace(/'/g, `'\\''`)}'`;
}

export function extractPrimaryCommand(rawCommand: string): string {
  const raw = String(rawCommand || '').trim();
  if (!raw) return '';

  const tokens: string[] = [];
  let current = '';
  let quote: '' | '"' | "'" = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) {
        quote = '';
        continue;
      }
      if (quote === '"' && ch === '\\' && i + 1 < raw.length) {
        i += 1;
        current += raw[i];
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    if (ch === '\\' && i + 1 < raw.length) {
      i += 1;
      current += raw[i];
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);

  for (const token of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) continue;
    return token;
  }
  return '';
}

export function commandExists(cmd: string): boolean {
  const name = extractPrimaryCommand(cmd);
  if (!name) return false;
  if (process.platform === 'win32') {
    const res = spawnSync('where', [name], { stdio: 'ignore' });
    return res.status === 0;
  }
  const whichRes = spawnSync('which', [name], { stdio: 'ignore' });
  if (whichRes.status === 0) return true;
  const shRes = spawnSync('sh', ['-lc', `command -v ${shellQuoteSingle(name)} >/dev/null 2>&1`], {
    stdio: 'ignore',
  });
  return shRes.status === 0;
}

export function resolveToolAvailability(
  tool: ToolName,
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  commandExistsFn: CommandExistsFn = commandExists,
): ToolAvailabilityResult {
  const toggleKey = `AGENTMESH_TOOL_${tool.toUpperCase()}`;
  const override = parseEnvToggle(env[toggleKey]);
  if (override !== null) {
    return {
      available: override,
      reason: `forced ${override ? 'enabled' : 'disabled'} by ${toggleKey}`,
    };
  }
  if (commandExistsFn(command)) return { available: true };
  const primary = extractPrimaryCommand(command) || String(command || '').trim() || '<empty>';
  return {
    available: false,
    reason: `command not found: ${primary}`,
  };
}

export function resolveToolCommands(
  env: NodeJS.ProcessEnv = process.env,
  commandExistsFn: CommandExistsFn = commandExists,
): ToolCommandMap {
  const codexEnv = String(env.AGENTMESH_CODEX_CMD || '').trim();
  const claudeEnv = String(env.AGENTMESH_CLAUDE_CMD || '').trim();
  const geminiEnv = String(env.AGENTMESH_GEMINI_CMD || '').trim();

  const codex: ToolCommandSpec = codexEnv
    ? { command: codexEnv, source: 'env' }
    : { command: 'codex', source: 'default' };
  const claude: ToolCommandSpec = claudeEnv
    ? { command: claudeEnv, source: 'env' }
    : { command: 'claude', source: 'default' };

  let gemini: ToolCommandSpec;
  if (geminiEnv) {
    gemini = { command: geminiEnv, source: 'env' };
  } else if (commandExistsFn('gemini')) {
    gemini = { command: 'gemini', source: 'default' };
  } else if (commandExistsFn('npx')) {
    gemini = {
      command: 'npx -y @google/gemini-cli',
      source: 'fallback',
      note: 'gemini binary not found; using npx @google/gemini-cli fallback',
    };
  } else {
    gemini = {
      command: 'gemini',
      source: 'default',
      note: 'gemini binary not found and npx is unavailable',
    };
  }

  return { codex, claude, gemini };
}

export function supportedToolsFrom(availability: ToolAvailability): Set<ToolName> {
  const out = new Set<ToolName>();
  for (const tool of TOOL_ORDER) {
    if (availability[tool]) out.add(tool);
  }
  return out;
}

export function detectToolCapabilities(
  toolCommands: ToolCommandMap,
  env: NodeJS.ProcessEnv = process.env,
  commandExistsFn: CommandExistsFn = commandExists,
): ToolDetectionResult {
  const tools = {} as ToolAvailability;
  const toolDetails = {} as ToolCapabilityDetails;
  for (const tool of TOOL_ORDER) {
    const commandSpec = toolCommands[tool];
    const availability = resolveToolAvailability(tool, commandSpec.command, env, commandExistsFn);
    toolDetails[tool] = {
      command: commandSpec.command,
      source: commandSpec.source,
      available: availability.available,
      reason: availability.reason || commandSpec.note,
    };
    tools[tool] = availability.available;
  }

  const unsupported = TOOL_ORDER.filter((name) => !tools[name]).map((name) => ({
    tool: name,
    source: toolDetails[name].source,
    command: toolDetails[name].command,
    reason: toolDetails[name].reason || 'unavailable',
  }));

  return {
    tools,
    toolDetails,
    unsupported,
  };
}
