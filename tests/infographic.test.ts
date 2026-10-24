import { describe, expect, it, vi } from 'vitest';
import registryJson from '../data/registry.json';
import worldJson from '../data/world-10m.json';
import { createBadgeCatalog } from '../src/badge-catalog';
import { parseBadges } from '../src/badges';
import { decodeWorld, validateRegistry } from '../src/geography';
import { currentAppAddress, DEFAULT_FORMAT, infographicData, infographicFormat, infographicHeading, INFOGRAPHIC_FORMATS, isLocalAddress, TEXT_LIMITS, validatePersonalization } from '../src/infographic';
import { flagAssetUrls, qrSvg } from '../src/infographic-assets';
import { escapeSvg, fitLines, infographicSvg } from '../src/infographic-renderer';
import { normalizeData } from '../src/store';
import type { LocationEntry } from '../src/types';

const registry = validateRegistry(registryJson);
const titleRaster = { href: 'data:image/png;base64,AA==', width: 760, height: 100 };
const definition = { name: 'First steps', description: 'Visit Slovakia.', condition: 'SVK', value: 10 };
const entries = (changes: Partial<LocationEntry>[] = []) => normalizeData(changes.map((entry) => ({
  name: 'test', continent: 'Europe', status: 'unvisited', ...entry,
})), registry);

describe('infographic snapshot model', () => {
  it('uses exact all-place statistics and independent flag groups without modifying the snapshot', () => {
    const snapshot = entries([
      { id: 'SVK', status: 'visited', favourite: true, subdivisions: [{ id: 'SK-BL', name: 'Bratislava', continent: 'Europe', status: 'lived' }] },
      { id: 'AUT', status: 'lived' }, { id: 'CZE', status: 'want_to_visit' },
      { id: 'FRA', favourite: true }, { id: 'custom:KOS', status: 'visited', favourite: true },
      { id: 'ATA', status: 'lived', favourite: true },
    ]);
    const original = structuredClone(snapshot);
    const data = infographicData(registry, snapshot, parseBadges([definition], registry));
    expect(data.stats.counts).toEqual({ visited: 2, lived: 2, want_to_visit: 1, unvisited: 261 });
    expect(data.stats.total).toBe(registry.length);
    expect(data.stats.completed).toBe(4);
    expect(data.stats.percentage).toBe(4 / registry.length * 100);
    expect(data.stats.continentsCompleted).toBe(2);
    expect(data.favourites).toBe(4);
    expect(data.groups.map((group) => group.total)).toEqual([2, 2, 1, 4]);
    expect(data.groups[3]!.countries.map((country) => country.id)).toEqual(['ATA', 'FRA', 'custom:KOS', 'SVK']);
    expect(data.earnedCount).toBe(1);
    expect(data.earnedPoints).toBe(10);
    expect(snapshot).toEqual(original);
  });
  it('limits each alphabetic strip to 18 and reports exact overflow, including all 266 favourites', () => {
    const data = infographicData(registry, entries(registry.map(({ id }) => ({ id, status: 'visited', favourite: true }))), []);
    expect(data.groups[0]!.total).toBe(registry.length);
    expect(data.groups[0]!.countries).toHaveLength(INFOGRAPHIC_FORMATS.horizontal.flagLimit);
    expect(data.groups[0]!.hidden).toBe(registry.length - INFOGRAPHIC_FORMATS.horizontal.flagLimit);
    expect(data.groups[0]!.countries.map((country) => country.name)).toEqual(
      [...registry].sort((a, b) => a.name.localeCompare(b.name, 'en')).slice(0, 18).map((country) => country.name));
    expect(data.favourites).toBe(registry.length);
    expect(data.groups[3]!.total).toBe(266);
  });
  it('uses only earned badges, ranks by points with stable ties and never fabricates three awards', () => {
    const badges = parseBadges([
      definition, { ...definition, name: 'Tied', value: 10 }, { ...definition, name: 'Best', value: 50 },
      { ...definition, name: 'Fourth', value: 2 }, { ...definition, name: 'Not earned', condition: 'FRA', value: 100 },
    ], registry);
    const data = infographicData(registry, entries([{ id: 'SVK', status: 'lived' }]), badges);
    expect(data.badges.map((badge) => badge.name)).toEqual(['Best', 'First steps', 'Tied']);
    expect(data.earnedCount).toBe(4);
    expect(data.earnedPoints).toBe(72);
    const empty = infographicData(registry, entries(), badges);
    expect(empty.badges).toEqual([]);
    expect(empty.earnedPoints).toBe(0);
    expect(empty.groups.every((group) => group.total === 0 && group.hidden === 0)).toBe(true);
    expect(empty.stats.completed).toBe(0);
  });
  it('rejects incomplete snapshot input rather than silently drawing a default status', () => {
    expect(() => infographicData(registry, [], [])).toThrow('Missing infographic territory');
  });
});

