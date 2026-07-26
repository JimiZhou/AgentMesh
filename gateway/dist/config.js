import fs from 'node:fs';
import path from 'node:path';
export const DEFAULT_CONFIG = {
    web: {
        user: 'admin',
        passwordHash: '',
        password: '',
        sessionTtlMs: 12 * 60 * 60 * 1000,
        totp: {
            issuer: 'AgentMesh',
            secretBase32: '',
            enabled: true,
            provisioned: false,
        },
        allowedOrigins: [],
    },
    enroll: {
        tokenTtlMs: 10 * 60 * 1000,
    },
    publicUrls: {
        http: '',
        ws: '',
    },
};
function deepMerge(base, patch) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    if (!patch || typeof patch !== 'object')
        return out;
    for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
            out[k] = deepMerge(base[k], v);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
function backupCorruptFile(filePath, err) {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    try {
        fs.copyFileSync(filePath, backupPath);
    }
    catch {
        // best effort backup
    }
    console.error(`[agentmesh] FAILED to load config at ${filePath}: ${err?.message || err}. ` +
        `Corrupt file backed up to ${backupPath}; falling back to defaults.`);
}
export function loadConfig(filePath) {
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    }
    catch (err) {
        if (err?.code !== 'ENOENT')
            backupCorruptFile(filePath, err);
        return { ...DEFAULT_CONFIG };
    }
    try {
        const parsed = JSON.parse(raw);
        return deepMerge(DEFAULT_CONFIG, parsed);
    }
    catch (err) {
        backupCorruptFile(filePath, err);
        return { ...DEFAULT_CONFIG };
    }
}
export function saveConfig(filePath, cfg) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    try {
        fs.chmodSync(tmpPath, 0o600);
    }
    catch {
        // ignore chmod errors on non-posix filesystems
    }
    fs.renameSync(tmpPath, filePath);
}
