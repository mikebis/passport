import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { topology } from 'topojson-server';
import { feature as decodeFeature } from 'topojson-client';
import { geoArea, geoCentroid } from 'd3';
import iso from 'i18n-iso-countries';
import { RETAINED_DETAIL, simplifyGeography } from './simplify-geography.mjs';
import { correctCrimea } from './correct-crimea.mjs';

const earthRevision = 'ca96624a56bd078437bca8184e78163e5039ad19';
const countriesRevision = 'c2ac0049c14edcf2436c7aa1b2493222a020b462';
const earthUrl = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${earthRevision}/geojson/ne_10m_admin_0_map_units.geojson`;
const registryUrl = `https://raw.githubusercontent.com/mledoze/countries/${countriesRevision}/countries.json`;
await mkdir('.data-cache', { recursive: true });
await mkdir('data', { recursive: true });

async function acquire(url, filename) {
  const path = `.data-cache/${filename}`;
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot acquire ${url}: ${response.status}`);
  const text = await response.text();
  await writeFile(path, text);
  return text;
}

const world = JSON.parse(await acquire(earthUrl, `earth-${earthRevision}.json`));
const countries = JSON.parse(await acquire(registryUrl, `countries-${countriesRevision}.json`));
const additional = JSON.parse(await readFile('data/additional-territories.json', 'utf8'));
const additionalBySource = new Map(additional.map((entry) => [entry.sourceId, entry]));
const continents = new Set(['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America']);
if (additional.length !== 17 || additionalBySource.size !== additional.length
  || new Set(additional.map((entry) => entry.id)).size !== additional.length
  || additional.some((entry) => !/^[A-Z]{3}$/.test(entry.sourceId)
    || entry.id !== `custom:${entry.sourceId}` || typeof entry.name !== 'string'
    || !entry.name.trim() || !continents.has(entry.continent))) {
  throw new Error('Invalid additional-territory catalog.');
}
// XK is a user-assigned code, not an official ISO 3166-1 entry.
const official = new Set(Object.entries(iso.getAlpha2Codes()).filter(([code]) => code !== 'XK').map(([, code]) => code));
const countryMetadata = countries.filter((country) => official.has(country.cca3));
if (countryMetadata.length !== official.size) throw new Error('ISO metadata is incomplete.');

const grouped = new Map();
const background = [];
const customSources = new Map();
for (const source of world.features) {
  // Natural Earth codes the nine UMI map units as USA; retain their ISO identity.
  const id = source.properties.ADM0_A3 === 'UMI' ? 'UMI' : source.properties.ISO_A3_EH;
  if (!official.has(id)) {
    const sourceId = source.properties.GU_A3;
    if (!additionalBySource.has(sourceId) || customSources.has(sourceId)) {
      throw new Error(`Unexpected or duplicate non-ISO map unit: ${sourceId}`);
    }
    customSources.set(sourceId, source);
    continue;
  }
  const polygons = source.geometry.type === 'Polygon'
    ? [source.geometry.coordinates]
    : source.geometry.coordinates;
  const existing = grouped.get(id) || [];
  existing.push(...polygons);
  grouped.set(id, existing);
}

const features = [];
const registry = [];
function geographicMetadata(boundary) {
  const centroid = geoCentroid(boundary);
  const marker = [centroid[0], Math.max(-78, Math.min(80, centroid[1]))];
  if (boundary.id === 'ATA') marker.splice(0, 2, 18, -76);
  return {
    marker,
    microstate: geoArea(boundary) < 0.00008 || ['VAT', 'MCO', 'SMR', 'LIE', 'AND', 'NRU', 'TUV', 'ATA'].includes(boundary.id),
  };
}
for (const country of countryMetadata.sort((a, b) => a.cca3.localeCompare(b.cca3))) {
  const id = country.cca3;
  const polygons = grouped.get(id);
  if (!polygons?.length) throw new Error(`Missing real polygon: ${id}`);
  const feature = {
    type: 'Feature', id, properties: { id },
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  };
  features.push(feature);
  let continent = country.region;
  if (continent === 'Americas') {
    continent = country.subregion === 'South America' ? 'South America' : 'North America';
  }
  if (country.region === 'Antarctic' || id === 'ATA') continent = id === 'ATA' ? 'Antarctica' : 'Oceania';
  // Each territory appears once. Southern ocean dependencies use the nearest
  // supported group rather than introducing a seventh accordion.
  if (id === 'BVT') continent = 'Africa';
  if (id === 'SGS') continent = 'South America';
  registry.push({
    id, kind: 'iso', alpha2: country.cca2, name: country.name.common, continent,
    ...geographicMetadata(feature),
  });
}

for (const entry of additional) {
  const source = customSources.get(entry.sourceId);
  if (!source) throw new Error(`Missing additional-territory polygon: ${entry.id}`);
  const boundary = {
    type: 'Feature', id: entry.id, properties: { id: entry.id },
    geometry: source.geometry,
  };
  features.push(boundary);
  registry.push({
    id: entry.id, kind: 'custom', name: entry.name, continent: entry.continent,
    ...geographicMetadata(boundary),
  });
}

const detailed = correctCrimea(topology({
  countries: { type: 'FeatureCollection', features },
  background: { type: 'FeatureCollection', features: background },
}, 1e6));
for (const id of ['UKR', 'RUS']) {
  const geometry = detailed.objects.countries.geometries.find((entry) => entry.id === id);
  Object.assign(registry.find((entry) => entry.id === id), geographicMetadata(decodeFeature(detailed, geometry)));
}
const { world: result, simplification } = simplifyGeography(detailed);
await writeFile('data/world-10m.json', JSON.stringify(result));
await writeFile('data/registry.json', JSON.stringify(registry, null, 2) + '\n');

try {
  await readFile('data/user-data.json');
  console.log('Preserved existing data/user-data.json.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await writeFile('data/user-data.json', JSON.stringify(registry.map(({ id, name, continent }) => ({
    id, name, continent, status: 'unvisited',
  })), null, 2) + '\n');
}
await writeFile('data/COUNTRIES-LICENSE.txt',
  await acquire(`https://raw.githubusercontent.com/mledoze/countries/${countriesRevision}/LICENSE`, `license-${countriesRevision}.txt`));
await writeFile('data/provenance.json', JSON.stringify({
  boundaries: { source: earthUrl, revision: earthRevision, license: 'Public domain', website: 'https://www.naturalearthdata.com/about/terms-of-use/' },
  registry: { source: registryUrl, revision: countriesRevision, license: 'ODbL-1.0', attribution: 'Country metadata derived from mledoze/countries; derived registry available under ODbL-1.0.' },
  transformations: [
    'Group ISO_A3_EH features; override ADM0_A3=UMI to UMI.',
    'Assign the Crimean peninsula, including Sevastopol, to UKR instead of RUS; merge its existing arcs with mainland Ukraine before simplification to remove the internal border. Preserve all other boundary assignments.',
    'Promote exactly the 17 GU_A3 map units in additional-territories.json with custom: source IDs.',
    'Render custom polygons after ISO polygons to preserve selectable source overlays; statuses are independent.',
    'Additional Cypriot areas use Europe to match the existing CYP registry entry. All additions are non-ISO travel entries, not recognition claims.',
    `Simplify shared arcs with spherical Visvalingam weights, targeting ${RETAINED_DETAIL * 100}% retained detail; quantize at 1e6.`,
    'Preserve every polygon and hole. Restore shared arcs if a ring collapses, changes winding or exceeds 10% area change; protect features exceeding 1% area change.',
    'Compute markers and microstate eligibility from unsimplified geometry, using the corrected UKR/RUS boundaries. Never synthesize polygons.',
    'Use one continent per territory; Americas split by subregion; BVT Africa, SGS South America, other southern dependencies Oceania.',
    'Clamp marker latitude to [-78,80]; Antarctica marker at [18,-76].',
  ],
  simplification,
}, null, 2) + '\n');
console.log(JSON.stringify(simplification, null, 2));
console.log(`Generated ${countryMetadata.length} ISO and ${additional.length} additional polygon features (${features.length} total).`);
