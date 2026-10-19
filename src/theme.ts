import { errorMessage } from './types';
import { findTheme, THEMES, type Theme } from './themes';

export const THEME_STORAGE_KEY = 'passport:theme:v1';
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class ThemePreference {
  current: Theme = THEMES[0];
  warning: string | undefined;
  private storage: ThemeStorage | undefined;

  constructor(accessStorage: () => ThemeStorage) {
    try {
      this.storage = accessStorage();
      const saved = this.storage.getItem(THEME_STORAGE_KEY);
      if (saved !== null) {
        const theme = findTheme(saved);
        if (theme) this.current = theme;
        else this.warning = 'The saved theme is not available. Using Classic; your saved preference has not been changed.';
      }
    } catch (error) {
      this.warning = `Could not read your theme preference. Using Classic for now. ${errorMessage(error)}`;
    }
  }

  choose(id: string): void {
    const theme = findTheme(id);
    if (!theme) throw new Error(`Unknown theme: ${id}`);
    this.current = theme;
    try {
      if (!this.storage) throw new Error('Browser storage is unavailable.');
      this.storage.setItem(THEME_STORAGE_KEY, id);
      this.warning = undefined;
    } catch (error) {
      this.warning = `Theme changed for this session but could not be remembered. ${errorMessage(error)}`;
    }
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme.id;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--ocean').trim();
}
