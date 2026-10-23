import { describe, expect, it, vi } from 'vitest';
import { LEGACY_STORAGE_KEY, loadInitialState, normalizeData, parseData, STORAGE_KEY, TravelStore, type StorageAccess } from '../src/store';
import { STATUSES, type LocationEntry, type Territory } from '../src/types';
import registryData from '../data/registry.json';
import { validateRegistry } from '../src/geography';

const registry: Territory[] = [
  { id: 'USA', kind: 'iso', alpha2: 'US', name: 'United States', continent: 'North America', marker: [-100, 40], microstate: false },
  { id: 'EST', kind: 'iso', alpha2: 'EE', name: 'Estonia', continent: 'Europe', marker: [25, 59], microstate: false },
];
const entry: LocationEntry = { id: 'USA', name: 'United States', continent: 'North America', status: 'visited' };
const region: LocationEntry = { id: 'US-CA', name: 'California', continent: 'North America', status: 'lived', updatedAt: '2025-03-01T12:30:00Z' };

function storage(raw: string | null = null, legacy: string | null = null): StorageAccess & { value: string | null; legacy: string | null } {
  return {
    value: raw,
    legacy,
    getItem(key) { return key === STORAGE_KEY ? this.value : key === LEGACY_STORAGE_KEY ? this.legacy : null; },
    setItem(key, value) { expect(key).toBe(STORAGE_KEY); this.value = value; },
    removeItem(key) { expect(key).toBe(LEGACY_STORAGE_KEY); this.legacy = null; },
  };
}

describe('data validation and normalization', () => {
  it('adds missing known countries without changing existing statuses', () => {
    expect(normalizeData([entry], registry)).toEqual([
      { id: 'EST', name: 'Estonia', continent: 'Europe', status: 'unvisited' }, entry,
    ]);
  });
  it('uses authoritative metadata and sorts by alpha-3 ID', () => {
    const normalized = normalizeData([{ ...entry, name: 'Outdated', continent: 'Wrong' }], registry);
    expect(normalized[1]).toEqual(entry);
    expect(normalized.map((country) => country.id)).toEqual(['EST', 'USA']);
  });
  it('preserves recursive subdivision data and optional timestamps', () => {
    const data = [{ ...entry, subdivisions: [{ ...region, subdivisions: [] }], updatedAt: '2024-01-01T00:00:00.000Z' }];
    const normalized = normalizeData(data, registry);
    expect(normalized[1]).toEqual(data[0]);
    expect(parseData(JSON.stringify(normalized), registry)).toEqual(normalized);
  });
  it.each([
    [null, 'array'], [{ countries: [] }, 'array'],
    [[{ ...entry, id: 'UNK' }], 'Unknown territory'],
    [[entry, entry], 'Duplicate'],
    [[{ ...entry, status: 'maybe' }], 'Invalid travel status'],
    [[{ ...entry, name: '' }], 'name and continent'],
    [[{ ...entry, updatedAt: 'yesterday' }], 'timestamp'],
    [[{ ...entry, updatedAt: 123 }], 'timestamp'],
    [[{ ...entry, updatedAt: '2025-02-30T12:00:00Z' }], 'timestamp'],
    [[{ ...entry, updatedAt: '2025-01-01T24:00:00Z' }], 'timestamp'],
    [[{ ...entry, subdivisions: {} }], 'must be an array'],
    [[{ ...entry, favourite: 'true' }], 'Favourite flag'],
    [[{ ...entry, favourite: 1 }], 'Favourite flag'],
    [[{ ...entry, favourite: null }], 'Favourite flag'],
    [[{ ...entry, subdivisions: [{ ...region, id: 'CA-ON' }] }], 'Invalid subdivision'],
    [[{ ...entry, subdivisions: [region, region] }], 'Duplicate'],
  ])('rejects malformed data %#', (value, message) => {
    expect(() => normalizeData(value, registry)).toThrow(String(message));
  });
  it('rejects malformed JSON with a clear message', () => {
    expect(() => parseData('{', registry)).toThrow('not valid JSON');
  });
  it('does not mutate imported objects', () => {
    const original = structuredClone(entry);
    const normalized = normalizeData([entry], registry);
    normalized[1]!.status = 'lived';
    expect(entry).toEqual(original);
  });
  it('accepts actual leap days and timezone offsets', () => {
    const data = normalizeData([{ ...entry, updatedAt: '2024-02-29T23:45:10+02:00' }], registry);
    expect(data[1]?.updatedAt).toBe('2024-02-29T23:45:10+02:00');
  });
});

