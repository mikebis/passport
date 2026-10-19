import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { CONTINENTS, type Continent, type Territory } from './types';
import additionalCatalog from '../data/additional-territories.json';

export type BoundaryProperties = { id?: string; name?: string };
export type Boundaries = FeatureCollection<Polygon | MultiPolygon, BoundaryProperties>;
type WorldTopology = Topology<{
  countries: GeometryCollection<BoundaryProperties>;
  background: GeometryCollection<BoundaryProperties>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContinent(value: unknown): value is Continent {
  return typeof value === 'string' && [...CONTINENTS, 'Antarctica'].some((continent) => continent === value);
}

export function validateRegistry(value: unknown): Territory[] {
  if (!Array.isArray(value) || value.length !== 249 + additionalCatalog.length) {
    throw new Error('The territory registry must contain all 249 ISO entries and every configured additional territory.');
  }
  const ids = new Set<string>();
  const alpha2Codes = new Set<string>();
  const customIds = new Set(additionalCatalog.map((entry) => entry.id));
  let isoCount = 0;
  const result = value.map((entry: unknown): Territory => {
    if (!isRecord(entry) || typeof entry.id !== 'string'
      || typeof entry.name !== 'string' || !entry.name.trim()
      || !isContinent(entry.continent)
      || !Array.isArray(entry.marker) || entry.marker.length !== 2
      || !entry.marker.every((coordinate: unknown) => typeof coordinate === 'number' && Number.isFinite(coordinate))
      || typeof entry.marker[0] !== 'number' || typeof entry.marker[1] !== 'number'
      || Math.abs(entry.marker[0]) > 180 || Math.abs(entry.marker[1]) > 85
      || typeof entry.microstate !== 'boolean') {
      throw new Error('The territory registry contains an invalid entry.');
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate registry entry: ${entry.id}`);
    ids.add(entry.id);
    const marker: [number, number] = [entry.marker[0], entry.marker[1]];
    const common = {
      id: entry.id, name: entry.name, continent: entry.continent,
      marker, microstate: entry.microstate,
    };
    if (entry.kind === 'iso' && /^[A-Z]{3}$/.test(entry.id)
      && typeof entry.alpha2 === 'string' && /^[A-Z]{2}$/.test(entry.alpha2)) {
      if (alpha2Codes.has(entry.alpha2)) throw new Error(`Duplicate registry flag code: ${entry.alpha2}`);
      alpha2Codes.add(entry.alpha2);
      isoCount++;
      return { ...common, kind: 'iso', alpha2: entry.alpha2 };
    }
    if (entry.kind === 'custom' && customIds.has(entry.id) && entry.alpha2 === undefined) {
      const catalog = additionalCatalog.find((item) => item.id === entry.id);
      if (!catalog || entry.name !== catalog.name || entry.continent !== catalog.continent) {
        throw new Error(`Additional territory metadata does not match the catalog: ${entry.id}`);
      }
      return { ...common, kind: 'custom' };
    }
    throw new Error(`Invalid territory identifier or flag code: ${entry.id}`);
  });
  if (isoCount !== 249 || result.filter((entry) => entry.kind === 'custom').length !== customIds.size) {
    throw new Error('The territory registry must contain all 249 ISO entries and every configured additional territory.');
  }
  return result;
}

export async function loadJson(filename: string): Promise<unknown> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${filename}`);
  if (!response.ok) throw new Error(`Could not load ${filename} (HTTP ${response.status}).`);
  return response.json();
}

function isWorldTopology(value: unknown): value is WorldTopology {
  return isRecord(value) && value.type === 'Topology' && isRecord(value.objects)
    && isRecord(value.objects.countries) && isRecord(value.objects.background)
    && value.objects.countries.type === 'GeometryCollection' && value.objects.background.type === 'GeometryCollection'
    && Array.isArray(value.objects.countries.geometries) && Array.isArray(value.objects.background.geometries)
    && Array.isArray(value.arcs);
}

function isPolygonFeature(boundary: Feature<Geometry | null, BoundaryProperties>): boundary is Feature<Polygon | MultiPolygon, BoundaryProperties> {
  return boundary.geometry?.type === 'Polygon' || boundary.geometry?.type === 'MultiPolygon';
}

export function decodeWorld(value: unknown, registry: readonly Territory[]): { countries: Boundaries; background: Boundaries } {
  if (!isWorldTopology(value)) {
    throw new Error('The geographic asset is not a valid world topology.');
  }
  const decodedCountries = feature(value, value.objects.countries);
  const decodedBackground = feature(value, value.objects.background);
  if (!decodedCountries.features.every(isPolygonFeature) || !decodedBackground.features.every(isPolygonFeature)) {
    throw new Error('The geographic asset contains non-polygon geometry.');
  }
  const countries: Boundaries = { type: 'FeatureCollection', features: decodedCountries.features };
  const background: Boundaries = { type: 'FeatureCollection', features: decodedBackground.features };
  const ids = new Set(countries.features.map((boundary) => boundary.id));
  if (ids.size !== registry.length || countries.features.length !== registry.length
    || registry.some((entry) => !ids.has(entry.id))) {
    throw new Error('The map is missing required ISO territory polygons.');
  }
  return { countries, background };
}
