import { parseBadges, type Badge } from './badges';
import { loadJson } from './geography';
import type { Territory } from './types';

export type BadgeCatalogLoader = () => Promise<readonly Badge[]>;

export function createBadgeCatalog(
  registry: readonly Territory[],
  read: () => Promise<unknown> = () => loadJson('badges.json'),
): BadgeCatalogLoader {
  let pending: Promise<readonly Badge[]> | undefined;
  return () => {
    pending ??= read().then((value) => parseBadges(value, registry)).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
