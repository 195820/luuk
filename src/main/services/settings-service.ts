import Store from 'electron-store';
import type { SearchCriteria } from '../../types';

interface SearchPreset {
  id: string;
  name: string;
  criteria: SearchCriteria;
  createdAt: string;
}

interface SettingsSchema {
  'fileOps.lastRenamePattern': string;
  'fileOps.confirmBeforeDelete': boolean;
  'theme.enabled': boolean;
  'theme.mode': 'dark' | 'light' | 'system';
  'theme.accentColor': string;
  'performance.lowEffectsMode': boolean;
  'cache.maxMemoryMB': number;
  'search.history': string[];
  'search.presets': SearchPreset[];
  // Phase 8 — Feature Flags
  'plugins.enabled': boolean;
  'ai.enabled': boolean;
  'crawler.enabled': boolean;
  'models.directory': string;
  // Phase 9 — Agent 体系
  'agent.enabled': boolean;
  'agent.intervalMs': number;
  // Phase 9 M2 — Jev 云端决策（可选增强，默认关闭；Key 仅主进程读取，不下发渲染进程）
  'jev.enabled': boolean;
  'jev.apiKey': string;
}

const DEFAULTS: SettingsSchema = {
  'fileOps.lastRenamePattern': '{name}_{counter}',
  'fileOps.confirmBeforeDelete': true,
  'theme.enabled': false,
  'theme.mode': 'dark',
  'theme.accentColor': '#7c6ef0',
  'performance.lowEffectsMode': false,
  'cache.maxMemoryMB': 200,
  'search.history': [],
  'search.presets': [],
  // Phase 8 — Feature Flags（默认全部关闭）
  'plugins.enabled': false,
  'ai.enabled': false,
  'crawler.enabled': false,
  'models.directory': '',
  // Phase 9 — Agent 体系（默认关闭；定时间隔 6 小时）
  'agent.enabled': false,
  'agent.intervalMs': 6 * 60 * 60 * 1000,
  // Phase 9 M2 — Jev（默认关闭 + 无 Key：全链路零网络请求）
  'jev.enabled': false,
  'jev.apiKey': '',
};

let instance: Store<SettingsSchema> | null = null;

export function getSettingsStore(): Store<SettingsSchema> {
  if (!instance) {
    instance = new Store<SettingsSchema>({ name: 'settings', defaults: DEFAULTS });
  }
  return instance;
}

export function getSetting<K extends keyof SettingsSchema>(key: K): SettingsSchema[K] {
  return getSettingsStore().get(key);
}

export function setSetting<K extends keyof SettingsSchema>(key: K, value: SettingsSchema[K]): void {
  getSettingsStore().set(key, value);
}
