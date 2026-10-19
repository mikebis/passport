import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { feature, quantize } from 'topojson-client';
import { geoArea, geoMercator, geoPath } from 'd3';
import { presimplify, quantile, simplify, sphericalTriangleArea } from 'topojson-simplify';

export const RETAINED_DETAIL = 0.1;
const sphereArea = 4 * Math.PI;

function polygons(geometry) {
  assert(['Polygon', 'MultiPolygon'].includes(geometry.type), 'Expected polygon geometry.');
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

function ringArea(ring) {
  return geoArea({ type: 'Polygon', coordinates: [ring] });
}

function validRing(original, candidate) {
  if (candidate.length < 4 || new Set(candidate.map(point => point.join(','))).size < 3
    || candidate.some(point => !point.every(Number.isFinite))
    || candidate[0].some((coordinate, index) => coordinate !== candidate.at(-1)[index])) return false;
  const before = ringArea(original);
  const after = ringArea(candidate);
  const originalArea = Math.min(before, sphereArea - before);
  const candidateArea = Math.min(after, sphereArea - after);
  return candidateArea > 0 && (before > sphereArea / 2) === (after > sphereArea / 2)
    && Math.abs(candidateArea - originalArea) <= originalArea * .1;
}

export function geometrySignature(world) {
  return createHash('sha256').update(JSON.stringify(world.objects)).digest('hex');
}

export function geographyMetrics(world) {
  const boundaries = feature(world, world.objects.countries).features;
  const path = geoPath(geoMercator()
    .scale(Math.min(1000 / (2 * Math.PI), 650 / 3.1) * .94).translate([500, 650 * .58]));
  return {
    vertices: world.arcs.reduce((sum, arc) => sum + arc.length, 0),
    polygons: boundaries.reduce((sum, boundary) => sum + polygons(boundary.geometry).length, 0),
    rings: boundaries.reduce((sum, boundary) => sum + polygons(boundary.geometry).reduce((count, polygon) => count + polygon.length, 0), 0),
    pathCharacters: boundaries.reduce((sum, boundary) => sum + path(boundary).length, 0),
    bytes: Buffer.byteLength(JSON.stringify(world)),
  };
}

export function simplifyGeography(world) {
  const weighted = presimplify(world, sphericalTriangleArea);
  const threshold = quantile(weighted, RETAINED_DETAIL);
  const result = simplify(weighted, threshold);
  const originalArcs = simplify(weighted, 0).arcs;
  const protectedArcs = new Set();
  const protect = indexes => {
    for (const index of indexes.flat(Infinity)) {
      const id = index < 0 ? ~index : index;
      protectedArcs.add(id);
      result.arcs[id] = originalArcs[id];
    }
  };
  for (const [name, object] of Object.entries(world.objects)) {
    const originals = feature(world, object).features;
    const candidates = feature(result, result.objects[name]).features;
    for (let index = 0; index < originals.length; index++) {
      const before = originals[index];
      const after = candidates[index];
      const originalPolygons = polygons(before.geometry);
      const candidatePolygons = polygons(after.geometry);
      const geometry = object.geometries[index];
      const arcs = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
      assert.equal(candidatePolygons.length, originalPolygons.length, `${before.id}: lost polygon`);
      originalPolygons.forEach((polygon, polygonIndex) => {
        assert.equal(candidatePolygons[polygonIndex].length, polygon.length, `${before.id}: lost ring`);
        polygon.forEach((ring, ringIndex) => {
          if (!validRing(ring, candidatePolygons[polygonIndex][ringIndex])) {
            protect(arcs[polygonIndex][ringIndex]);
          }
        });
      });
    }
  }
  // Restoring an arc also restores the same border in every neighboring polygon.
  const restored = feature(result, result.objects.countries).features;
  const originals = feature(world, world.objects.countries).features;
  restored.forEach((boundary, index) => {
    const originalArea = geoArea(originals[index]);
    if (Math.abs(geoArea(boundary) - originalArea) > originalArea * .01) {
      protect(world.objects.countries.geometries[index].arcs);
    }
  });
  const output = quantize(result, 1e6);
  const finalFeatures = feature(output, output.objects.countries).features;
  finalFeatures.forEach((boundary, index) => {
    const originalPolygons = polygons(originals[index].geometry);
    polygons(boundary.geometry).forEach((polygon, polygonIndex) => {
      polygon.forEach((ring, ringIndex) => {
        assert(validRing(originalPolygons[polygonIndex][ringIndex], ring), `${boundary.id}: invalid simplified ring`);
      });
    });
    assert(geoArea(boundary) > 0 && geoArea(boundary) < 2 * Math.PI, `${boundary.id}: invalid simplified area`);
    const originalArea = geoArea(originals[index]);
    assert(Math.abs(geoArea(boundary) - originalArea) <= originalArea * .01, `${boundary.id}: excessive area change`);
  });
  assert.equal(geometrySignature(output), geometrySignature(world), 'Simplification changed shared-arc connections or polygon structure.');
  return {
    world: output,
    simplification: {
      method: 'Shared-arc spherical Visvalingam simplification',
      retainedDetail: RETAINED_DETAIL,
      threshold,
      protectedArcs: protectedArcs.size,
      geometrySignature: geometrySignature(world),
      before: geographyMetrics(world),
      after: geographyMetrics(output),
    },
  };
}
