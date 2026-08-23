import Store from 'electron-store';

interface SettingsSchema {
  'fileOps.lastRenamePattern': string;
  'fileOps.confirmBeforeDelete': boolean;
  'theme.mode': 'dark' | 'light' | 'system';
  'theme.accentColor': string;
  'performance.lowEffectsMode': boolean;
}

const DEFAULTS: SettingsSchema = {
  'fileOps.lastRenamePattern': '{name}_{counter}',
  'fileOps.confirmBeforeDelete': true,
  'theme.mode': 'dark',
  'theme.accentColor': '#7c6ef0',
  'performance.lowEffectsMode': false,
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
