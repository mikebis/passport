import { describe, expect, it } from 'vitest';
import registryJson from '../data/registry.json';
import { validateRegistry } from '../src/geography';
import { TravelStore } from '../src/store';
import { formatPercentage, travelStatistics } from '../src/statistics';
import type { TravelStatus } from '../src/types';

const registry = validateRegistry(registryJson);
describe('ISO travel statistics', () => {
  it('counts all statuses, unique completion, seven continents and ISO-only percentages', () => {
    const statuses: Record<string, TravelStatus> = { EST: 'visited', FRA: 'lived', DEU: 'want_to_visit', ATA: 'visited', 'custom:SOL': 'visited' };
    const stats = travelStatistics(registry, (id) => statuses[id] ?? 'unvisited');
    expect(stats.counts).toEqual({ visited: 2, lived: 1, want_to_visit: 1, unvisited: 245 });
    expect(stats.total).toBe(249);
    expect(stats.completed).toBe(3);
    expect(stats.percentage).toBe(3 / 249 * 100);
    expect(stats.continentsCompleted).toBe(2);
    expect(stats.continents.size).toBe(7);
    expect(stats.continents.get('Europe')).toEqual({ completed: 2, total: 52 });
    expect(stats.continents.get('Antarctica')).toEqual({ completed: 1, total: 1 });
    expect(formatPercentage(stats.percentage)).toBe('1.2%');
  });
  it('uses the registry rather than hardcoded totals and handles no ISO entries', () => {
    const stats = travelStatistics(registry.filter((entry) => entry.id === 'EST'), () => 'lived');
    expect(stats.total).toBe(1);
    expect(stats.percentage).toBe(100);
    expect(stats.continents.get('Europe')).toEqual({ completed: 1, total: 1 });
    expect(travelStatistics([], () => 'visited').percentage).toBe(0);
    expect(travelStatistics(registry, () => 'unvisited').continentsCompleted).toBe(0);
    expect(travelStatistics(registry.filter((entry) => entry.kind === 'custom'), () => 'visited').completed).toBe(0);
  });
  it('follows current store status, not timestamps or subdivisions', () => {
    const store = new TravelStore([{
      id: 'USA', name: 'United States', continent: 'North America', status: 'unvisited',
      subdivisions: [{ id: 'US-CA', name: 'California', continent: 'North America', status: 'visited' }],
    }], registry, undefined, () => {});
    const stats = () => travelStatistics(registry, (id) => store.status(id));
    expect(stats().completed).toBe(0);
    store.setStatus('USA', 'lived');
    expect(stats().completed).toBe(1);
    expect(stats().continentsCompleted).toBe(1);
    store.setStatus('USA', 'want_to_visit');
    expect(stats().completed).toBe(0);
    expect(stats().continentsCompleted).toBe(0);
  });
});
