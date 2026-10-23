import { evaluateBadge, type Badge } from './badges';
import { travelStatistics } from './statistics';
import type { LocationEntry, Territory, TravelStatus } from './types';

export const INFOGRAPHIC_FORMATS = {
  horizontal: { id: 'horizontal', label: 'Horizontal', width: 2400, height: 1600, flagLimit: 18 },
  feed: { id: 'feed', label: 'Instagram Feed', width: 1080, height: 1350, flagLimit: 6 },
  story: { id: 'story', label: 'Story', width: 1080, height: 1920, flagLimit: 12 },
} as const;
export type InfographicFormatId = keyof typeof INFOGRAPHIC_FORMATS;
export const DEFAULT_FORMAT: InfographicFormatId = 'horizontal';
export function infographicFormat(id: string) {
  const format = Object.values(INFOGRAPHIC_FORMATS).find((candidate) => candidate.id === id);
  if (!format) throw new Error(`Unknown picture format: ${id}`);
  return format;
}
export const TEXT_LIMITS = { name: 60 } as const;
export interface Personalization { name: string }
export interface FlagGroup {
  id: TravelStatus | 'favourite';
  label: string;
  countries: readonly Territory[];
  total: number;
  hidden: number;
}

export function infographicData(
  registry: readonly Territory[], entries: readonly LocationEntry[], badges: readonly Badge[], formatId: InfographicFormatId = DEFAULT_FORMAT,
) {
  const format = infographicFormat(formatId);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const status = (id: string): TravelStatus => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`Missing infographic territory: ${id}`);
    return entry.status;
  };
  const stats = travelStatistics(registry, status);
  const definitions: readonly { id: FlagGroup['id']; label: string }[] = [
    { id: 'visited', label: 'Visited' }, { id: 'lived', label: 'Lived / Living' },
    { id: 'want_to_visit', label: 'Want to Visit' }, { id: 'favourite', label: 'Favourites' },
  ];
  const groups: FlagGroup[] = definitions.map(({ id, label }) => {
    const countries = registry.filter((country) => id === 'favourite'
      ? byId.get(country.id)?.favourite === true : status(country.id) === id)
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return {
      id, label, countries: countries.slice(0, format.flagLimit),
      total: countries.length, hidden: Math.max(0, countries.length - format.flagLimit),
    };
  });
  const earned = badges.filter((badge) => evaluateBadge(badge.condition, status).earned)
    .sort((a, b) => b.value - a.value);
  return {
    format, stats, groups, status,
    favourites: registry.filter((country) => country.kind === 'iso' && byId.get(country.id)?.favourite === true).length,
    badges: earned.slice(0, 3), earnedCount: earned.length, earnedPoints: earned.reduce((sum, badge) => sum + badge.value, 0),
  };
}
export type InfographicData = ReturnType<typeof infographicData>;

export function validatePersonalization(input: Personalization): Personalization {
  if (Array.from(input.name).length > TEXT_LIMITS.name) throw new Error(`name must be ${TEXT_LIMITS.name} characters or fewer.`);
  return { name: input.name.replace(/\s+/g, ' ').trim() };
}

export function currentAppAddress(origin: string, base: string): string {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || !base.startsWith('/') || base.startsWith('//')) {
    throw new Error('The infographic QR requires an HTTP(S) app address.');
  }
  url.pathname = base;
  url.search = '';
  url.hash = '';
  url.username = '';
  url.password = '';
  if (url.href.length > 512) throw new Error('The app address is too long for a readable QR code (maximum 512 characters).');
  return url.href;
}

export function isLocalAddress(address: string): boolean {
  const host = new URL(address).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host === '::1' || host === '::' || /^(?:fc|fd)[\da-f]{2}:|^fe[89ab][\da-f]:/.test(host)) return true;
  const mapped = host.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
  const octets = mapped ? [parseInt(mapped[1]!, 16) >> 8, parseInt(mapped[1]!, 16) & 255]
    : /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host.split('.').map(Number) : undefined;
  if (octets) {
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b! >= 64 && b! <= 127);
  }
  return !host.includes('.') && !host.includes(':');
}
