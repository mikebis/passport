import { DEFAULT_PROJECTION, findProjection, type ProjectionId } from './projection';
import { errorMessage } from './types';

export const PROJECTION_STORAGE_KEY = 'passport:projection:v1';
export interface ProjectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface ProjectionSource {
  readonly current: ProjectionId;
  subscribe(listener: () => void): () => void;
}

export class ProjectionPreference implements ProjectionSource {
  current: ProjectionId = DEFAULT_PROJECTION;
  warning: string | undefined;
  private storage: ProjectionStorage | undefined;
  private listeners = new Set<() => void>();

  constructor(accessStorage: () => ProjectionStorage) {
    try {
      this.storage = accessStorage();
      const saved = this.storage.getItem(PROJECTION_STORAGE_KEY);
      if (saved !== null) {
        const projection = findProjection(saved);
        if (projection) this.current = projection.id;
        else this.warning = 'The saved projection is not available. Using Equal Earth; your saved preference has not been changed.';
      }
    } catch (error) {
      this.warning = `Could not read your projection preference. Using Equal Earth for now. ${errorMessage(error)}`;
    }
  }

  choose(id: string): void {
    const projection = findProjection(id);
    if (!projection) throw new Error(`Unknown projection: ${id}`);
    const changed = this.current !== projection.id;
    this.current = projection.id;
    try {
      if (!this.storage) throw new Error('Browser storage is unavailable.');
      this.storage.setItem(PROJECTION_STORAGE_KEY, projection.id);
      this.warning = undefined;
    } catch (error) {
      this.warning = `Projection changed for this session but could not be remembered. ${errorMessage(error)}`;
    }
    if (changed) for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
