import assert from 'node:assert/strict';
import { geoBounds, geoContains } from 'd3';
import { feature, mergeArcs } from 'topojson-client';

export function correctCrimea(world) {
  const countries = world?.objects?.countries;
  assert(world?.type === 'Topology' && countries?.type === 'GeometryCollection'
    && Array.isArray(countries.geometries), 'Expected country topology for the Crimea correction.');
  function country(id) {
    const matches = countries.geometries.filter((geometry) => geometry.id === id);
    assert.equal(matches.length, 1, `Crimea correction requires exactly one ${id} geometry.`);
    assert(matches[0].type === 'MultiPolygon' && Array.isArray(matches[0].arcs),
      `Crimea correction requires ${id} to be a MultiPolygon.`);
    return matches[0];
  }
  const russia = country('RUS');
  const ukraine = country('UKR');
  const inlandPoints = [[34.1024, 44.9521], [33.55, 44.6], [34.165, 44.495], [36.47, 45.356]];
  const candidates = russia.arcs.filter((arcs) => {
    const polygon = feature(world, { type: 'Polygon', arcs });
    return inlandPoints.every((point) => geoContains(polygon, point));
  });
  assert.equal(candidates.length, 1, 'Expected exactly one Russian polygon containing inland Crimea, including Sevastopol.');
  const crimea = { type: 'Polygon', arcs: candidates[0] };
  const [[west, south], [east, north]] = geoBounds(feature(world, crimea));
  assert(west >= 32 && east <= 37 && south >= 44 && north <= 46.5,
    'Crimea polygon extends outside the expected peninsula.');
  const remaining = russia.arcs.filter((arcs) => arcs !== crimea.arcs);
  assert(remaining.length > 0, 'Crimea correction must preserve the rest of Russia.');
  const merged = mergeArcs(world, [ukraine, crimea]);
  assert(merged.arcs.length === ukraine.arcs.length,
    'Crimea must join mainland Ukraine across its existing shared border.');
  return {
    ...world,
    objects: {
      ...world.objects,
      countries: {
        ...countries,
        geometries: countries.geometries.map((geometry) => geometry === russia
          ? { ...russia, arcs: remaining }
          : geometry === ukraine ? { ...ukraine, arcs: merged.arcs } : geometry),
      },
    },
  };
}
