import { geoPath } from 'd3';
import { describe, expect, it } from 'vitest';
import { createProjection, DEFAULT_PROJECTION, fitProjection, liveProjection, markerPoint, PROJECTIONS, type ProjectionId } from '../src/projection';
import { ProjectionPreference, PROJECTION_STORAGE_KEY, type ProjectionStorage } from '../src/projection-preference';

function storage(saved?: string): ProjectionStorage & { values: Map<string, string>; writes: string[] } {
  const values = new Map(saved === undefined ? [] : [[PROJECTION_STORAGE_KEY, saved]]);
  const writes: string[] = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push(key); values.set(key, value); } };
}

describe('map projections', () => {
  it('defaults to Equal Earth and rejects unsupported projection IDs', () => {
    expect(DEFAULT_PROJECTION).toBe('equal-earth');
    expect(PROJECTIONS.map(projection => projection.id)).toEqual(['equal-earth', 'mercator']);
    // @ts-expect-error Exercise runtime validation of unsupported input.
    expect(() => createProjection('unknown')).toThrow('Unknown projection');
  });

  it.each(PROJECTIONS)('fits a finite bounded $label world and round-trips geographic points', ({ id }) => {
    const projection = fitProjection(id, [[15, 20], [985, 450]]);
    const bounds = geoPath(projection).bounds({ type: 'Sphere' });
    expect(bounds.flat().every(Number.isFinite)).toBe(true);
    expect(bounds[0][0]).toBeGreaterThanOrEqual(15 - 1e-6);
    expect(bounds[0][1]).toBeGreaterThanOrEqual(20 - 1e-6);
    expect(bounds[1][0]).toBeLessThanOrEqual(985 + 1e-6);
    expect(bounds[1][1]).toBeLessThanOrEqual(450 + 1e-6);
    for (const point of [[0, 0], [34.1, 44.95], [-179, -70], [140, 80]] as [number, number][]) {
      const projected = projection(point)!;
      expect(projected.every(Number.isFinite)).toBe(true);
      const inverse = projection.invert!(projected)!;
      expect(inverse[0]).toBeCloseTo(point[0], 6);
      expect(inverse[1]).toBeCloseTo(point[1], 6);
    }
  });

  it('shows polar Equal Earth land and only clamps the Antarctic marker in Mercator', () => {
    const equalEarth = liveProjection('equal-earth', 1000, 650);
    const point: [number, number] = [0, -90];
    expect(equalEarth(point)![1]).toBeLessThan(650);
    expect(markerPoint(equalEarth, point, 'ATA', 'equal-earth', 600)).toEqual(equalEarth(point));
    const mercator = liveProjection('mercator', 1000, 650);
    expect(markerPoint(mercator, [0, -89], 'ATA', 'mercator', 632)[1]).toBe(632);
    expect(markerPoint(mercator, [10, 60], 'NOR', 'mercator', 632)).toEqual(mercator([10, 60]));
  });
});

describe('independent projection preference', () => {
  it('defaults without writing and restores either choice without rewriting', () => {
    const memory = storage();
    expect(new ProjectionPreference(() => memory).current).toBe(DEFAULT_PROJECTION);
    expect(memory.writes).toEqual([]);
    for (const { id } of PROJECTIONS) {
      const saved = storage(id);
      expect(new ProjectionPreference(() => saved).current).toBe(id);
      expect(saved.writes).toEqual([]);
    }
  });

  it('reports invalid saved values without overwriting them and rejects invalid choices', () => {
    const memory = storage('unknown');
    const preference = new ProjectionPreference(() => memory);
    expect(preference.current).toBe(DEFAULT_PROJECTION);
    expect(preference.warning).toContain('not available');
    expect(memory.values.get(PROJECTION_STORAGE_KEY)).toBe('unknown');
    expect(() => preference.choose('unknown')).toThrow('Unknown projection');
    expect(memory.writes).toEqual([]);
  });

  it('writes only its own key and notifies only genuine changes until unsubscribed', () => {
    const memory = storage();
    for (const key of ['passport:locations:v1', 'passport:theme:v1', 'passport:sidebar:v1']) memory.values.set(key, 'untouched');
    const preference = new ProjectionPreference(() => memory);
    const changes: ProjectionId[] = [];
    const unsubscribe = preference.subscribe(() => changes.push(preference.current));
    preference.choose('mercator');
    preference.choose('mercator');
    unsubscribe();
    preference.choose('equal-earth');
    expect(changes).toEqual(['mercator']);
    expect(memory.writes).toEqual([PROJECTION_STORAGE_KEY, PROJECTION_STORAGE_KEY, PROJECTION_STORAGE_KEY]);
    for (const key of ['passport:locations:v1', 'passport:theme:v1', 'passport:sidebar:v1']) expect(memory.values.get(key)).toBe('untouched');
  });

  it('reports denied access and keeps an explicit session-only choice', () => {
    const preference = new ProjectionPreference(() => { throw new Error('access denied'); });
    expect(preference.warning).toContain('access denied');
    preference.choose('mercator');
    expect(preference.current).toBe('mercator');
    expect(preference.warning).toContain('could not be remembered');
  });

  it('can save after a read failure and clears the warning', () => {
    const memory = storage();
    memory.getItem = () => { throw new Error('read failed'); };
    const preference = new ProjectionPreference(() => memory);
    expect(preference.warning).toContain('read failed');
    preference.choose('mercator');
    expect(preference.warning).toBeUndefined();
    expect(memory.writes).toEqual([PROJECTION_STORAGE_KEY]);
  });

  it('retains a failed-save choice and supports later successful recovery', () => {
    const memory = storage('equal-earth');
    const set = memory.setItem;
    memory.setItem = () => { throw new Error('quota exceeded'); };
    const preference = new ProjectionPreference(() => memory);
    preference.choose('mercator');
    expect(preference.current).toBe('mercator');
    expect(memory.values.get(PROJECTION_STORAGE_KEY)).toBe('equal-earth');
    expect(preference.warning).toContain('quota exceeded');
    memory.setItem = set;
    preference.choose('mercator');
    expect(preference.warning).toBeUndefined();
    expect(memory.values.get(PROJECTION_STORAGE_KEY)).toBe('mercator');
  });
});
