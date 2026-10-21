import { CONTINENTS, isCompletedStatus, type Continent, type Territory, type TravelStatus } from './types';

export function continentProgress(
  registry: readonly Territory[],
  status: (id: string) => TravelStatus,
): Map<Continent, { completed: number; total: number }> {
  const progress = new Map<Continent, { completed: number; total: number }>(
    ([...CONTINENTS, 'Antarctica'] as const).map((continent) => [continent, { completed: 0, total: 0 }]),
  );
  for (const country of registry) {
    if (country.kind !== 'iso') continue;
    const count = progress.get(country.continent)!;
    count.total++;
    if (isCompletedStatus(status(country.id))) count.completed++;
  }
  return progress;
}

export function travelStatistics(registry: readonly Territory[], status: (id: string) => TravelStatus) {
  const counts: Record<TravelStatus, number> = { visited: 0, lived: 0, want_to_visit: 0, unvisited: 0 };
  for (const country of registry) if (country.kind === 'iso') counts[status(country.id)]++;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const completed = counts.visited + counts.lived;
  const continents = continentProgress(registry, status);
  return {
    counts, total, completed, percentage: total ? completed / total * 100 : 0, continents,
    continentsCompleted: [...continents.values()].filter((count) => count.completed > 0).length,
  };
}

export function formatPercentage(value: number): string {
  return `${value.toLocaleString('en', { maximumFractionDigits: 1 })}%`;
}
