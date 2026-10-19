import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { feature } from 'topojson-client';
import { geoArea, geoMercator, geoPath } from 'd3';
import iso from 'i18n-iso-countries';
import { geographyMetrics, geometrySignature } from './simplify-geography.mjs';

const registry = JSON.parse(await readFile('data/registry.json', 'utf8'));
const world = JSON.parse(await readFile('data/world-10m.json', 'utf8'));
const additional = JSON.parse(await readFile('data/additional-territories.json', 'utf8'));
const provenance = JSON.parse(await readFile('data/provenance.json', 'utf8'));
const { simplification } = provenance;
const complexity = geographyMetrics(world);
assert.deepEqual(complexity, simplification.after, 'Simplification metrics are stale.');
assert.equal(geometrySignature(world), simplification.geometrySignature, 'Polygon/ring structure or shared borders changed.');
assert.equal(complexity.polygons, simplification.before.polygons, 'Simplification removed polygon components.');
assert.equal(complexity.rings, simplification.before.rings, 'Simplification removed rings.');
assert(complexity.vertices <= simplification.before.vertices * .3, 'Map must have at least 70% fewer stored vertices.');
assert(complexity.pathCharacters <= simplification.before.pathCharacters * .3, 'Map must have at least 70% fewer SVG path characters.');
assert(complexity.bytes < 1_500_000, 'Simplified map exceeds its 1.5 MB budget.');
const features = feature(world, world.objects.countries).features;
const expected = Object.entries(iso.getAlpha2Codes()).filter(([code]) => code !== 'XK').map(([, code]) => code).sort();
const customIds = additional.map((entry) => entry.id).sort();
const allIds = [...expected, ...customIds].sort();
assert.equal(expected.length, 249);
assert.equal(additional.length, 17);
assert.equal(new Set(customIds).size, additional.length);
assert.deepEqual(registry.filter((entry) => entry.kind === 'iso').map((entry) => entry.id).sort(), expected);
assert.deepEqual(registry.filter((entry) => entry.kind === 'custom').map((entry) => entry.id).sort(), customIds);
assert.deepEqual(registry.map((entry) => entry.id).sort(), allIds);
assert.deepEqual(features.map((entry) => entry.id).sort(), allIds);
assert.equal(world.objects.background.geometries.length, 0, 'All cataloged background units must be interactive.');
const groups = new Set(['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America', 'Antarctica']);
const path = geoPath(geoMercator().scale(150).translate([500, 350]));
const report = [];
for (const entry of registry) {
  if (entry.kind === 'iso') {
    assert.equal(iso.alpha2ToAlpha3(entry.alpha2), entry.id, `${entry.id}: invalid ISO flag code`);
  } else {
    const catalog = additional.find((item) => item.id === entry.id);
    assert(catalog && entry.id === `custom:${catalog.sourceId}`, `${entry.id}: invalid custom ID`);
    assert.equal(entry.alpha2, undefined, `${entry.id}: invented ISO flag code`);
    assert.equal(entry.name, catalog.name);
    assert.equal(entry.continent, catalog.continent);
  }
  assert(groups.has(entry.continent), `${entry.id}: invalid continent`);
  assert(entry.marker.length === 2 && entry.marker.every(Number.isFinite), `${entry.id}: invalid marker`);
  const boundary = features.find((item) => item.id === entry.id);
  assert(['Polygon', 'MultiPolygon'].includes(boundary.geometry.type), `${entry.id}: not a polygon`);
  const polygons = boundary.geometry.type === 'Polygon' ? [boundary.geometry.coordinates] : boundary.geometry.coordinates;
  for (const polygon of polygons) {
    assert(polygon.length > 0, `${entry.id}: empty polygon`);
    for (const ring of polygon) {
      assert(ring.length >= 4, `${entry.id}: collapsed ring`);
      assert.deepEqual(ring[0], ring.at(-1), `${entry.id}: open ring`);
      assert(new Set(ring.map((point) => JSON.stringify(point))).size >= 3, `${entry.id}: degenerate ring`);
      assert(ring.every((point) => point.every(Number.isFinite)), `${entry.id}: nonfinite geometry`);
    }
  }
  const area = geoArea(boundary);
  assert(area > 0 && area < 2 * Math.PI, `${entry.id}: empty or inverted polygon`);
  const rendered = path(boundary);
  assert(rendered && !/NaN|Infinity/.test(rendered), `${entry.id}: invalid Mercator path`);
  report.push({ id: entry.id, kind: entry.kind, polygons: polygons.length, rings: polygons.reduce((sum, polygon) => sum + polygon.length, 0), areaSteradians: area, marker: entry.microstate });
}
for (const id of ['VAT', 'MCO', 'SMR', 'LIE', 'AND', 'NRU', 'TUV', 'UMI', 'BVT', 'TKL']) {
  assert(report.some((entry) => entry.id === id && entry.areaSteradians > 0));
}
const output = {
  isoCount: expected.length, additionalCount: additional.length, totalCount: allIds.length,
  polygonCount: features.length, missing: [], territories: report,
  complexity,
};
if (process.argv.includes('--write')) {
  await writeFile('data/coverage-report.json', JSON.stringify(output, null, 2) + '\n');
} else {
  const saved = JSON.parse(await readFile('data/coverage-report.json', 'utf8'));
  assert.deepEqual(saved, output, 'Coverage report is stale; regenerate with --write.');
}
console.log(`Coverage verified: ${expected.length} ISO + ${additional.length} additional territories (${allIds.length} total) have real, nondegenerate, renderable polygons.`);