describe('initial state precedence and recovery', () => {
  it('loads valid local state without fetching committed data', async () => {
    const committed = vi.fn();
    const initial = await loadInitialState(registry, storage(JSON.stringify([entry])), committed);
    expect(initial.entries[1]?.status).toBe('visited');
    expect(committed).not.toHaveBeenCalled();
  });
  it('uses committed data only when local state is absent', async () => {
    const committed = vi.fn().mockResolvedValue([entry]);
    const initial = await loadInitialState(registry, storage(), committed);
    expect(committed).toHaveBeenCalledOnce();
    expect(initial.entries[1]?.status).toBe('visited');
  });
  it('preserves corrupt local data and requires explicit recovery', async () => {
    const local = storage('{bad');
    const initial = await loadInitialState(registry, local, async () => []);
    expect(initial.recovery?.raw).toBe('{bad');
    expect(initial.recovery?.message).toContain('not valid JSON');
    expect(local.value).toBe('{bad');
  });
  it('does not silently accept semantically invalid saved state', async () => {
    const initial = await loadInitialState(registry, storage(JSON.stringify([{ ...entry, status: 'invalid' }])), async () => []);
    expect(initial.recovery?.message).toContain('Invalid travel status');
  });
  it('reports unavailable storage explicitly', async () => {
    expect((await loadInitialState(registry, undefined, async () => [])).warning).toContain('unavailable');
  });
  it('reports read failure while loading committed state', async () => {
    const local = { getItem: () => { throw new Error('denied'); }, setItem: vi.fn(), removeItem: vi.fn() };
    expect((await loadInitialState(registry, local, async () => [])).warning).toContain('denied');
  });
  it('propagates failed or invalid committed loads', async () => {
    await expect(loadInitialState(registry, storage(), async () => { throw new Error('HTTP 404'); })).rejects.toThrow('404');
    await expect(loadInitialState(registry, storage(), async () => ({}))).rejects.toThrow('array');
  });
});

