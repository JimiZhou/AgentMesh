import { spawnSync } from 'node:child_process';
export const TOOL_ORDER = ['codex', 'claude', 'gemini'];
export function parseEnvToggle(raw) {
    if (typeof raw !== 'string')
        return null;
    const val = raw.trim().toLowerCase();
    if (!val)
        return null;
    if (val === '1' || val === 'true' || val === 'yes' || val === 'on')
        return true;
    if (val === '0' || val === 'false' || val === 'no' || val === 'off')
        return false;
    return null;
}
function shellQuoteSingle(raw) {
    return `'${String(raw || '').replace(/'/g, `'\\''`)}'`;
}
export function extractPrimaryCommand(rawCommand) {
    const raw = String(rawCommand || '').trim();
    if (!raw)
        return '';
    const tokens = [];
    let current = '';
    let quote = '';
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
    if (current)
        tokens.push(current);
    for (const token of tokens) {
        if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token))
            continue;
        return token;
    }
    return '';
}
export function commandExists(cmd) {
    const name = extractPrimaryCommand(cmd);
    if (!name)
        return false;
    if (process.platform === 'win32') {
        const res = spawnSync('where', [name], { stdio: 'ignore' });
        return res.status === 0;
    }
    const whichRes = spawnSync('which', [name], { stdio: 'ignore' });
    if (whichRes.status === 0)
        return true;
    const shRes = spawnSync('sh', ['-lc', `command -v ${shellQuoteSingle(name)} >/dev/null 2>&1`], {
        stdio: 'ignore',
    });
    return shRes.status === 0;
}
export function resolveToolAvailability(tool, command, env = process.env, commandExistsFn = commandExists) {
    const toggleKey = `AGENTMESH_TOOL_${tool.toUpperCase()}`;
    const override = parseEnvToggle(env[toggleKey]);
    if (override !== null) {
        return {
            available: override,
            reason: `forced ${override ? 'enabled' : 'disabled'} by ${toggleKey}`,
        };
    }
    if (commandExistsFn(command))
        return { available: true };
    const primary = extractPrimaryCommand(command) || String(command || '').trim() || '<empty>';
    return {
        available: false,
        reason: `command not found: ${primary}`,
    };
}
export function resolveToolCommands(env = process.env, commandExistsFn = commandExists) {
    const codexEnv = String(env.AGENTMESH_CODEX_CMD || '').trim();
    const claudeEnv = String(env.AGENTMESH_CLAUDE_CMD || '').trim();
    const geminiEnv = String(env.AGENTMESH_GEMINI_CMD || '').trim();
    const codex = codexEnv
        ? { command: codexEnv, source: 'env' }
        : { command: 'codex', source: 'default' };
    const claude = claudeEnv
        ? { command: claudeEnv, source: 'env' }
        : { command: 'claude', source: 'default' };
    let gemini;
    if (geminiEnv) {
        gemini = { command: geminiEnv, source: 'env' };
    }
    else if (commandExistsFn('gemini')) {
        gemini = { command: 'gemini', source: 'default' };
    }
    else if (commandExistsFn('npx')) {
        gemini = {
            command: 'npx -y @google/gemini-cli',
            source: 'fallback',
            note: 'gemini binary not found; using npx @google/gemini-cli fallback',
        };
    }
    else {
        gemini = {
            command: 'gemini',
            source: 'default',
            note: 'gemini binary not found and npx is unavailable',
        };
    }
    return { codex, claude, gemini };
}
export function supportedToolsFrom(availability) {
    const out = new Set();
    for (const tool of TOOL_ORDER) {
        if (availability[tool])
            out.add(tool);
    }
    return out;
}
export function applySessionBackendConstraints(detected, requirements) {
    if (requirements.tmuxAvailable)
        return detected;
    const tools = { ...detected.tools };
    const toolDetails = { ...detected.toolDetails };
    for (const tool of TOOL_ORDER) {
        tools[tool] = false;
        const detail = toolDetails[tool];
        const baseReason = detail.reason ? `${detail.reason}; ` : '';
        toolDetails[tool] = {
            ...detail,
            available: false,
            reason: `${baseReason}tmux is required on the runner host`,
        };
    }
    const unsupported = TOOL_ORDER.map((tool) => ({
        tool,
        source: toolDetails[tool].source,
        command: toolDetails[tool].command,
        reason: toolDetails[tool].reason || 'unavailable',
    }));
    return {
        tools,
        toolDetails,
        unsupported,
    };
}
export function detectToolCapabilities(toolCommands, env = process.env, commandExistsFn = commandExists) {
    const tools = {};
    const toolDetails = {};
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
