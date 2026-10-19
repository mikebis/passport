import { errorMessage, STATUSES, type LocationEntry, type Territory, type TravelStatus } from './types';

export const STORAGE_KEY = 'passport:locations:v1';
export const LEGACY_STORAGE_KEY = 'visited:locations:v1';
export type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type SaveResult = { saved: false; warning: string } | { saved: true; cleanupWarning?: string };

function saveData(storage: StorageAccess | undefined, text: string): SaveResult {
  try {
    if (!storage) throw new Error('Browser storage is unavailable.');
    storage.setItem(STORAGE_KEY, text);
  } catch (error) {
    return { saved: false, warning: `Your changes are not saved in passport browser storage. Export a backup before closing this tab. ${errorMessage(error)}` };
  }
  try {
    storage.removeItem(LEGACY_STORAGE_KEY);
  } catch (error) {
    return { saved: true, cleanupWarning: `Your data is saved in passport, but the old browser storage entry could not be removed. Cleanup will be retried on your next save. ${errorMessage(error)}` };
  }
  return { saved: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month, 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= calendar.getUTCDate()
    && Number(parts[4]) < 24 && Number(parts[5]) < 60 && Number(parts[6]) < 60;
}

export function normalizeData(value: unknown, registry: readonly Territory[]): LocationEntry[] {
  if (!Array.isArray(value)) throw new Error('Expected a JSON array of location entries.');
  const known = new Map(registry.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  let count = 0;

  function validate(entry: unknown, alpha2?: string, depth = 0): LocationEntry {
    if (++count > 10000 || depth > 12) throw new Error('Data exceeds the supported size or nesting depth.');
    if (!isRecord(entry) || typeof entry.id !== 'string') throw new Error('Each location needs a string ID.');
    const id = entry.id;
    const country = alpha2 ? undefined : known.get(id);
    if (!alpha2 && !country) throw new Error(`Unknown territory ID: ${id}`);
    if (alpha2 && (!new RegExp(`^${alpha2}-[A-Z0-9]{1,3}$`).test(id))) {
      throw new Error(`Invalid subdivision ID ${id}; expected an ISO 3166-2 code under ${alpha2}.`);
    }
    if (seen.has(id)) throw new Error(`Duplicate location ID: ${id}`);
    seen.add(id);
    if (typeof entry.name !== 'string' || !entry.name.trim()
      || typeof entry.continent !== 'string' || !entry.continent.trim()) {
      throw new Error(`${id} needs a name and continent.`);
    }
    if (typeof entry.status !== 'string' || !STATUSES.includes(entry.status as TravelStatus)) {
      throw new Error(`Invalid travel status for ${id}.`);
    }
    if (entry.updatedAt !== undefined && !validTimestamp(entry.updatedAt)) {
      throw new Error(`Invalid ISO timestamp for ${id}.`);
    }
    if (entry.subdivisions !== undefined && !Array.isArray(entry.subdivisions)) {
      throw new Error(`Subdivisions for ${id} must be an array.`);
    }
    if (country?.kind === 'custom' && Array.isArray(entry.subdivisions) && entry.subdivisions.length) {
      throw new Error(`Subdivisions are not supported for additional territory ${id}.`);
    }
    const result: LocationEntry = {
      id, name: country?.name ?? entry.name, continent: country?.continent ?? entry.continent,
      status: entry.status as TravelStatus,
    };
    if (typeof entry.updatedAt === 'string') result.updatedAt = entry.updatedAt;
    if (Array.isArray(entry.subdivisions)) {
      result.subdivisions = entry.subdivisions.map((child: unknown) => validate(child, country?.alpha2 ?? alpha2, depth + 1));
    }
    return result;
  }

  const entries = new Map(value.map((item: unknown) => {
    const entry = validate(item);
    return [entry.id, entry];
  }));
  return [...registry].sort((a, b) => a.id.localeCompare(b.id)).map((country) => entries.get(country.id) ?? {
    id: country.id, name: country.name, continent: country.continent, status: 'unvisited',
  });
}

export function parseData(text: string, registry: readonly Territory[]): LocationEntry[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  return normalizeData(value, registry);
}

export interface InitialState {
  entries: LocationEntry[];
  warning?: string;
  cleanupWarning?: string;
  recovery?: { raw: string; message: string };
}

export async function loadInitialState(
  registry: readonly Territory[],
  storage: StorageAccess | undefined,
  committed: () => Promise<unknown>,
): Promise<InitialState> {
  let raw: string | null = null;
  let warning: string | undefined;
  let legacy = false;
  try {
    if (storage) {
      raw = storage.getItem(STORAGE_KEY);
      if (raw === null) {
        raw = storage.getItem(LEGACY_STORAGE_KEY);
        legacy = raw !== null;
      }
    } else warning = 'Browser storage is unavailable. Changes will only last in this tab; export to keep them.';
  } catch (error) {
    warning = `Browser storage could not be read. Export to keep your changes. ${errorMessage(error)}`;
  }
  if (raw !== null) {
    let entries: LocationEntry[];
    try {
      entries = parseData(raw, registry);
    } catch (error) {
      const entries = normalizeData(await committed(), registry);
      return { entries, recovery: { raw, message: errorMessage(error) } };
    }
    if (legacy) {
      const result = saveData(storage, raw);
      return result.saved ? { entries, cleanupWarning: result.cleanupWarning } : { entries, warning: result.warning };
    }
    return { entries };
  }
  return { entries: normalizeData(await committed(), registry), warning };
}

export class TravelStore {
  private entries: LocationEntry[];
  private listeners = new Set<() => void>();
  private byId: Map<string, LocationEntry>;

  constructor(
    entries: LocationEntry[],
    private registry: readonly Territory[],
    private storage: StorageAccess | undefined,
    private warn: (message: string, dataSaved?: boolean) => void,
    private saved: () => void = () => {},
  ) {
    this.entries = normalizeData(entries, registry);
    this.byId = new Map(this.entries.map((entry) => [entry.id, entry]));
  }

  snapshot(): LocationEntry[] {
    return structuredClone(this.entries);
  }

  status(id: string): TravelStatus {
    const entry = this.byId.get(id);
    if (!entry) throw new Error(`Unknown territory: ${id}`);
    return entry.status;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setStatus(id: string, status: TravelStatus): void {
    const entry = this.byId.get(id);
    if (!entry) throw new Error(`Unknown territory: ${id}`);
    if (!STATUSES.includes(status)) throw new Error(`Invalid travel status: ${status}`);
    if (entry.status === status) return;
    entry.status = status;
    entry.updatedAt = new Date().toISOString();
    this.persist();
    this.listeners.forEach((listener) => listener());
  }

  replace(entries: LocationEntry[]): void {
    const normalized = normalizeData(entries, this.registry);
    this.entries = normalized;
    this.byId = new Map(normalized.map((entry) => [entry.id, entry]));
    this.persist();
    this.listeners.forEach((listener) => listener());
  }

  persist(): void {
    const result = saveData(this.storage, this.exportJson());
    if (result.saved) {
      this.saved();
      if (result.cleanupWarning) this.warn(result.cleanupWarning, true);
    } else this.warn(result.warning);
  }

  exportJson(): string {
    return JSON.stringify(this.entries, null, 2) + '\n';
  }
}
