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
        let raw;
        try {
            raw = fs.readFileSync(this.filePath, 'utf-8');
        }
        catch (err) {
            if (err?.code !== 'ENOENT')
                this.backupCorruptFile(err);
            return { ...DEFAULT_STATE };
        }
        try {
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_STATE, ...parsed };
        }
        catch (err) {
            this.backupCorruptFile(err);
            return { ...DEFAULT_STATE };
        }
    }
    backupCorruptFile(err) {
        const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
        try {
            fs.copyFileSync(this.filePath, backupPath);
        }
        catch {
            // best effort backup
        }
        console.error(`[agentmesh] FAILED to load state at ${this.filePath}: ${err?.message || err}. ` +
            `Corrupt file backed up to ${backupPath}; falling back to empty state.`);
    }
    save() {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const tmpPath = `${this.filePath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), { mode: 0o600 });
        try {
            fs.chmodSync(tmpPath, 0o600);
        }
        catch {
            // ignore chmod errors on non-posix filesystems
        }
        fs.renameSync(tmpPath, this.filePath);
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
