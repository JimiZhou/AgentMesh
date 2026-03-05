import { loadConfig, saveConfig, type GatewayConfig } from './config.js';

export function updateConfig(filePath: string, mutator: (cfg: GatewayConfig) => void): GatewayConfig {
  const cfg = loadConfig(filePath);
  mutator(cfg);
  saveConfig(filePath, cfg);
  return cfg;
}
