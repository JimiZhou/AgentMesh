import fs from 'node:fs';
import path from 'node:path';
const DEFAULT_STATE = { runners: {}, projects: {}, sessions: {} };
export class JsonStore {
    filePath;
    state;
    constructor(filePath) {
        this.filePath = filePath;
        this.state = this.load();
    }
    load() {
        try {
            const raw = fs.readFileSync(this.filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_STATE, ...parsed };
        }
        catch {
            return { ...DEFAULT_STATE };
        }
    }
    save() {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), { mode: 0o600 });
        try {
            fs.chmodSync(this.filePath, 0o600);
        }
        catch {
            // ignore chmod errors on non-posix filesystems
        }
    }
    get() {
        return this.state;
    }
    set(next) {
        this.state = next;
        this.save();
    }
    patch(mutator) {
        mutator(this.state);
        this.save();
        return this.state;
    }
}
