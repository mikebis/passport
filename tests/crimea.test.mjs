import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { feature } from 'topojson-client';
import { topology } from 'topojson-server';
import { geoArea, geoContains } from 'd3';
import { correctCrimea } from '../scripts/correct-crimea.mjs';

const rectangle = (x, y, width, height) => [[x, y], [x, y + height], [x + width, y + height], [x + width, y], [x, y]];
const crimeanPoints = [[34.1024, 44.9521], [33.55, 44.6], [34.165, 44.495], [36.47, 45.356]];
const geometry = (world, id) => world.objects.countries.geometries.find((entry) => entry.id === id);
const decoded = (world, id) => feature(world, geometry(world, id));
const arcIds = (arcs) => arcs.flat(Infinity).map((id) => id < 0 ? ~id : id);

function makeWorld({ crimea = [rectangle(32.4, 44.3, 4.3, 2), rectangle(33, 45, .1, .1).reverse()], ukraineY = 46.3 } = {}) {
  const country = (id, coordinates) => ({ type: 'Feature', id, properties: { id }, geometry: { type: 'MultiPolygon', coordinates } });
  return topology({
    countries: {
      type: 'FeatureCollection',
      features: [
        country('UKR', [[rectangle(32.4, ukraineY, 4.3, 2.7)], [rectangle(30, 48, .1, .1)]]),
        country('RUS', [[rectangle(37, 48, 3, 2)], crimea]),
        country('other', [[rectangle(20, 20, 1, 1)]]),
      ],
    },
    background: { type: 'FeatureCollection', features: [] },
  }, 1e6);
}

describe('guarded Crimea normalization', () => {
  it('moves the complete peninsula and preserves all coordinates, other territories and input data', () => {
    const world = makeWorld();
    const original = structuredClone(world);
    const corrected = correctCrimea(world);
    expect(world).toEqual(original);
    expect(corrected.arcs).toBe(world.arcs);
    expect(corrected.transform).toBe(world.transform);
    expect(corrected.objects.background).toBe(world.objects.background);
    expect(geometry(corrected, 'other')).toBe(geometry(world, 'other'));
    expect(corrected.objects.countries.geometries.map((entry) => entry.id)).toEqual(['UKR', 'RUS', 'other']);
    expect(geometry(corrected, 'RUS').arcs).toEqual([geometry(world, 'RUS').arcs[0]]);
    for (const point of crimeanPoints) {
      expect(geoContains(decoded(corrected, 'UKR'), point)).toBe(true);
      expect(geoContains(decoded(corrected, 'RUS'), point)).toBe(false);
    }
    expect(correctCrimea(world)).toEqual(corrected);
  });

  it('dissolves only the shared border, preserving coastline arcs, islands, holes and total land area', () => {
    const world = makeWorld();
    const corrected = correctCrimea(world);
    const crimea = geometry(world, 'RUS').arcs[1];
    const ukrainianArcs = new Set(arcIds(geometry(world, 'UKR').arcs));
    const shared = arcIds(crimea).filter((id) => ukrainianArcs.has(id));
    expect(shared).toHaveLength(1);
    const mergedArcs = new Set(arcIds(geometry(corrected, 'UKR').arcs));
    expect(shared.every((id) => !mergedArcs.has(id))).toBe(true);
    expect(arcIds(crimea).filter((id) => !shared.includes(id)).every((id) => mergedArcs.has(id))).toBe(true);
    expect(geometry(corrected, 'UKR').arcs).toHaveLength(2);
    expect(geoContains(decoded(corrected, 'UKR'), [30.05, 48.05])).toBe(true);
    expect(geoContains(decoded(corrected, 'UKR'), [33.05, 45.05])).toBe(false);
    const peninsulaArea = geoArea(feature(world, { type: 'Polygon', arcs: crimea }));
    expect(geoArea(decoded(corrected, 'UKR'))).toBeCloseTo(geoArea(decoded(world, 'UKR')) + peninsulaArea, 10);
    expect(geoArea(decoded(corrected, 'RUS'))).toBeCloseTo(geoArea(decoded(world, 'RUS')) - peninsulaArea, 10);
  });

  it('rejects missing, duplicate or non-MultiPolygon country geometries', () => {
    for (const id of ['UKR', 'RUS']) {
      const missing = makeWorld();
      missing.objects.countries.geometries = missing.objects.countries.geometries.filter((entry) => entry.id !== id);
      expect(() => correctCrimea(missing)).toThrow(`exactly one ${id}`);
      const duplicate = makeWorld();
      duplicate.objects.countries.geometries.push(structuredClone(geometry(duplicate, id)));
      expect(() => correctCrimea(duplicate)).toThrow(`exactly one ${id}`);
      const malformed = makeWorld();
      geometry(malformed, id).type = 'Polygon';
      expect(() => correctCrimea(malformed)).toThrow('MultiPolygon');
    }
    expect(() => correctCrimea({})).toThrow('Expected country topology');
  });

  it('rejects missing, ambiguous, overly broad, or detached Crimean components', () => {
    const missing = makeWorld();
    geometry(missing, 'RUS').arcs.pop();
    expect(() => correctCrimea(missing)).toThrow('exactly one Russian polygon');
    const ambiguous = makeWorld();
    geometry(ambiguous, 'RUS').arcs.push(geometry(ambiguous, 'RUS').arcs[1]);
    expect(() => correctCrimea(ambiguous)).toThrow('exactly one Russian polygon');
    expect(() => correctCrimea(makeWorld({ crimea: [rectangle(20, 40, 30, 20)] }))).toThrow('outside the expected peninsula');
    expect(() => correctCrimea(makeWorld({ ukraineY: 47 }))).toThrow('existing shared border');
    const noMainland = makeWorld();
    geometry(noMainland, 'RUS').arcs.shift();
    expect(() => correctCrimea(noMainland)).toThrow('preserve the rest of Russia');
  });
});

describe('bundled Ukrainian boundaries', () => {
  const world = JSON.parse(readFileSync(new URL('../data/world-10m.json', import.meta.url)));
  const ukraine = decoded(world, 'UKR');
  const russia = decoded(world, 'RUS');

  it('includes Simferopol, Sevastopol, Yalta and Kerch in Ukraine only', () => {
    for (const point of crimeanPoints) {
      expect(geoContains(ukraine, point)).toBe(true);
      expect(geoContains(russia, point)).toBe(false);
    }
  });

  it('keeps mainland Ukraine and nearby Russian land assigned to their existing countries', () => {
    for (const point of [[30.52, 50.45], [32.65, 46.68]]) {
      expect(geoContains(ukraine, point)).toBe(true);
      expect(geoContains(russia, point)).toBe(false);
    }
    for (const point of [[37.6173, 55.7558], [36.75, 45.2], [38.9753, 45.0355]]) {
      expect(geoContains(russia, point)).toBe(true);
      expect(geoContains(ukraine, point)).toBe(false);
    }
  });
});
