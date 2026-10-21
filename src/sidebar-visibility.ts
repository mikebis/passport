import { errorMessage } from './types';

export const SIDEBAR_STORAGE_KEY = 'passport:sidebar:v1';
export interface SidebarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class SidebarPreference {
  visible = true;
  warning: string | undefined;
  private storage: SidebarStorage | undefined;

  constructor(accessStorage: () => SidebarStorage) {
    try {
      this.storage = accessStorage();
      const saved = this.storage.getItem(SIDEBAR_STORAGE_KEY);
      if (saved === 'hidden') this.visible = false;
      else if (saved !== null && saved !== 'shown') {
        this.warning = 'The saved sidebar preference is not recognized. Showing the sidebar; your saved preference has not been changed.';
      }
    } catch (error) {
      this.warning = `Could not read your sidebar preference. Showing the sidebar for now. ${errorMessage(error)}`;
    }
  }

  choose(visible: boolean): void {
    this.visible = visible;
    try {
      if (!this.storage) throw new Error('Browser storage is unavailable.');
      this.storage.setItem(SIDEBAR_STORAGE_KEY, visible ? 'shown' : 'hidden');
      this.warning = undefined;
    } catch (error) {
      this.warning = `Sidebar visibility changed for this session but could not be remembered. ${errorMessage(error)}`;
    }
  }
}
