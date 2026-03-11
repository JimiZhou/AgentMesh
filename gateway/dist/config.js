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
export function loadConfig(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return deepMerge(DEFAULT_CONFIG, parsed);
    }
    catch {
        return { ...DEFAULT_CONFIG };
    }
}
export function saveConfig(filePath, cfg) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    try {
        fs.chmodSync(filePath, 0o600);
    }
    catch {
        // ignore chmod errors on non-posix filesystems
    }
}
