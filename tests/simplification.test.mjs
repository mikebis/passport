import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { feature, neighbors } from 'topojson-client';
import { topology } from 'topojson-server';
import { geoArea } from 'd3';
import { geographyMetrics, geometrySignature, simplifyGeography } from '../scripts/simplify-geography.mjs';

const polygon = (id, coordinates) => ({ type: 'Feature', id, properties: { id }, geometry: { type: 'Polygon', coordinates } });
const makeWorld = features => topology({
  countries: { type: 'FeatureCollection', features },
  background: { type: 'FeatureCollection', features: [] },
}, 1e6);
const rectangle = (x, y, width, height) => [[x, y], [x, y + height], [x + width, y + height], [x + width, y], [x, y]];

describe('protected geographic simplification', () => {
  it('preserves closed tiny polygons, narrow overlays and interior holes', () => {
    const outer = rectangle(0, 0, 10, 10);
    const hole = rectangle(2, 2, .01, .01).reverse();
    const world = makeWorld([
      polygon('large', [outer, hole]),
      polygon('tiny', [rectangle(20, 20, .0001, .0001)]),
      polygon('narrow', [rectangle(21, 20, .1, .0001)]),
    ]);
    const original = feature(world, world.objects.countries).features;
    const { world: result } = simplifyGeography(world);
    const boundaries = feature(result, result.objects.countries).features;
    expect(geometrySignature(result)).toBe(geometrySignature(world));
    expect(boundaries[0].geometry.coordinates).toHaveLength(2);
    for (let index = 0; index < boundaries.length; index++) {
      expect(geoArea(boundaries[index])).toBeGreaterThan(0);
      expect(geoArea(boundaries[index])).toBeCloseTo(geoArea(original[index]), 8);
      for (const ring of boundaries[index].geometry.coordinates) {
        expect(ring[0]).toEqual(ring.at(-1));
        expect(new Set(ring.map(point => point.join(','))).size).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('simplifies shared borders once, retaining adjacency and deterministic source geometry', () => {
    const border = Array.from({ length: 100 }, (_, index) => [1 + .001 * Math.sin(index), index / 10]);
    const left = [[0, 0], [0, 9.9], ...border.toReversed(), [0, 0]];
    const right = [...border, [2, 9.9], [2, 0], border[0]];
    const world = makeWorld([polygon('left', [left]), polygon('right', [right])]);
    const snapshot = JSON.stringify(world);
    const result = simplifyGeography(world);
    expect(result.world).toEqual(simplifyGeography(world).world);
    expect(JSON.stringify(world)).toBe(snapshot);
    expect(neighbors(result.world.objects.countries.geometries)).toEqual([[1], [0]]);
    expect(geometrySignature(result.world)).toBe(geometrySignature(world));
    expect(result.simplification.after.vertices).toBeLessThan(result.simplification.before.vertices * .5);
    for (const arc of result.world.arcs) expect(arc.every(point => point.length === 2)).toBe(true);
  });

  it('keeps the bundled map within its complexity budget without losing any shapes', () => {
    const raw = readFileSync(new URL('../data/world-10m.json', import.meta.url));
    const world = JSON.parse(raw);
    const { simplification } = JSON.parse(readFileSync(new URL('../data/provenance.json', import.meta.url)));
    const metrics = geographyMetrics(world);
    expect(metrics).toEqual(simplification.after);
    expect(metrics.vertices).toBeLessThanOrEqual(simplification.before.vertices * .3);
    expect(metrics.pathCharacters).toBeLessThanOrEqual(simplification.before.pathCharacters * .3);
    expect(metrics.bytes).toBeLessThan(1_500_000);
    expect(gzipSync(raw).length).toBeLessThan(550_000);
    expect(metrics.polygons).toBe(4292);
    expect(metrics.rings).toBe(4312);
    expect(world.objects.countries.geometries).toHaveLength(266);
    expect(geometrySignature(world)).toBe(simplification.geometrySignature);
  });
});
