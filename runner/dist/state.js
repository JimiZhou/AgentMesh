import fs from 'node:fs';
import path from 'node:path';
export function loadIdentity(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const j = JSON.parse(raw);
        if (j && typeof j.runnerId === 'string' && typeof j.runnerToken === 'string')
            return j;
        return null;
    }
    catch {
        return null;
    }
}
export function saveIdentity(filePath, id) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(id, null, 2));
}
