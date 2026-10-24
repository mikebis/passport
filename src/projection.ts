import { geoEqualEarth, geoMercator, type GeoProjection } from 'd3';

export const PROJECTIONS = [
  { id: 'equal-earth', label: 'Equal Earth' },
  { id: 'mercator', label: 'Mercator' },
] as const;
export type ProjectionId = typeof PROJECTIONS[number]['id'];
export const DEFAULT_PROJECTION: ProjectionId = 'equal-earth';
export type MapExtent = [[number, number], [number, number]];

export function findProjection(id: string) {
  return PROJECTIONS.find((projection) => projection.id === id);
}

export function createProjection(id: ProjectionId): GeoProjection {
  switch (id) {
    case 'equal-earth': return geoEqualEarth();
    case 'mercator': return geoMercator();
    default: throw new Error(`Unknown projection: ${String(id)}`);
  }
}

export function fitProjection(id: ProjectionId, extent: MapExtent): GeoProjection {
  // Mercator's automatic square clip bounds the poles at about +/-85.0511 degrees.
  return createProjection(id).fitExtent(extent, { type: 'Sphere' }).clipExtent(extent);
}

export function liveProjection(id: ProjectionId, width: number, height: number): GeoProjection {
  if (id === 'mercator') {
    return createProjection(id).scale(Math.min(width / (2 * Math.PI), height / 3.1) * .94)
      .translate([width / 2, height * .58]);
  }
  const padding = Math.min(width, height) * .03;
  return fitProjection(id, [[padding, padding], [width - padding, height - padding]])
    .clipExtent(null);
}

export function markerPoint(
  projection: GeoProjection, coordinates: [number, number], id: string,
  projectionId: ProjectionId, bottom: number,
): [number, number] {
  const point = projection(coordinates);
  if (!point || !point.every(Number.isFinite)) throw new Error(`Could not project marker for ${id}`);
  if (projectionId === 'mercator' && id === 'ATA') point[1] = Math.min(point[1], bottom);
  return point;
}
