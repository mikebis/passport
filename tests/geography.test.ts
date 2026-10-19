import { describe, expect, it } from 'vitest';
import registryJson from '../data/registry.json';
import { validateRegistry } from '../src/geography';
import { filterTerritories } from '../src/sidebar';
import additional from '../data/additional-territories.json';
import { territorySymbol } from '../src/types';

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
