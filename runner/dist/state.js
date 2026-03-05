import fs from 'node:fs';
import path from 'node:path';
export function loadIdentity(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const j = JSON.parse(raw);
        if (j &&
            typeof j.runnerId === 'string' &&
            j.runnerId.trim() &&
            typeof j.runnerToken === 'string' &&
            j.runnerToken.trim()) {
            return {
                runnerId: j.runnerId.trim(),
                runnerToken: j.runnerToken.trim(),
                createdAt: Number(j.createdAt || Date.now()),
            };
        }
        return null;
    }
    catch {
        return null;
    }
}
export function saveIdentity(filePath, id) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(id, null, 2), { mode: 0o600 });
    try {
        fs.chmodSync(filePath, 0o600);
    }
    catch {
        // ignore chmod errors on non-posix filesystems
    }
}