describe('picture formats', () => {
  it('defaults to horizontal and rejects unknown formats explicitly', () => {
    expect(DEFAULT_FORMAT).toBe('horizontal');
    expect(infographicData(registry, entries(), []).format.id).toBe('horizontal');
    expect(() => infographicFormat('portrait')).toThrow('Unknown picture format');
    expect(() => infographicFormat('__proto__')).toThrow('Unknown picture format');
  });
  it.each([
    ['horizontal', 2400, 1600, 18], ['feed', 1080, 1350, 6], ['story', 1080, 1920, 12],
  ] as const)('%s has exact output dimensions and presentation limits without changing totals', (id, width, height, limit) => {
    const format = infographicFormat(id);
    expect([format.width, format.height, format.flagLimit]).toEqual([width, height, limit]);
    const snapshot = entries(registry.map(({ id }) => ({ id, status: 'visited', favourite: true })));
    const badges = parseBadges([definition], registry);
    const data = infographicData(registry, snapshot, badges, id);
    expect(data.groups[0]!.countries).toHaveLength(limit);
    expect(data.groups[0]!.total).toBe(266);
    expect(data.groups[0]!.hidden).toBe(266 - limit);
    expect(data.groups[3]!.countries).toHaveLength(limit);
    const horizontal = infographicData(registry, snapshot, badges);
    expect(data.stats).toEqual(horizontal.stats);
    expect(data.favourites).toBe(horizontal.favourites);
    expect(data.badges).toEqual(horizontal.badges);
    expect(data.earnedPoints).toBe(horizontal.earnedPoints);
    for (const quantity of [0, limit, limit + 1]) {
      const limited = infographicData(registry, entries(registry.slice(0, quantity).map(({ id }) => ({ id, status: 'visited' }))), [], id);
      expect(limited.groups[0]!.countries).toHaveLength(Math.min(limit, quantity));
      expect(limited.groups[0]!.hidden).toBe(Math.max(0, quantity - limit));
      expect(limited.groups[0]!.total).toBe(quantity);
    }
  });
  for (const id of ['feed', 'story'] as const) {
    it(`${id} reflows all geography, sections and bounded strings into the portrait canvas`, () => {
      const format = INFOGRAPHIC_FORMATS[id];
      const data = infographicData(registry, entries(registry.map(({ id }) => ({ id, status: 'visited', favourite: true }))), parseBadges([definition], registry), id);
      const flags = new Map(registry.flatMap((country) => country.kind === 'iso' ? [[country.alpha2, 'data:image/svg+xml,%3Csvg%2F%3E'] as const] : []));
      const svg = infographicSvg({
        data, registry, countries: decodeWorld(worldJson, registry).countries,
        personal: { name: '<Traveller>' }, address: 'https://example.test/',
      }, flags, (value, size) => value.length * size * .6, titleRaster);
      expect(svg).toContain(`width="1080" height="${format.height}" viewBox="0 0 1080 ${format.height}"`);
      expect(svg.match(/data-country="/g)).toHaveLength(266);
      expect(svg.match(/data-flag-group="/g)).toHaveLength(4);
      expect(svg).toContain(`>${registry.length}/${registry.length}</text>`);
      expect(svg).toContain('>7/7</text>');
      expect(svg).toContain(`>+${266 - format.flagLimit} more</text>`);
      expect(svg).toContain('First steps');
      expect(svg).toContain('>10 points</text>');
      expect(svg).not.toContain('data-handwritten-name');
      expect(svg).not.toContain('Prepared for');
      expect(svg).not.toContain('Every journey leaves a story.');
      expect(svg).toContain('data-handwritten-title="&lt;Traveller&gt;\u2019s Travel Passport"');
      expect(svg).toContain(`transform="translate(732,${id === 'feed' ? 970 : 1370})"`);
      expect(svg).toContain('width="300" height="300"');
      expect(svg).toContain('QR opens the app, not your personal map.');
      expect(svg.match(/data-decoration="metric-icon"/g)).toHaveLength(6);
      expect(svg.match(/data-decoration="badge-sticker"/g)).toHaveLength(data.badges.length);
      expect(svg.match(/data-decoration="tape"/g)).toHaveLength(4);
      expect(svg).toContain('data-decoration="postcard"');
      expect(svg).not.toContain('data-decoration="passport"');
      expect(svg).toContain('data-handwritten-title=');
      expect(svg).toContain('transform="rotate(-2 ');
      expect(svg).not.toContain('transform="rotate(-1.2 ');
      expect(svg).not.toContain('foreignObject');
      expect(svg.match(/data-flag="/g)).toHaveLength(data.groups.flatMap((group) => group.countries).filter((country) => country.kind === 'iso').length);
    });
  }
  it('repositions QR modules without changing their pattern or quiet zone', () => {
    const qr = qrSvg('https://example.test/');
    const portrait = qrSvg('https://example.test/', { x: 732, y: 970, size: 300 });
    expect(portrait).toBe(qr.replace('translate(1990,80)', 'translate(732,970)'));
    expect(() => qrSvg('https://example.test/', { x: 0, y: 0, size: 30 })).toThrow('too long');
  });
});

describe('shared badge loading', () => {
  it('coalesces concurrent loads and caches a validated catalog, including an empty one', async () => {
    const read = vi.fn(async () => []);
    const load = createBadgeCatalog(registry, read);
    const first = load();
    expect(load()).toBe(first);
    expect(await first).toEqual([]);
    await load();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('retries after invalid catalogs and network failures without caching false empty success', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce([{ ...definition, condition: 'GER' }])
      .mockResolvedValue([definition]);
    const load = createBadgeCatalog(registry, read);
    await expect(load()).rejects.toThrow('Offline');
    await expect(load()).rejects.toThrow('GER');
    expect(await load()).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe('picture personalization and fixed QR address', () => {
  it.each([
    ['', 'My Travel Passport'], [' \n ', 'My Travel Passport'],
    [' Alex  Morgan ', 'Alex Morgan\u2019s Travel Passport'],
    ['James', 'James\u2019 Travel Passport'], ['CHRIS', 'CHRIS\u2019 Travel Passport'],
    ['Zo\u00eb <Traveller>', 'Zo\u00eb <Traveller>\u2019s Travel Passport'],
    ['\u{1f30d}'.repeat(60), `${'\u{1f30d}'.repeat(60)}\u2019s Travel Passport`],
  ])('composes the possessive heading for %j', (name, heading) => {
    expect(infographicHeading({ name })).toBe(heading);
  });
  it('normalizes the optional name and bounds its Unicode character count', () => {
    expect(validatePersonalization({ name: '  A\nTraveller  ' })).toEqual({ name: 'A Traveller' });
    expect(validatePersonalization({ name: ' ' })).toEqual({ name: '' });
    expect(() => validatePersonalization({ name: 'W'.repeat(TEXT_LIMITS.name + 1) })).toThrow('name');
    expect(validatePersonalization({ name: '\u{1f30d}'.repeat(60) }).name).toHaveLength(120);
  });
  it('uses only the app origin/base, never incidental query/hash, credentials or an editable override', () => {
    expect(currentAppAddress('https://example.test', '/')).toBe('https://example.test/');
    expect(currentAppAddress('https://example.test/a?secret=123#map', '/passport-test/')).toBe('https://example.test/passport-test/');
    expect(currentAppAddress('https://name:password@example.test', '/')).toBe('https://example.test/');
    expect(() => currentAppAddress('file:///atlas', '/')).toThrow('HTTP(S)');
    expect(() => currentAppAddress('https://example.test', '//other.example/')).toThrow('HTTP(S)');
    expect(() => currentAppAddress('https://example.test', `/${'x'.repeat(512)}`)).toThrow('too long');
  });
  it.each(['localhost', 'demo.localhost', '127.0.0.1', '10.1.2.3', '172.16.2.1', '172.31.0.1', '192.168.1.1', '169.254.2.1', '[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:127.0.0.1]', '[::ffff:192.168.1.1]', 'atlas.local', 'atlas'])('warns about local/private QR host %s', (host) => {
    expect(isLocalAddress(`http://${host}/passport/`)).toBe(true);
  });
  it.each(['example.com', '172.15.0.1', '172.32.0.1', '8.8.8.8', '[2606:4700:4700::1111]', '[::ffff:8.8.8.8]'])('does not claim public host %s is local', (host) => {
    expect(isLocalAddress(`https://${host}/`)).toBe(false);
  });
});

describe('self-contained infographic artwork', () => {
  it.each(['horizontal', 'feed', 'story'] as const)('%s centers and bounds a long QR URL label without changing the QR', (format) => {
    const address = `https://example.test/${'long-path-'.repeat(35)}/`;
    const svg = infographicSvg({
      data: infographicData(registry, entries(), [], format), registry,
      countries: decodeWorld(worldJson, registry).countries, personal: { name: '' }, address,
    }, new Map(), (value, size) => value.length * size * .6, titleRaster);
    const label = svg.match(/font-size="(\d+)" data-qr-url="" text-anchor="middle">([^<]+)<\/text>/)!;
    expect(label).not.toBeNull();
    expect(label[2]).toMatch(/\u2026$/);
    expect(label[2]!.length * Number(label[1]) * .6).toBeLessThanOrEqual(300);
    expect(svg).toContain(qrSvg(address, { x: format === 'horizontal' ? 1990 : 732, y: format === 'horizontal' ? 100 : format === 'feed' ? 970 : 1370, size: 300 }));
  });
  it.each(['horizontal', 'feed', 'story'] as const)('%s keeps the fixed title without a name placeholder when blank', (format) => {
    const svg = infographicSvg({
      data: infographicData(registry, entries(), [], format), registry,
      countries: decodeWorld(worldJson, registry).countries, personal: { name: '' }, address: 'https://example.test/',
    }, new Map(), (value, size) => value.length * size * .6, titleRaster);
    expect(svg).toContain('data-handwritten-title="My Travel Passport"');
    expect(svg).not.toContain('data-handwritten-name');
    expect(svg).not.toContain('Prepared for');
    expect(svg).not.toContain('Every journey leaves a story.');
    expect(svg).toContain('>Scan to create yours!</text>');
    expect(svg).not.toContain('SCAN TO OPEN THE APP');
    expect(svg).not.toContain('ISO countries and territories only');
    expect(svg).not.toContain('Flags also include additional places');
    const center = format === 'horizontal' ? 2140 : 882;
    expect(svg).toContain(`x="${center}" y="${format === 'horizontal' ? 447 : format === 'feed' ? 1312 : 1712}" font-size="${format === 'horizontal' ? 16 : 12}" data-qr-url="" text-anchor="middle"`);
    expect(svg.match(/data-country="/g)).toHaveLength(266);
    expect(svg.match(/data-flag-group="/g)).toHaveLength(4);
  });
  it('has a locally bundled flag for every ISO territory without inventing custom flags', () => {
    for (const country of registry) if (country.kind === 'iso') expect(flagAssetUrls.has(country.alpha2), country.id).toBe(true);
    expect(flagAssetUrls.has('custom:KOS')).toBe(false);
  });
  it('escapes text and fits long unbroken words within measured bounds', () => {
    expect(escapeSvg('<script>"&\'')).toBe('&lt;script&gt;&quot;&amp;&apos;');
    const measure = (value: string, size: number) => Array.from(value).length * size;
    const lines = fitLines('W'.repeat(50), 100, 20, 2, measure);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('\u2026');
    expect(lines.every((line) => measure(line, 20) <= 100)).toBe(true);
  });
  it('renders the full geometry, accurate labels, escaped personalization, neutral custom symbols and a QR', () => {
    const data = infographicData(registry, entries([{ id: 'SVK', status: 'visited' }, { id: 'custom:KOS', favourite: true }]), parseBadges([definition], registry));
    const svg = infographicSvg({
      data, registry, countries: decodeWorld(worldJson, registry).countries,
      personal: { name: '<script> "Traveller"' }, address: 'https://example.test/',
    }, new Map([['SK', 'data:image/svg+xml,%3Csvg%2F%3E']]), (value, size) => value.length * size * .6, titleRaster);
    expect(svg).toContain('width="2400" height="1600"');
    expect(svg.match(/data-country="/g)).toHaveLength(266);
    expect(svg).toContain('data-country="ATA"');
    expect(svg).toContain('data-country="SVK" data-status="visited"');
    expect(svg).toContain('&lt;script&gt; &quot;Traveller&quot;');
    expect(svg).not.toContain('Prepared for');
    expect(svg).not.toContain('Every journey leaves a story.');
    expect(svg).toContain('data-handwritten-title="&lt;script&gt; &quot;Traveller&quot;\u2019s Travel Passport"');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('data-flag="SVK"');
    expect(svg).not.toContain('data-flag="custom:KOS"');
    expect(svg).toContain('>KOS</text>');
    expect(svg).toContain('First steps');
    expect(svg).toContain(`>1/${registry.length}</text>`);
    expect(svg).toContain('QR links to the app, not this personal map.');
    expect(svg).not.toContain('foreignObject');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('data-decoration="scrapbook"');
    expect(svg.match(/data-decoration="postcard"/g)!.length).toBeGreaterThan(6);
    expect(svg.match(/data-decoration="metric-icon"/g)).toHaveLength(6);
    expect(svg.match(/data-decoration="badge-sticker"/g)).toHaveLength(data.badges.length);
    expect(svg.match(/data-decoration="tape"/g)).toHaveLength(5);
    expect(svg).not.toContain('data-decoration="passport"');
    expect(svg).toContain('data-decoration="stamp"');
    expect(svg).not.toContain('data-handwritten-name');
    expect(svg).toContain('transform="rotate(-2 ');
    expect(svg).not.toContain('transform="rotate(-1.2 ');
    expect(svg).toContain('fill="url(#water)"');
    expect(svg).not.toContain('<filter');
    expect(svg).not.toContain('<script');
    expect(() => qrSvg('a'.repeat(2000))).toThrow();
  });
});
