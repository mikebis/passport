import { geoNaturalEarth1, geoPath } from 'd3';
import type { Boundaries } from './geography';
import { loadInfographicFlags, qrSvg } from './infographic-assets';
import { INFOGRAPHIC_HEIGHT, INFOGRAPHIC_WIDTH, validatePersonalization, type InfographicData, type Personalization } from './infographic';
import { formatPercentage } from './statistics';
import { STATUSES, type Territory, type TravelStatus } from './types';

const PALETTE: Record<TravelStatus, string> = {
  visited: '#62a574', lived: '#e4b755', want_to_visit: '#a28ac0', unvisited: '#dcd8ca',
};
const PAPER_DEFS = '<defs><linearGradient id="paper" x2="1" y2="1"><stop stop-color="#fbf3df"/><stop offset="1" stop-color="#e6d2ab"/></linearGradient><pattern id="grain" width="43" height="37" patternUnits="userSpaceOnUse"><path d="m4 7 3 1m20 12 5-1M10 30l4-1" stroke="#967748" stroke-opacity=".09"/><circle cx="36" cy="8" r=".8" fill="#967748" opacity=".14"/></pattern></defs>';
const LEGEND_LABELS = ['Visited', 'Lived / Living', 'Want to Visit', 'Unvisited'];
type Measure = (text: string, size: number, serif?: boolean) => number;
export interface InfographicSource {
  data: InfographicData;
  countries: Boundaries;
  registry: readonly Territory[];
  personal: Personalization;
  address: string;
}
export function escapeSvg(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

export function fitLines(text: string, width: number, size: number, count: number, measure: Measure, serif = false): string[] {
  const lines: string[] = [];
  let line = '';
  for (const character of Array.from(text)) {
    if (measure(line + character, size, serif) > width && line) {
      const space = line.lastIndexOf(' ');
      if (space > 0 && lines.length < count - 1) {
        lines.push(line.slice(0, space));
        line = line.slice(space + 1);
      } else {
        lines.push(line.trim());
        line = '';
      }
    }
    line += character;
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.length <= count) return lines;
  const result = lines.slice(0, count);
  let last = result[count - 1]!;
  while (last && measure(`${last}\u2026`, size, serif) > width) last = Array.from(last).slice(0, -1).join('');
  result[count - 1] = `${last.trimEnd()}\u2026`;
  return result;
}

function text(value: string, x: number, y: number, size: number, extra = ''): string {
  return `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${escapeSvg(value)}</text>`;
}
function multiline(value: string, x: number, y: number, width: number, size: number, lines: number, measure: Measure, serif = false): string {
  return fitLines(value, width, size, lines, measure, serif).map((line, index) =>
    text(line, x, y + index * size * 1.22, size, serif ? 'font-family="Georgia,serif"' : '')).join('');
}
function compass(x: number, y: number, size: number): string {
  return `<g transform="translate(${x},${y}) scale(${size / 100})" fill="none" stroke="#9c7943" stroke-width="1.5">
    <circle r="45"/><circle r="39"/><path d="M0-57V57M-57 0H57M-34-34l68 68M-34 34l68-68" opacity=".5"/>
    <path d="M0-42 9-9 42 0 9 9 0 42-9 9-42 0-9-9Z" fill="#9c7943" fill-opacity=".24"/>
    <path d="M0-42 0 0 9-9ZM42 0 0 0 9 9ZM0 42 0 0-9 9ZM-42 0 0 0-9-9Z" fill="#365363"/>
    <circle r="4" fill="#365363"/></g>`;
}
function medallion(x: number, y: number, index: number): string {
  const icons = [
    '<path d="m0-27 8 18 20 2-15 14 4 21-17-11-17 11 4-21-15-14 20-2Z" fill="#e1b965" stroke="#fff0c2" stroke-width="2"/>',
    '<circle r="26" fill="none" stroke="#e1b965" stroke-width="3"/><path d="M-26 0H26M0-26C-17-13-17 13 0 26M0-26C17-13 17 13 0 26M-21-14H21M-21 14H21" fill="none" stroke="#e1b965" stroke-width="2"/>',
    '<path d="m0-28 9 20 20 8-20 9-9 20-9-20-20-9 20-8Z" fill="#e1b965"/><path d="m0-20 5 15 15 5-15 5-5 15Z" fill="#f7e9bf"/>',
  ];
  return `<g transform="translate(${x},${y})"><path d="m-34 29-8 44 24-12 16 17 9-49M8 29l13 48 15-18 23 10-19-43" fill="#9a604e" stroke="#744b3f" stroke-width="2"/>
    <path d="M0-55 38-39 53 0 38 39 0 55-38 39-53 0-38-39Z" fill="#bf9650" stroke="#704f2b" stroke-width="3"/>
    <circle r="43" fill="#294957" stroke="#f3d18b" stroke-width="3"/>${icons[index % icons.length]}</g>`;
}

function summaryMetrics(data: InfographicData): [string, string][] {
  return [
    [String(data.stats.counts.visited), 'Visited'],
    [String(data.stats.counts.lived), 'Lived / Living'],
    [String(data.stats.counts.want_to_visit), 'Want to Visit'],
    [String(data.favourites), 'Favourites'],
    [`${data.stats.completed}/${data.stats.total}`, `Visited or lived \u00b7 ${formatPercentage(data.stats.percentage)}`],
    [`${data.stats.continentsCompleted}/${data.stats.continents.size}`, 'Continents explored'],
  ];
}

function worldMap(source: InfographicSource, extent: [[number, number], [number, number]]): string {
  const { data, countries, registry } = source;
  const projection = geoNaturalEarth1().fitExtent(extent, countries);
  const path = geoPath(projection);
  const pieces = ['<g id="infographic-map">'];
  for (const boundary of countries.features) {
    const id = String(boundary.id);
    const geometry = path(boundary);
    if (!geometry) throw new Error(`Could not render infographic boundary ${id}.`);
    pieces.push(`<path data-country="${escapeSvg(id)}" data-status="${data.status(id)}" d="${geometry}" fill="${PALETTE[data.status(id)]}" stroke="#faf5e8" stroke-width=".8" stroke-linejoin="round"/>`);
  }
  for (const country of registry.filter((entry) => entry.microstate)) {
    const position = projection(country.marker);
    if (!position) throw new Error(`Could not render infographic marker ${country.id}.`);
    pieces.push(`<circle cx="${position[0]}" cy="${position[1]}" r="2.3" fill="${PALETTE[data.status(country.id)]}" stroke="#faf5e8" stroke-width=".7"/>`);
  }
  return `${pieces.join('')}</g>`;
}

function flagImages(
  countries: readonly Territory[], flags: ReadonlyMap<string, string>, x: number, y: number,
  columns: number, columnStep = 55, rowStep = 48,
): string {
  return countries.map((country, index) => {
    const fx = x + index % columns * columnStep;
    const fy = y + Math.floor(index / columns) * rowStep;
    if (country.kind === 'iso') {
      const asset = flags.get(country.alpha2);
      if (!asset) throw new Error(`Missing rendered flag for ${country.id}.`);
      return `<image data-flag="${country.id}" x="${fx}" y="${fy}" width="44" height="33" href="${escapeSvg(asset)}" xlink:href="${escapeSvg(asset)}"/>`;
    }
    return `<rect x="${fx}" y="${fy}" width="44" height="33" rx="3" fill="#dfd3b7" stroke="#9c8c6d"/>`
      + text(country.id.replace('custom:', ''), fx + 22, fy + 22, 14, 'text-anchor="middle"');
  }).join('');
}

function portraitSvg(source: InfographicSource, flags: ReadonlyMap<string, string>, measure: Measure): string {
  const { data, address } = source;
  const { format } = data;
  const personal = validatePersonalization(source.personal);
  const story = format.id === 'story';
  const layout = story ? {
    eyebrow: 184, title: 236, titleSize: 48, name: 337, subtitle: 373, divider: 400,
    stats: 448, statsStep: 88, valueSize: 44, labelOffset: 30, progress: 580, isoNote: 610,
    mapTitle: 636, mapY: 650, mapHeight: 380, legend: 1057,
    flags: 1080, flagHeight: 126, flagGap: 14,
    badgeHeading: 1400, badgeY: 1440, badgeStep: 80, badgeSize: 22, pointsOffset: 52,
    earned: 1680, qrY: 1370, privacy: 1701, source: 1718,
  } : {
    eyebrow: 54, title: 100, titleSize: 38, name: 180, subtitle: 209, divider: 226,
    stats: 262, statsStep: 64, valueSize: 35, labelOffset: 26, progress: 358, isoNote: 382,
    mapTitle: 402, mapY: 414, mapHeight: 322, legend: 758,
    flags: 782, flagHeight: 82, flagGap: 12,
    badgeHeading: 1019, badgeY: 1044, badgeStep: 74, badgeSize: 20, pointsOffset: 48,
    earned: 1267, qrY: 970, privacy: 1293, source: 1316,
  };
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${format.width}" height="${format.height}" viewBox="0 0 ${format.width} ${format.height}" role="img">`,
    '<title>Personal travel passport infographic</title>', PAPER_DEFS,
    `<rect width="${format.width}" height="${format.height}" fill="#294653"/>`,
    `<rect x="16" y="14" width="1048" height="${format.height - 28}" rx="16" fill="url(#paper)" stroke="#c3a577" stroke-width="2"/>`,
    `<rect x="16" y="14" width="1048" height="${format.height - 28}" rx="16" fill="url(#grain)"/>`,
    `<rect x="28" y="26" width="1024" height="${format.height - 52}" rx="9" fill="none" stroke="#9c7943" stroke-opacity=".55"/>`,
    '<g font-family="Arial,sans-serif" fill="#263f4c">',
    text('PASSPORT / A PERSONAL ATLAS', 48, layout.eyebrow, 12, 'letter-spacing="2.4" fill="#866a44"'),
    multiline(personal.title, 48, layout.title, 984, layout.titleSize, 2, measure, true),
    multiline(personal.name ? `Prepared for ${personal.name}` : 'Every journey leaves a story.', 48, layout.name, 984, story ? 23 : 20, 1, measure),
    multiline(personal.subtitle, 48, layout.subtitle, 984, story ? 20 : 17, 1, measure),
    `<path d="M48 ${layout.divider}H1032" stroke="#b9a17a"/>`,
  ];
  for (const [index, [value, label]] of summaryMetrics(data).entries()) {
    const x = 48 + index % 3 * 328;
    const y = layout.stats + Math.floor(index / 3) * layout.statsStep;
    pieces.push(text(value, x, y, layout.valueSize, 'font-family="Georgia,serif"'),
      text(label, x, y + layout.labelOffset, 17, 'fill="#685d4b"'));
  }
  pieces.push(
    `<rect x="376" y="${layout.progress}" width="265" height="5" rx="2.5" fill="#d2c5a8"/><rect x="376" y="${layout.progress}" width="${265 * data.stats.percentage / 100}" height="5" rx="2.5" fill="#62846a"/>`,
    text('ISO countries and territories only. Flags also include additional places.', 48, layout.isoNote, 13, 'fill="#776c59"'),
    text('THE PLACES IN YOUR STORY', 48, layout.mapTitle, 16, 'letter-spacing="2"'),
    `<rect x="48" y="${layout.mapY}" width="984" height="${layout.mapHeight}" rx="9" fill="#bad7dc" stroke="#9bbfc7"/>`,
    worldMap(source, [[62, layout.mapY + 14], [1018, layout.mapY + layout.mapHeight - 14]]),
    compass(88, layout.mapY + layout.mapHeight - 38, 44),
  );
  for (const [index, status] of STATUSES.entries()) {
    const x = 65 + index * 245;
    pieces.push(`<circle cx="${x}" cy="${layout.legend}" r="5.5" fill="${PALETTE[status]}" stroke="#7f8273"/>`,
      text(LEGEND_LABELS[index]!, x + 13, layout.legend + 6, 17));
  }
  for (const [index, group] of data.groups.entries()) {
    const x = 48 + index % 2 * 504;
    const y = layout.flags + Math.floor(index / 2) * (layout.flagHeight + layout.flagGap);
    pieces.push(`<g data-flag-group="${group.id}"><rect x="${x}" y="${y}" width="480" height="${layout.flagHeight}" rx="8" fill="#fffaf0" fill-opacity=".45" stroke="#bda783"/>`,
      text(group.label, x + 16, y + 25, 20, 'font-family="Georgia,serif"'),
      text(String(group.total), x + 464, y + 25, 20, 'text-anchor="end" fill="#76603e"'),
      flagImages(group.countries, flags, x + 16, y + 43, 6, 56, 41));
    if (!group.total) pieces.push(text('None yet', x + 16, y + 66, 17, 'fill="#776c59"'));
    if (group.hidden) pieces.push(text(`+${group.hidden} more`, x + 464, y + layout.flagHeight - 13, 13, 'text-anchor="end" fill="#76603e"'));
    pieces.push('</g>');
  }
  pieces.push(text('TOP EARNED BADGES', 48, layout.badgeHeading, 17, 'letter-spacing="2"'));
  for (const [index, badge] of data.badges.entries()) {
    const y = layout.badgeY + index * layout.badgeStep;
    pieces.push(`<g transform="translate(82,${y + 12}) scale(.34)">${medallion(0, 0, index)}</g>`,
      multiline(badge.name, 125, y, 560, layout.badgeSize, 2, measure, true),
      text(`${badge.value} points`, 125, y + layout.pointsOffset, 16, 'fill="#76603e"'));
  }
  if (!data.badges.length) {
    pieces.push(compass(340, layout.badgeY + 45, 60),
      text('No badges earned yet', 340, layout.badgeY + 112, 24, 'text-anchor="middle" font-family="Georgia,serif"'),
      text('Your next adventure could change that.', 340, layout.badgeY + 144, 17, 'text-anchor="middle"'));
  }
  pieces.push(
    text(`${data.earnedCount} earned \u00b7 ${data.earnedPoints} total points`, 48, layout.earned, 16, 'fill="#76603e"'),
    qrSvg(address, { x: 732, y: layout.qrY, size: 300 }),
    text('SCAN TO OPEN THE APP', 882, layout.qrY + 324, 12, 'text-anchor="middle" letter-spacing="1"'),
    multiline(address, 732, layout.qrY + 344, 300, 11, 1, measure),
    text('QR opens the app, not your personal map.', 48, layout.privacy, 12, 'fill="#6f624e"'),
    text('Boundaries: Natural Earth. Flags: flag-icons (MIT).', 48, layout.source, 10, 'fill="#6f624e"'),
    '</g></svg>',
  );
  return pieces.join('');
}

