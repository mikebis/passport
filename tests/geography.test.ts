import { describe, expect, it } from 'vitest';
import registryJson from '../data/registry.json';
import { validateRegistry } from '../src/geography';
import { filterTerritories } from '../src/sidebar';
import { continentProgress } from '../src/statistics';
import additional from '../data/additional-territories.json';
import { CONTINENTS, STATUSES, territorySymbol, type TravelStatus } from '../src/types';
import { TravelStore } from '../src/store';

const registry = validateRegistry(registryJson);

describe('registry and sidebar organization', () => {
  it('contains all 249 ISO entries plus the exact additional catalog and separates Antarctica', () => {
    expect(registry.filter((entry) => entry.kind === 'iso')).toHaveLength(249);
    expect(additional).toHaveLength(17);
    expect(registry).toHaveLength(249 + additional.length);
    expect(new Set(registry.map((country) => country.id)).size).toBe(registry.length);
    expect(registry.filter((entry) => entry.kind === 'custom').map((entry) => entry.id).sort())
      .toEqual(additional.map((entry) => entry.id).sort());
    expect(registry.filter((country) => country.continent === 'Antarctica').map((country) => country.id)).toEqual(['ATA']);
    expect(registry.find((country) => country.id === 'VAT')?.microstate).toBe(true);
    expect(registry.find((country) => country.id === 'UMI')).toBeDefined();
  });

  describe('continent travel progress', () => {
    it('derives every ISO denominator from the registry, including separate Antarctica', () => {
      const progress = continentProgress(registry, () => 'unvisited');
      for (const continent of [...CONTINENTS, 'Antarctica'] as const) {
        expect(progress.get(continent)).toEqual({
          completed: 0,
          total: registry.filter((country) => country.kind === 'iso' && country.continent === continent).length,
        });
      }
      expect([...progress.values()].reduce((sum, count) => sum + count.total, 0)).toBe(249);
      expect(progress.get('Antarctica')).toEqual({ completed: 0, total: 1 });
      const estonia = registry.filter((country) => country.id === 'EST');
      expect(continentProgress(estonia, () => 'visited').get('Europe')).toEqual({ completed: 1, total: 1 });
    });

    it('counts visited and lived once, excluding wishlist, unvisited and every custom territory', () => {
      const statuses = new Map<string, TravelStatus>([
        ['EST', 'visited'], ['FRA', 'lived'], ['DEU', 'want_to_visit'], ['ATA', 'lived'],
        ...registry.filter((country) => country.kind === 'custom').map((country): [string, TravelStatus] => [country.id, 'visited']),
      ]);
      const requested: string[] = [];
      const progress = continentProgress(registry, (id) => {
        requested.push(id);
        return statuses.get(id) ?? 'unvisited';
      });
      expect(progress.get('Europe')?.completed).toBe(2);
      expect(progress.get('Antarctica')).toEqual({ completed: 1, total: 1 });
      expect([...progress.values()].reduce((sum, count) => sum + count.completed, 0)).toBe(3);
      expect(requested).toHaveLength(249);
      expect(requested.every((id) => !id.startsWith('custom:'))).toBe(true);
    });

    it('uses current top-level status only, not subdivisions or past visits', () => {
      const store = new TravelStore([{
        id: 'USA', name: 'United States', continent: 'North America', status: 'unvisited',
        subdivisions: [{ id: 'US-CA', name: 'California', continent: 'North America', status: 'lived' }],
      }], registry, undefined, () => {});
      const completed = () => continentProgress(registry, (id) => store.status(id)).get('North America')?.completed;
      expect(completed()).toBe(0);
      store.setStatus('USA', 'visited');
      expect(completed()).toBe(1);
      store.setStatus('USA', 'lived');
      expect(completed()).toBe(1);
      store.setStatus('USA', 'want_to_visit');
      expect(completed()).toBe(0);
      store.setStatus('USA', 'unvisited');
      expect(completed()).toBe(0);
      expect(store.snapshot().find((entry) => entry.id === 'USA')?.subdivisions?.[0]?.status).toBe('lived');
    });
  });
  it('rejects invalid or incomplete registry data', () => {
    expect(() => validateRegistry([])).toThrow('249');
    expect(() => validateRegistry(registry.map((country, index) => index === 0 ? { ...country, marker: [NaN, 0] } : country))).toThrow('invalid');
    expect(() => validateRegistry(registry.map((country, index) => index === 0 ? registry[1] : country))).toThrow('Duplicate');
  });
  it('sorts alphabetically and filters names and both codes without case sensitivity', () => {
    const all = filterTerritories(registry, '');
    expect(all.map((country) => country.name)).toEqual([...all.map((country) => country.name)].sort((a, b) => a.localeCompare(b, 'en')));
    expect(filterTerritories(registry, 'Estonia').map((country) => country.id)).toEqual(['EST']);
    expect(filterTerritories(registry, ' usa ').map((country) => country.id)).toEqual(['USA']);
    expect(filterTerritories(registry, 'ee').some((country) => country.id === 'EST')).toBe(true);
    expect(filterTerritories(registry, 'not-a-country')).toEqual([]);
  });
  it('finds accented names with unaccented search', () => {
    expect(filterTerritories(registry, 'aland').some((country) => country.id === 'ALA')).toBe(true);
    expect(filterTerritories(registry, 'reunion').some((country) => country.id === 'REU')).toBe(true);
  });
  it('matches independent statuses, OR combinations and an empty/all selection in alphabetical order', () => {
    const statuses = new Map<string, TravelStatus>([
      ['EST', 'visited'], ['FRA', 'lived'], ['DEU', 'want_to_visit'], ['custom:KOS', 'visited'], ['ATA', 'lived'],
    ]);
    const status = (id: string): TravelStatus => statuses.get(id) ?? 'unvisited';
    const matching = (selected: TravelStatus[], query = '') => filterTerritories(registry, query, { selected: new Set(selected), status });
    expect(matching([])).toEqual(filterTerritories(registry, ''));
    for (const selected of STATUSES) {
      expect(matching([selected])).toEqual(filterTerritories(registry, '').filter((country) => status(country.id) === selected));
    }
    expect(matching(['visited', 'want_to_visit']).map((country) => country.id)).toEqual(['EST', 'DEU', 'custom:KOS']);
    expect(matching([...STATUSES])).toEqual(matching([]));
    expect(matching(['visited'], ' est ').map((country) => country.id)).toEqual(['EST']);
    expect(matching(['lived'], 'est')).toEqual([]);
    expect(matching(['visited'], 'custom:KOS').map((country) => country.id)).toEqual(['custom:KOS']);
    expect(matching(['lived'], 'ata').map((country) => country.id)).toEqual(['ATA']);
    expect(matching(['unvisited'], 'aland').some((country) => country.id === 'ALA')).toBe(true);
    expect(matching(['unvisited'], 'REUNION').map((country) => country.id)).toEqual(['REU']);
  });
  it('intersects favourites with status unions and text without changing alphabetical order', () => {
    const favourites = new Set(['EST', 'DEU', 'custom:KOS', 'ATA', 'ALA']);
    const statuses = new Map<string, TravelStatus>([['EST', 'visited'], ['DEU', 'want_to_visit'], ['ATA', 'lived']]);
    const matching = (selected: TravelStatus[], query = '') => filterTerritories(registry, query, {
      selected: new Set(selected), status: (id) => statuses.get(id) ?? 'unvisited', favourite: (id) => favourites.has(id),
    });
    expect(matching([])).toEqual(filterTerritories(registry, '').filter((country) => favourites.has(country.id)));
    expect(matching(['visited', 'want_to_visit']).map((country) => country.id)).toEqual(['EST', 'DEU']);
    expect(matching(['unvisited'], 'aland').map((country) => country.id)).toEqual(['ALA']);
    expect(matching([], 'custom:kos').map((country) => country.id)).toEqual(['custom:KOS']);
    expect(matching(['lived'], 'ata').map((country) => country.id)).toEqual(['ATA']);
    expect(matching(['visited'], 'fra')).toEqual([]);
    expect(matching([...STATUSES])).toEqual(matching([]));
    favourites.clear();
    expect(matching([])).toEqual([]);
  });
  it('rejects unknown custom IDs, missing additions, and invented custom flag codes', () => {
    expect(() => validateRegistry(registry.map((entry) => entry.id === 'custom:KOS' ? { ...entry, id: 'custom:XXX' } : entry)))
      .toThrow('Invalid territory identifier');
    expect(() => validateRegistry(registry.filter((entry) => entry.id !== 'custom:KOS'))).toThrow('configured additional');
    expect(() => validateRegistry(registry.map((entry) => entry.id === 'custom:KOS' ? { ...entry, alpha2: 'XK' } : entry)))
      .toThrow('flag code');
  });
  it('uses neutral custom symbols and searches actual names and stable IDs', () => {
    for (const entry of additional) {
      const territory = registry.find((item) => item.id === entry.id)!;
      expect(territory.kind).toBe('custom');
      expect(territory.alpha2).toBeUndefined();
      expect(territorySymbol(territory)).toBe('\u25ce');
      expect(filterTerritories(registry, entry.id).map((item) => item.id)).toEqual([entry.id]);
    }
    expect(filterTerritories(registry, 'Northern Cyprus').map((item) => item.id)).toEqual(['custom:CYN']);
    expect(filterTerritories(registry, 'undefined')).toEqual([]);
    expect(registry.filter((entry) => ['custom:CYN', 'custom:WSB', 'custom:ESB', 'custom:CNM'].includes(entry.id))
      .every((entry) => entry.continent === registry.find((item) => item.id === 'CYP')?.continent)).toBe(true);
  });
});
