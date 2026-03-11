import { loadConfig, saveConfig } from './config.js';
export function updateConfig(filePath, mutator) {
    const cfg = loadConfig(filePath);
    mutator(cfg);
    saveConfig(filePath, cfg);
    return cfg;
}
