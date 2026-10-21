export type TravelStatus = 'unvisited' | 'visited' | 'lived' | 'want_to_visit';

export function isCompletedStatus(status: TravelStatus): boolean {
  return status === 'visited' || status === 'lived';
}

export interface LocationEntry {
  id: string;
  name: string;
  continent: string;
  status: TravelStatus;
  subdivisions?: LocationEntry[];
  updatedAt?: string;
}

export const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'] as const;
export type Continent = (typeof CONTINENTS)[number] | 'Antarctica';

interface TerritoryBase {
  id: string;
  name: string;
  continent: Continent;
  marker: [number, number];
  microstate: boolean;
}

export interface IsoTerritory extends TerritoryBase {
  kind: 'iso';
  alpha2: string;
}

export interface AdditionalTerritory extends TerritoryBase {
  kind: 'custom';
  alpha2?: never;
}

export type Territory = IsoTerritory | AdditionalTerritory;
export const NON_ISO_LABEL = 'Additional territory \u00b7 non-ISO';

export const STATUSES: readonly TravelStatus[] = ['visited', 'lived', 'want_to_visit', 'unvisited'];
export const STATUS_LABELS: Record<TravelStatus, string> = {
  visited: 'Visited',
  lived: 'Lived / Living',
  want_to_visit: 'Want to Visit',
  unvisited: 'Unvisited',
};

export interface SelectionAnchor {
  x: number;
  y: number;
  trigger: Element;
}

export type SelectTerritory = (id: string, anchor: SelectionAnchor) => void;

export function flag(alpha2: string): string {
  return String.fromCodePoint(...[...alpha2].map((letter) => 127397 + letter.charCodeAt(0)));
}

export function territorySymbol(territory: Territory): string {
  return territory.kind === 'iso' ? flag(territory.alpha2) : '\u25ce';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