describe('passport storage migration', () => {
  const expanded = validateRegistry(registryData);
  const oldData = [{
    ...entry, updatedAt: '2025-03-01T12:30:00Z', subdivisions: [{ ...region, subdivisions: [] }],
  }, {
    id: 'custom:KOS', name: 'Kosovo', continent: 'Europe', status: 'lived', subdivisions: [],
  }];
  const raw = JSON.stringify(oldData, null, 2) + '\n';

  it('copies validated legacy JSON exactly before removing it and preserves every data field', async () => {
    const local = storage(null, raw);
    const set = vi.spyOn(local, 'setItem');
    const remove = vi.spyOn(local, 'removeItem').mockImplementation((key) => {
      expect(key).toBe(LEGACY_STORAGE_KEY);
      expect(local.value).toBe(raw);
      local.legacy = null;
    });
    const committed = vi.fn();
    const initial = await loadInitialState(expanded, local, committed);
    expect(initial.entries).toEqual(normalizeData(oldData, expanded));
    expect(initial.warning).toBeUndefined();
    expect(initial.cleanupWarning).toBeUndefined();
    expect(committed).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledExactlyOnceWith(STORAGE_KEY, raw);
    expect(remove).toHaveBeenCalledExactlyOnceWith(LEGACY_STORAGE_KEY);
    expect(local.value).toBe(raw);
    expect(local.legacy).toBeNull();
    expect((await loadInitialState(expanded, local, committed)).entries).toEqual(initial.entries);
    expect(set).toHaveBeenCalledOnce();
  });

  it('loads an existing passport save without reading, rewriting, or merging legacy data', async () => {
    const local = storage('[]', raw);
    const read = vi.spyOn(local, 'getItem');
    const set = vi.spyOn(local, 'setItem');
    const remove = vi.spyOn(local, 'removeItem');
    const initial = await loadInitialState(expanded, local, vi.fn());
    expect(initial.entries.every((item) => item.status === 'unvisited')).toBe(true);
    expect(read).toHaveBeenCalledExactlyOnceWith(STORAGE_KEY);
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(local.legacy).toBe(raw);
  });

  it('does not fall back to legacy data when a passport save is corrupt', async () => {
    const local = storage('{broken', raw);
    const initial = await loadInitialState(expanded, local, async () => []);
    expect(initial.recovery?.raw).toBe('{broken');
    expect(local.value).toBe('{broken');
    expect(local.legacy).toBe(raw);
  });

  it.each(['{broken', JSON.stringify([{ ...entry, status: 'invalid' }])])('requires recovery before touching corrupt legacy data %#', async (broken) => {
    const local = storage(null, broken);
    const set = vi.spyOn(local, 'setItem');
    const remove = vi.spyOn(local, 'removeItem');
    const initial = await loadInitialState(expanded, local, async () => []);
    expect(initial.recovery?.raw).toBe(broken);
    expect(local.value).toBeNull();
    expect(local.legacy).toBe(broken);
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('retains loaded places and legacy data if writing the passport key fails', async () => {
    const local = storage(null, raw);
    vi.spyOn(local, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const remove = vi.spyOn(local, 'removeItem');
    const initial = await loadInitialState(expanded, local, vi.fn());
    expect(initial.entries).toEqual(normalizeData(oldData, expanded));
    expect(initial.warning).toContain('quota');
    expect(initial.recovery).toBeUndefined();
    expect(initial.cleanupWarning).toBeUndefined();
    expect(local.value).toBeNull();
    expect(local.legacy).toBe(raw);
    expect(remove).not.toHaveBeenCalled();
  });

  it('reports cleanup failure as saved data, then retries cleanup on the next save', async () => {
    const local = storage(null, raw);
    const remove = vi.spyOn(local, 'removeItem').mockImplementation(() => { throw new Error('cleanup denied'); });
    const initial = await loadInitialState(expanded, local, vi.fn());
    expect(initial.warning).toBeUndefined();
    expect(initial.cleanupWarning).toContain('cleanup denied');
    expect(local.value).toBe(raw);
    expect(local.legacy).toBe(raw);
    const warn = vi.fn();
    const saved = vi.fn();
    const store = new TravelStore(initial.entries, expanded, local, warn, saved);
    store.persist();
    expect(saved).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cleanup denied'), true);
    remove.mockRestore();
    store.persist();
    expect(local.legacy).toBeNull();
    expect(parseData(local.value!, expanded)).toEqual(initial.entries);
  });

  it('keeps corrupt legacy data when confirmed recovery cannot save its replacement', async () => {
    const local = storage(null, '{broken');
    const initial = await loadInitialState(registry, local, async () => []);
    vi.spyOn(local, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const remove = vi.spyOn(local, 'removeItem');
    const warn = vi.fn();
    const store = new TravelStore(initial.entries, registry, local, warn);
    store.persist();
    expect(local.value).toBeNull();
    expect(local.legacy).toBe('{broken');
    expect(remove).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('quota'));
  });

  it('cleans up corrupt legacy data only after saving a confirmed recovery replacement', async () => {
    const local = storage(null, '{broken');
    const initial = await loadInitialState(registry, local, async () => []);
    vi.spyOn(local, 'removeItem').mockImplementation(() => {
      expect(parseData(local.value!, registry)).toEqual(initial.entries);
      local.legacy = null;
    });
    new TravelStore(initial.entries, registry, local, vi.fn()).persist();
    expect(local.legacy).toBeNull();
  });

  it('reports legacy-read errors without writing either key', async () => {
    const local = storage();
    vi.spyOn(local, 'getItem').mockImplementation((key) => {
      if (key === LEGACY_STORAGE_KEY) throw new Error('legacy read denied');
      return null;
    });
    const set = vi.spyOn(local, 'setItem');
    const initial = await loadInitialState(registry, local, async () => []);
    expect(initial.warning).toContain('legacy read denied');
    expect(set).not.toHaveBeenCalled();
  });
});

describe('TravelStore', () => {
  it('defaults old saves to not favourited without rewriting them', async () => {
    const raw = JSON.stringify([entry]);
    const local = storage(raw);
    const set = vi.spyOn(local, 'setItem');
    const initial = await loadInitialState(registry, local, vi.fn());
    const store = new TravelStore(initial.entries, registry, local, vi.fn());
    expect(store.isFavourite('USA')).toBe(false);
    expect(store.isFavourite('EST')).toBe(false);
    expect(set).not.toHaveBeenCalled();
    expect(local.value).toBe(raw);
  });
  it('keeps favourites independent of every status, including resetting to unvisited', () => {
    const store = new TravelStore([{ ...entry, subdivisions: [region] }], registry, storage(), vi.fn());
    store.setFavourite('USA', true);
    for (const status of STATUSES) {
      store.setStatus('USA', status);
      expect(store.isFavourite('USA')).toBe(true);
      expect(store.status('USA')).toBe(status);
    }
    store.setFavourite('USA', false);
    expect(store.status('USA')).toBe('unvisited');
    expect(store.snapshot()[1]?.subdivisions).toEqual([region]);
  });
  it('persists true/false favourites, timestamps and notifications, with no-op protection', () => {
    const local = storage();
    const set = vi.spyOn(local, 'setItem');
    const store = new TravelStore([entry], registry, local, vi.fn());
    const listener = vi.fn();
    store.subscribe(listener);
    store.setFavourite('USA', false);
    expect(set).not.toHaveBeenCalled();
    store.setFavourite('USA', true);
    expect(store.snapshot()[1]?.updatedAt).toMatch(/Z$/);
    expect(parseData(local.value!, registry)[1]?.favourite).toBe(true);
    const before = store.exportJson();
    store.setFavourite('USA', true);
    expect(store.exportJson()).toBe(before);
    expect(listener).toHaveBeenCalledExactlyOnceWith('local');
    expect(set).toHaveBeenCalledOnce();
    store.setFavourite('USA', false);
    expect(parseData(local.value!, registry)[1]?.favourite).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(() => store.isFavourite('BAD')).toThrow('Unknown territory');
    expect(() => store.setFavourite('BAD', true)).toThrow('Unknown territory');
  });
  it('retains favourite changes in memory and export and notifies when saving fails', () => {
    const warn = vi.fn();
    const saved = vi.fn();
    const local = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: vi.fn() };
    const store = new TravelStore([entry], registry, local, warn, saved);
    const listener = vi.fn();
    store.subscribe(listener);
    store.setFavourite('USA', true);
    expect(store.isFavourite('USA')).toBe(true);
    expect(parseData(store.exportJson(), registry)[1]?.favourite).toBe(true);
    expect(store.status('USA')).toBe('visited');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('quota'));
    expect(saved).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledExactlyOnceWith('local');
  });
  it('round-trips flags and recursive subdivisions and replaces favourites with imported data', () => {
    const data = [{ ...entry, favourite: true, subdivisions: [{ ...region, favourite: false }] }];
    const store = new TravelStore(data, registry, storage(), vi.fn());
    expect(parseData(store.exportJson(), registry)[1]).toEqual(data[0]);
    const listener = vi.fn();
    store.subscribe(listener);
    store.replace([{ ...entry, favourite: false }], 'remote');
    expect(store.isFavourite('USA')).toBe(false);
    expect(listener).toHaveBeenCalledExactlyOnceWith('remote');
    store.setFavourite('USA', true);
    store.replace([entry]);
    expect(store.isFavourite('USA')).toBe(false);
  });
  it('supports custom-place and Antarctic favourites without affecting related countries', () => {
    const expanded = validateRegistry(registryData);
    const store = new TravelStore([], expanded, storage(), vi.fn());
    store.setFavourite('custom:KOS', true);
    store.setFavourite('ATA', true);
    expect(store.isFavourite('custom:KOS')).toBe(true);
    expect(store.isFavourite('SRB')).toBe(false);
    expect(store.isFavourite('ATA')).toBe(true);
    expect(store.status('ATA')).toBe('unvisited');
  });
  it('updates state, timestamps, subscribers and localStorage together', () => {
    const local = storage();
    const saved = vi.fn();
    const store = new TravelStore([], registry, local, vi.fn(), saved);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setStatus('USA', 'lived');
    expect(store.status('USA')).toBe('lived');
    expect(store.snapshot()[1]?.updatedAt).toMatch(/Z$/);
    expect(parseData(local.value!, registry)[1]?.status).toBe('lived');
    expect(listener).toHaveBeenCalledOnce();
    expect(saved).toHaveBeenCalledOnce();
    unsubscribe();
    store.setStatus('USA', 'visited');
    expect(listener).toHaveBeenCalledOnce();
  });
  it('does not timestamp, persist or notify for a no-op update', () => {
    const local = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const store = new TravelStore([entry], registry, local, vi.fn());
    const listener = vi.fn();
    store.subscribe(listener);
    store.setStatus('USA', 'visited');
    expect(store.snapshot()[1]?.updatedAt).toBeUndefined();
    expect(local.setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
  it('retains edits and export when storage fails, but warns instead of claiming saved', () => {
    const warn = vi.fn();
    const saved = vi.fn();
    const local = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: vi.fn() };
    const store = new TravelStore([], registry, local, warn, saved);
    store.setStatus('EST', 'want_to_visit');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('quota'));
    expect(saved).not.toHaveBeenCalled();
    expect(parseData(store.exportJson(), registry)[0]?.status).toBe('want_to_visit');
  });
  it('does not lose subdivisions when changing a country status', () => {
    const store = new TravelStore([{ ...entry, subdivisions: [region] }], registry, storage(), vi.fn());
    store.setStatus('USA', 'unvisited');
    expect(store.snapshot()[1]?.subdivisions).toEqual([region]);
  });
  it('validates replacement atomically before updating anything', () => {
    const store = new TravelStore([entry], registry, storage(), vi.fn());
    const before = store.exportJson();
    expect(() => store.replace([{ ...entry, id: 'BAD' }])).toThrow('Unknown territory');
    expect(store.exportJson()).toBe(before);
  });

  describe('additional territory compatibility', () => {
    const expanded = validateRegistry(registryData);
    const isoRegistry = expanded.filter((territory) => territory.kind === 'iso');
    const customRegistry = expanded.filter((territory) => territory.kind === 'custom');
    const oldSave = normalizeData([{
      ...entry, subdivisions: [{ ...region, subdivisions: [] }], updatedAt: '2025-03-01T12:30:00Z',
    }, {
      id: 'SRB', name: 'Serbia', continent: 'Europe', status: 'lived', updatedAt: '2025-02-01T12:00:00Z',
    }, {
      id: 'CYP', name: 'Cyprus', continent: 'Europe', status: 'want_to_visit',
    }, {
      id: 'SOM', name: 'Somalia', continent: 'Africa', status: 'visited',
    }], isoRegistry);

    it('loads an old 249-entry save without recovery, loss, or an automatic storage rewrite', async () => {
      expect(oldSave).toHaveLength(249);
      const raw = JSON.stringify(oldSave);
      const local = storage(raw);
      const committed = vi.fn();
      const initial = await loadInitialState(expanded, local, committed);
      expect(initial.recovery).toBeUndefined();
      expect(initial.warning).toBeUndefined();
      expect(committed).not.toHaveBeenCalled();
      expect(initial.entries.filter((item) => !item.id.startsWith('custom:'))).toEqual(oldSave);
      expect(initial.entries.filter((item) => item.id.startsWith('custom:'))).toHaveLength(customRegistry.length);
      expect(initial.entries.filter((item) => item.id.startsWith('custom:')).every((item) => item.status === 'unvisited')).toBe(true);
      const store = new TravelStore(initial.entries, expanded, local, vi.fn());
      expect(local.value).toBe(raw);
      store.setStatus('custom:KOS', 'visited');
      expect(parseData(local.value!, expanded)).toHaveLength(expanded.length);
      expect(store.snapshot().filter((item) => !item.id.startsWith('custom:'))).toEqual(oldSave);
    });

    it('tracks additions independently and round-trips their IDs and statuses', () => {
      const store = new TravelStore(oldSave, expanded, storage(), vi.fn());
      for (const territory of customRegistry) store.setStatus(territory.id, 'lived');
      expect(store.status('SRB')).toBe('lived');
      expect(store.status('CYP')).toBe('want_to_visit');
      expect(store.status('SOM')).toBe('visited');
      const restored = parseData(store.exportJson(), expanded);
      expect(restored.filter((item) => item.id.startsWith('custom:')).every((item) => item.status === 'lived')).toBe(true);
      expect(restored.filter((item) => !item.id.startsWith('custom:'))).toEqual(oldSave);
    });

    it('confirmed replacement with an older file resets additions, not imported ISO data', () => {
      const store = new TravelStore(oldSave, expanded, storage(), vi.fn());
      store.setStatus('custom:KOS', 'visited');
      store.replace(oldSave);
      expect(store.status('custom:KOS')).toBe('unvisited');
      expect(store.snapshot().filter((item) => !item.id.startsWith('custom:'))).toEqual(oldSave);
    });

    it('rejects unknown custom IDs rather than accepting any custom prefix', () => {
      expect(() => normalizeData([{ ...entry, id: 'custom:XXX' }], expanded)).toThrow('Unknown territory ID');
    });

    it('rejects nonempty custom subdivisions explicitly and preserves empty arrays', () => {
      expect(() => normalizeData([{ ...entry, id: 'custom:KOS', subdivisions: [region] }], expanded)).toThrow('Subdivisions are not supported');
      expect(normalizeData([{ ...entry, id: 'custom:KOS', subdivisions: [] }], expanded)
        .find((item) => item.id === 'custom:KOS')?.subdivisions).toEqual([]);
    });
  });
  it('replacement removes previous statuses and preserves imported subdivisions', () => {
    const store = new TravelStore([entry], registry, storage(), vi.fn());
    store.replace([{ ...entry, status: 'unvisited', subdivisions: [region] }]);
    expect(store.status('USA')).toBe('unvisited');
    expect(store.snapshot()[1]?.subdivisions).toEqual([region]);
  });
  it('exports deterministic data that round-trips without changing it', () => {
    const store = new TravelStore([entry], registry, storage(), vi.fn());
    expect(store.exportJson()).toBe(store.exportJson());
    expect(store.exportJson().endsWith('\n')).toBe(true);
    expect(parseData(store.exportJson(), registry)).toEqual(store.snapshot());
  });
  it('returns snapshots rather than mutable internal objects', () => {
    const store = new TravelStore([entry], registry, storage(), vi.fn());
    store.snapshot()[1]!.status = 'unvisited';
    expect(store.status('USA')).toBe('visited');
  });
  it('rejects unknown IDs explicitly', () => {
    const store = new TravelStore([], registry, storage(), vi.fn());
    expect(() => store.status('BAD')).toThrow('Unknown territory');
    expect(() => store.setStatus('BAD', 'visited')).toThrow('Unknown territory');
  });
  it('keeps notifying remaining views and warns when one subscriber fails', () => {
    const warn = vi.fn();
    const store = new TravelStore(normalizeData([], registry), registry, storage(), warn);
    const later = vi.fn();
    store.subscribe(() => { throw new Error('render failed'); });
    store.subscribe(later);
    expect(() => store.setStatus('USA', 'visited')).not.toThrow();
    expect(later).toHaveBeenCalledWith('local');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('render failed'), true);
    expect(store.status('USA')).toBe('visited');
  });
  it('counts status and favourite differences against another dataset', () => {
    const store = new TravelStore(normalizeData([entry], registry), registry, storage(), vi.fn());
    expect(store.differences(normalizeData([entry], registry))).toEqual({ statuses: 0, favourites: 0 });
    const other = normalizeData([{ ...entry, status: 'lived', favourite: true }, { id: 'EST', name: 'Estonia', continent: 'Europe', status: 'visited' }], registry);
    expect(store.differences(other)).toEqual({ statuses: 2, favourites: 1 });
  });
  it('rejects overlong subdivision names', () => {
    const long = { ...region, name: 'x'.repeat(201) };
    expect(() => normalizeData([{ ...entry, subdivisions: [long] }], registry)).toThrow('longer than 200');
    expect(normalizeData([{ ...entry, subdivisions: [{ ...region, name: 'x'.repeat(200) }] }], registry)[1]?.subdivisions?.[0]?.name).toHaveLength(200);
  });
});