export function infographicSvg(source: InfographicSource, flags: ReadonlyMap<string, string>, measure: Measure): string {
  if (source.data.format.id !== 'horizontal') return portraitSvg(source, flags, measure);
  const personal = validatePersonalization(source.personal);
  const { data, address } = source;
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${INFOGRAPHIC_WIDTH}" height="${INFOGRAPHIC_HEIGHT}" viewBox="0 0 2400 1600" role="img">`,
    '<title>Personal travel passport infographic</title>',
    PAPER_DEFS,
    '<rect width="2400" height="1600" fill="#294653"/><path d="M0 1300 2400 300M0 300 2400 1300" stroke="#385460" stroke-width="180"/>',
    '<rect x="34" y="30" width="2332" height="1540" rx="22" fill="url(#paper)" stroke="#c3a577" stroke-width="3"/>',
    '<rect x="34" y="30" width="2332" height="1540" rx="22" fill="url(#grain)"/>',
    '<rect x="57" y="53" width="2286" height="1494" rx="12" fill="none" stroke="#9c7943" stroke-opacity=".55"/>',
    '<g font-family="Arial,sans-serif" fill="#263f4c">',
    text('PASSPORT / A PERSONAL ATLAS', 110, 102, 20, 'letter-spacing="5" fill="#866a44"'),
    multiline(personal.title, 105, 195, 1740, 76, 2, measure, true),
    multiline(personal.name ? `Prepared for ${personal.name}` : 'Every journey leaves a story.', 112, 340, 1740, 29, 1, measure),
    multiline(personal.subtitle, 112, 390, 1700, 26, 1, measure),
    qrSvg(address),
    text('SCAN TO START YOUR ATLAS', 2140, 408, 17, 'text-anchor="middle" letter-spacing="1.4"'),
    multiline(address, 1925, 431, 420, 16, 1, measure),
    '<path d="M110 454H2290" stroke="#b9a17a" stroke-width="2"/>',
  ];
  const metrics = summaryMetrics(data);
  for (const [index, [value, label]] of metrics.entries()) {
    const x = 110 + index * 365;
    pieces.push(text(value!, x, 522, 52, 'font-family="Georgia,serif"'), text(label!, x, 559, 23, 'fill="#685d4b"'));
  }
  pieces.push(`<rect x="1570" y="575" width="285" height="6" rx="3" fill="#d2c5a8"/><rect x="1570" y="575" width="${285 * data.stats.percentage / 100}" height="6" rx="3" fill="#62846a"/>`);
  pieces.push(text('ISO countries and territories only. Flags below also include additional places.', 110, 594, 18, 'fill="#776c59"'));
  pieces.push(text('THE PLACES IN YOUR STORY', 110, 636, 22, 'letter-spacing="3"'));
  pieces.push('<rect x="100" y="655" width="1430" height="555" rx="12" fill="#bad7dc" stroke="#9bbfc7"/>');
  pieces.push(worldMap(source, [[120, 675], [1500, 1190]]), compass(175, 1136, 70));
  for (const [index, status] of STATUSES.entries()) {
    const x = 152 + index * 338;
    pieces.push(`<circle cx="${x}" cy="1242" r="8" fill="${PALETTE[status]}" stroke="#7f8273"/>`,
      text(LEGEND_LABELS[index]!, x + 20, 1250, 23));
  }
  pieces.push(text('TOP EARNED BADGES', 1585, 636, 22, 'letter-spacing="3"'),
    '<rect x="1570" y="655" width="730" height="610" rx="12" fill="#fffaf0" fill-opacity=".5" stroke="#bda783"/>');
  for (const [index, badge] of data.badges.entries()) {
    const y = 750 + index * 170;
    pieces.push(medallion(1660, y, index),
      multiline(badge.name, 1745, y - 20, 520, 31, 2, measure, true),
      text(`${badge.value} points`, 1745, y + 65, 24, 'fill="#76603e"'));
    if (index < data.badges.length - 1) pieces.push(`<path d="M1605 ${y + 97}H2260" stroke="#cbb895"/>`);
  }
  if (!data.badges.length) {
    pieces.push(compass(1935, 868, 180), text('No badges earned yet', 1935, 1045, 35, 'text-anchor="middle" font-family="Georgia,serif"'),
      text('Your next adventure could change that.', 1935, 1090, 25, 'text-anchor="middle"'));
  }
  pieces.push(text(`${data.earnedCount} earned \u00b7 ${data.earnedPoints} total points`, 1935, 1235, 23, 'text-anchor="middle" fill="#76603e"'));
  for (const [index, group] of data.groups.entries()) {
    const x = 100 + index * 552;
    pieces.push(`<g data-flag-group="${group.id}"><rect x="${x}" y="1300" width="540" height="205" rx="10" fill="#fffaf0" fill-opacity=".45" stroke="#bda783"/>`,
      text(group.label, x + 20, 1338, 27, 'font-family="Georgia,serif"'),
      text(String(group.total), x + 515, 1338, 26, 'text-anchor="end" fill="#76603e"'));
    pieces.push(flagImages(group.countries, flags, x + 22, 1360, 9));
    if (!group.total) pieces.push(text('None yet', x + 22, 1394, 24, 'fill="#776c59"'));
    if (group.hidden) pieces.push(text(`+${group.hidden} more`, x + 515, 1481, 20, 'text-anchor="end" fill="#76603e"'));
    pieces.push('</g>');
  }
  pieces.push(text('MY MAP. MY MEMORIES. MY NEXT ADVENTURE.', 110, 1538, 16, 'letter-spacing="2" fill="#6f624e"'),
    text('QR links to the app, not this personal map. Boundaries: Natural Earth. Flags: flag-icons (MIT).', 2290, 1538, 16, 'text-anchor="end" fill="#6f624e"'),
    '</g></svg>');
  return pieces.join('');
}

export async function renderInfographic(source: InfographicSource): Promise<Blob> {
  const flags = await loadInfographicFlags(source.data.groups.flatMap((group) => [...group.countries]));
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = source.data.format.width;
  canvas.height = source.data.format.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot create a picture canvas.');
  const measure: Measure = (value, size, serif = false) => {
    context.font = `${size}px ${serif ? 'Georgia,serif' : 'Arial,sans-serif'}`;
    return context.measureText(value).width;
  };
  let url: string | undefined;
  const image = new Image();
  try {
    const svg = infographicSvg(source, flags, measure);
    url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    image.src = url;
    await image.decode();
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode the PNG. Please try again.'));
    }, 'image/png'));
  } finally {
    if (url) URL.revokeObjectURL(url);
    image.removeAttribute('src');
    canvas.width = 0;
    canvas.height = 0;
  }
}
