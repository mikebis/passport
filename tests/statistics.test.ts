import { describe, expect, it } from 'vitest';
import registryJson from '../data/registry.json';
import { validateRegistry } from '../src/geography';
import { TravelStore } from '../src/store';
import { continentProgress, formatPercentage, travelStatistics } from '../src/statistics';
import type { TravelStatus } from '../src/types';

const registry = validateRegistry(registryJson);
describe('all-place travel statistics', () => {
  it('counts all statuses, unique completion, seven continents and all-place percentages', () => {
    const statuses: Record<string, TravelStatus> = { EST: 'visited', FRA: 'lived', DEU: 'want_to_visit', ATA: 'visited', 'custom:SOL': 'visited' };
    const stats = travelStatistics(registry, (id) => statuses[id] ?? 'unvisited');
    expect(stats.counts).toEqual({ visited: 3, lived: 1, want_to_visit: 1, unvisited: 261 });
    expect(stats.total).toBe(registry.length);
    expect(stats.completed).toBe(4);
    expect(stats.percentage).toBe(4 / registry.length * 100);
    expect(stats.continentsCompleted).toBe(3);
    expect(stats.continents.size).toBe(7);
    expect(stats.continents.get('Europe')).toEqual({ completed: 2, total: registry.filter((place) => place.continent === 'Europe').length });
    expect(stats.continents.get('Africa')).toEqual({ completed: 1, total: registry.filter((place) => place.continent === 'Africa').length });
    expect(stats.continents.get('Antarctica')).toEqual({ completed: 1, total: 1 });
    expect(formatPercentage(stats.percentage)).toBe('1.5%');
  });
  it('uses the registry rather than hardcoded totals and handles empty or custom-only registries', () => {
    const stats = travelStatistics(registry.filter((entry) => entry.id === 'EST'), () => 'lived');
    expect(stats.total).toBe(1);
    expect(stats.percentage).toBe(100);
    expect(stats.continents.get('Europe')).toEqual({ completed: 1, total: 1 });
    expect(travelStatistics([], () => 'visited').percentage).toBe(0);
    expect(travelStatistics(registry, () => 'unvisited').continentsCompleted).toBe(0);
    const custom = registry.filter((entry) => entry.kind === 'custom');
    const customStats = travelStatistics(custom, () => 'visited');
    expect(customStats.completed).toBe(custom.length);
    expect(customStats.total).toBe(custom.length);
    expect(customStats.percentage).toBe(100);
  });
  it('counts each independent custom place in every status while Manage continent ratios remain ISO-only', () => {
    const statuses: Record<string, TravelStatus> = {
      'custom:KOS': 'visited', 'custom:CYN': 'lived', 'custom:SOL': 'want_to_visit',
    };
    const status = (id: string): TravelStatus => statuses[id] ?? 'unvisited';
    const stats = travelStatistics(registry, status);
    expect(stats.counts).toEqual({ visited: 1, lived: 1, want_to_visit: 1, unvisited: registry.length - 3 });
    expect(stats.continentsCompleted).toBe(1);
    expect(stats.continents.get('Europe')?.completed).toBe(2);
    const manage = continentProgress(registry, status);
    expect([...manage.values()].every((count) => count.completed === 0)).toBe(true);
    expect([...manage.values()].reduce((sum, count) => sum + count.total, 0))
      .toBe(registry.filter((entry) => entry.kind === 'iso').length);
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
    store.setStatus('custom:SOL', 'lived');
    expect(stats().completed).toBe(1);
    expect(stats().continents.get('Africa')?.completed).toBe(1);
    store.setStatus('custom:SOL', 'unvisited');
    expect(stats().completed).toBe(0);
  });
});
