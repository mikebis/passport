import { geoPath } from 'd3';
import type { Boundaries } from './geography';
import { loadInfographicFlags, qrSvg } from './infographic-assets';
import { metricIcon, scrapbook, SCRAPBOOK_DEFS, stamp, sticker, tape } from './infographic-artwork';
import { loadTitleFont, rasterTitle, type TitleBox, type TitleRaster } from './infographic-title';
import { infographicHeading, type InfographicData, type InfographicFormatId, type Personalization } from './infographic';
import { formatPercentage } from './statistics';
import { STATUSES, type Territory, type TravelStatus } from './types';
import { fitProjection, markerPoint, type ProjectionId } from './projection';

const PALETTE: Record<TravelStatus, string> = {
  visited: '#69ad3c', lived: '#edbd49', want_to_visit: '#b18ad0', unvisited: '#c8c9c3',
};
const LEGEND_LABELS = ['Visited', 'Lived / Living', 'Want to Visit', 'Unvisited'];
const TITLE_BOXES: Record<InfographicFormatId, TitleBox> = {
  horizontal: { x: 106, y: 110, width: 800, height: 190, size: 150 },
  feed: { x: 48, y: 62, width: 984, height: 140, size: 110 },
  story: { x: 48, y: 184, width: 984, height: 190, size: 135 },
};
const TITLE_ANGLE = -2;
function angledHeight(raster: TitleRaster, angle: number): number {
  const radians = Math.abs(angle) * Math.PI / 180;
  return raster.width * Math.sin(radians) + raster.height * Math.cos(radians);
}
type Measure = (text: string, size: number, serif?: boolean) => number;
export interface InfographicSource {
  data: InfographicData;
  countries: Boundaries;
  registry: readonly Territory[];
  personal: Personalization;
  address: string;
  projection: ProjectionId;
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
      } else { lines.push(line.trim()); line = ''; }
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
function multiline(value: string, x: number, y: number, width: number, size: number, lines: number, measure: Measure): string {
  return fitLines(value, width, size, lines, measure).map((line, index) => text(line, x, y + index * size * 1.22, size)).join('');
}
function titleArtwork(source: InfographicSource, title: TitleRaster): string {
  const box = TITLE_BOXES[source.data.format.id];
  const titleY = box.y + title.width * Math.sin(-TITLE_ANGLE * Math.PI / 180);
  const heading = escapeSvg(infographicHeading(source.personal));
  return `<image data-handwritten-title="${heading}" aria-label="${heading}" x="${box.x}" y="${titleY}" width="${title.width}" height="${title.height}" transform="rotate(${TITLE_ANGLE} ${box.x} ${titleY})" href="${escapeSvg(title.href)}"/>`;
}
function qrCaption(address: string, x: number, y: number, size: number, measure: Measure): string {
  const label = fitLines(address, 300, size, 1, measure)[0]!;
  return text('Scan to create yours!', x, y, size, 'data-qr-caption="" text-anchor="middle"')
    + text(label, x, y + size * 1.5, size, 'data-qr-url="" text-anchor="middle"');
}
function compass(x: number, y: number, size: number): string {
  return `<g data-decoration="compass" transform="translate(${x},${y}) scale(${size / 100})" fill="none" stroke="#43667b" stroke-width="1.5">
    <circle r="42"/><circle r="37"/><path d="M0-54V54M-54 0H54M-31-31l62 62M-31 31l62-62" opacity=".5"/>
    <path d="M0-42 9-9 42 0 9 9 0 42-9 9-42 0-9-9Z" fill="#43667b" fill-opacity=".15"/>
    <path d="M0-42 0 0 9-9ZM42 0 0 0 9 9ZM0 42 0 0-9 9ZM-42 0 0 0-9-9Z" fill="#43667b"/><circle r="3"/></g>`;
}
function summaryMetrics(data: InfographicData): [string, string][] {
  return [
    [String(data.stats.counts.visited), 'Visited'], [String(data.stats.counts.lived), 'Lived / Living'],
    [String(data.stats.counts.want_to_visit), 'Want to Visit'], [String(data.favourites), 'Favourites'],
    [`${data.stats.completed}/${data.stats.total}`, `Visited or lived \u00b7 ${formatPercentage(data.stats.percentage)}`],
    [`${data.stats.continentsCompleted}/${data.stats.continents.size}`, 'Continents explored'],
  ];
}
function worldMap(source: InfographicSource, extent: [[number, number], [number, number]]): string {
  const { data, countries, registry } = source;
  const projection = fitProjection(source.projection, extent);
  const path = geoPath(projection);
  const pieces = [`<g id="infographic-map" data-projection="${source.projection}">`];
  for (const boundary of countries.features) {
    const id = String(boundary.id);
    const geometry = path(boundary);
    if (!geometry) throw new Error(`Could not render infographic boundary ${id}.`);
    pieces.push(`<path data-country="${escapeSvg(id)}" data-status="${data.status(id)}" d="${geometry}" fill="${PALETTE[data.status(id)]}" stroke="#faf8ed" stroke-width=".8" stroke-linejoin="round"/>`);
  }
  for (const country of registry.filter((entry) => entry.microstate)) {
    const position = markerPoint(projection, country.marker, country.id, source.projection, extent[1][1] - 3);
    const x = Math.max(extent[0][0] + 3, Math.min(extent[1][0] - 3, position[0]));
    const y = Math.max(extent[0][1] + 3, Math.min(extent[1][1] - 3, position[1]));
    pieces.push(`<circle data-marker="${escapeSvg(country.id)}" cx="${x}" cy="${y}" r="2.3" fill="${PALETTE[data.status(country.id)]}" stroke="#faf8ed" stroke-width=".7"/>`);
  }
  return `${pieces.join('')}</g>`;
}
function mapPanel(source: InfographicSource, x: number, y: number, width: number, height: number, portrait: boolean): string {
  const legendHeight = portrait ? 38 : 46;
  const legendWidth = portrait ? 830 : 1060;
  const legendX = x + (width - legendWidth) / 2;
  const legendY = y + height - legendHeight - 12;
  const legend = STATUSES.map((status, index) => {
    const cx = legendX + 22 + index * (legendWidth / 4);
    return `<circle cx="${cx}" cy="${legendY + legendHeight / 2}" r="${portrait ? 5 : 7}" fill="${PALETTE[status]}" stroke="#6c827d"/>`
      + text(LEGEND_LABELS[index]!, cx + 14, legendY + legendHeight / 2 + 6, portrait ? 16 : 21);
  }).join('');
  return `<g data-section="world-map"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="9" fill="url(#sea)" stroke="#9cbdc1"/>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="9" fill="url(#water)"/>
    ${worldMap(source, [[x + 15, y + 15], [x + width - 15, legendY - 12]])}
    ${compass(x + (portrait ? 34 : 56), legendY + 4, portrait ? 36 : 58)}
    <rect x="${legendX}" y="${legendY}" width="${legendWidth}" height="${legendHeight}" rx="${legendHeight / 2}" fill="#fffdf4" fill-opacity=".9" stroke="#a6bbc0"/>${legend}
    </g>`;
}
function flagImages(countries: readonly Territory[], flags: ReadonlyMap<string, string>, x: number, y: number, columns: number, columnStep: number, rowStep: number): string {
  return countries.map((country, index) => {
    const fx = x + index % columns * columnStep;
    const fy = y + Math.floor(index / columns) * rowStep;
    if (country.kind === 'iso') {
      const asset = flags.get(country.alpha2);
      if (!asset) throw new Error(`Missing rendered flag for ${country.id}.`);
      return `<image data-flag="${country.id}" x="${fx}" y="${fy}" width="44" height="33" href="${escapeSvg(asset)}" xlink:href="${escapeSvg(asset)}"/>`;
    }
    return `<rect x="${fx}" y="${fy}" width="44" height="33" rx="3" fill="#e3ddcb" stroke="#a3967c"/>`
      + text(country.id.replace('custom:', ''), fx + 22, fy + 22, 14, 'text-anchor="middle"');
  }).join('');
}
function flagCards(data: InfographicData, flags: ReadonlyMap<string, string>, portrait: boolean, story = false): string {
  return data.groups.map((group, index) => {
    const x = portrait ? 48 + index % 2 * 504 : 112 + index * 552;
    const height = portrait ? story ? 126 : 82 : 164;
    const y = portrait ? (story ? 1080 : 782) + Math.floor(index / 2) * (height + (story ? 14 : 12)) : 1314;
    const width = portrait ? 480 : 540;
    return `<g data-flag-group="${group.id}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="3" fill="#fffdf5" fill-opacity=".55" stroke="#c0b7a2" stroke-width="1.2"/>
      <path d="M${x + 5} ${y + 7}H${x + width - 7}M${x + 7} ${y + height - 6}H${x + width - 5}" stroke="#d7ceba" fill="none"/>
      ${text(group.label, x + 16, y + (portrait ? 25 : 30), portrait ? 20 : 25, 'font-weight="600"')}
      ${text(String(group.total), x + width - 16, y + (portrait ? 25 : 30), portrait ? 20 : 24, 'text-anchor="end" fill="#6a726a"')}
      ${flagImages(group.countries, flags, x + (portrait ? 16 : 22), y + (portrait ? 43 : 50), portrait ? 6 : 9, portrait ? 56 : 55, portrait ? 41 : 44)}
      ${!group.total ? text('None yet', x + 16, y + 66, portrait ? 17 : 22, 'fill="#77796c"') : ''}
      ${group.hidden ? text(`+${group.hidden} more`, x + width - 16, y + height - 13, portrait ? 13 : 18, 'text-anchor="end" fill="#6a726a"') : ''}
      ${tape(x + 4, y + 2, -32, portrait ? .48 : .72)}
      </g>`;
  }).join('');
}
function start(source: InfographicSource): string[] {
  const { width, height } = source.data.format;
  return [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>Personal travel passport infographic</title>`,
    SCRAPBOOK_DEFS, scrapbook(width, height), '<g font-family="Arial,sans-serif" fill="#263f4c">'];
}
function portraitSvg(source: InfographicSource, flags: ReadonlyMap<string, string>, measure: Measure, title: TitleRaster): string {
  const { data, address } = source;
  const story = data.format.id === 'story';
  const titleBox = TITLE_BOXES[data.format.id];
  const divider = titleBox.y + angledHeight(title, TITLE_ANGLE) + 28;
  const statsY = divider + (story ? 49 : 36);
  const statsStep = story ? 88 : 64;
  const mapY = divider + (story ? 238 : 194);
  const mapBottom = story ? 1030 : 740;
  const qrY = story ? 1370 : 970;
  const badgeY = story ? 1440 : 1044;
  const pieces = start(source);
  pieces.push(titleArtwork(source, title),
    `<path d="M48 ${divider}H1032" stroke="#c6baa2"/>`);
  for (const [index, [value, label]] of summaryMetrics(data).entries()) {
    const x = 48 + index % 3 * 328;
    const y = statsY + Math.floor(index / 3) * statsStep;
    pieces.push(metricIcon(x + 1, y - (story ? 32 : 26), index, story ? 28 : 23),
      text(value, x + (story ? 42 : 34), y, story ? 40 : 33, 'font-weight="600"'),
      text(label, x, y + (story ? 30 : 22), 17, 'fill="#62716d"'));
  }
  const progressY = statsY + statsStep + (story ? 44 : 32);
  pieces.push(`<rect x="376" y="${progressY}" width="265" height="4" rx="2" fill="#d8d3bc"/><rect x="376" y="${progressY}" width="${265 * data.stats.percentage / 100}" height="4" rx="2" fill="#6b9b58"/>`,
    text('THE PLACES IN YOUR STORY', 48, mapY - 14, 15, 'letter-spacing="1.7"'),
    mapPanel(source, 48, mapY, 984, mapBottom - mapY, true),
    flagCards(data, flags, true, story),
    text('TOP BADGES', 48, story ? 1400 : 1015, 17, 'font-weight="600" letter-spacing="1.5"'));
  for (const [index, badge] of data.badges.entries()) {
    const y = badgeY + index * (story ? 80 : 74);
    pieces.push(sticker(82, y + 12, 58, index),
      multiline(badge.name, 125, y, 560, story ? 22 : 20, 2, measure),
      text(`${badge.value} points`, 125, y + (story ? 52 : 48), 16, 'fill="#657568"'));
  }
  if (!data.badges.length) {
    pieces.push(compass(340, badgeY + 45, 60),
      text('No badges earned yet', 340, badgeY + 112, 24, 'text-anchor="middle"'),
      text('Your next adventure could change that.', 340, badgeY + 144, 17, 'text-anchor="middle"'));
  }
  pieces.push(
    text(`${data.earnedCount} earned \u00b7 ${data.earnedPoints} total points`, 48, story ? 1680 : 1267, 16, 'fill="#657568"'),
    qrSvg(address, { x: 732, y: qrY, size: 300 }),
    qrCaption(address, 882, qrY + 324, 12, measure),
    text('QR opens the app, not your personal map.', 48, story ? 1701 : 1293, 12, 'fill="#6f746a"'),
    text('Natural Earth \u00b7 flag-icons (MIT) \u00b7 Caveat (OFL)', 48, story ? 1718 : 1316, 10, 'fill="#6f746a"'),
    story ? stamp(90, 1830, 37) : stamp(26, 28, 10));
  pieces.push('</g></svg>');
  return pieces.join('');
}
export function infographicSvg(source: InfographicSource, flags: ReadonlyMap<string, string>, measure: Measure, title: TitleRaster): string {
  if (source.data.format.id !== 'horizontal') return portraitSvg(source, flags, measure, title);
  const { data, address } = source;
  const pieces = start(source);
  pieces.push(titleArtwork(source, title));
  for (const [index, [value, label]] of summaryMetrics(data).entries()) {
    const x = 940 + index % 3 * 328;
    const y = 205 + Math.floor(index / 3) * 116;
    pieces.push(metricIcon(x, y - 34, index, 29), text(value, x + 44, y, 39, 'font-weight="600"'),
      text(label, x, y + 32, 19, 'fill="#62716d"'));
  }
  pieces.push(
    `<rect x="1268" y="366" width="270" height="5" rx="2.5" fill="#d8d3bc"/><rect x="1268" y="366" width="${270 * data.stats.percentage / 100}" height="5" rx="2.5" fill="#6b9b58"/>`,
    qrSvg(address, { x: 1990, y: 100, size: 300 }),
    qrCaption(address, 2140, 423, 16, measure),
    '<path d="M112 470H2290" stroke="#c6baa2"/>',
    mapPanel(source, 112, 510, 1428, 768, false),
    text('TOP BADGES', 1580, 500, 23, 'font-weight="600"'),
    '<rect x="1580" y="520" width="710" height="758" rx="3" fill="#fffdf5" fill-opacity=".4" stroke="#c0b7a2"/>');
  for (const [index, badge] of data.badges.entries()) {
    const y = 632 + index * 196;
    pieces.push(sticker(1680, y, 138, index),
      multiline(badge.name, 1770, y - 18, 485, 28, 2, measure),
      text(`${badge.value} points`, 1770, y + 64, 23, 'fill="#657568"'));
  }
  if (!data.badges.length) {
    pieces.push(compass(1935, 835, 145),
      text('No badges earned yet', 1935, 1020, 32, 'text-anchor="middle"'),
      text('Your next adventure could change that.', 1935, 1066, 23, 'text-anchor="middle"'));
  }
  pieces.push(text(`${data.earnedCount} earned \u00b7 ${data.earnedPoints} total points`, 1935, 1236, 22, 'text-anchor="middle" fill="#657568"'),
    flagCards(data, flags, false), tape(1510, 514, 30, .85),
    stamp(2220, 1516, 25),
    text('MY MAP. MY MEMORIES. MY NEXT ADVENTURE.', 112, 1518, 15, 'letter-spacing="1.6" fill="#6f746a"'),
    text('QR links to the app, not this personal map. Natural Earth \u00b7 flag-icons (MIT) \u00b7 Caveat (OFL)', 2130, 1518, 15, 'text-anchor="end" fill="#6f746a"'),
    '</g></svg>');
  return pieces.join('');
}
export async function renderInfographic(source: InfographicSource): Promise<Blob> {
  await Promise.all([loadTitleFont(), document.fonts.ready]);
  const flags = await loadInfographicFlags(source.data.groups.flatMap((group) => [...group.countries]));
  const title = rasterTitle(infographicHeading(source.personal), TITLE_BOXES[source.data.format.id], fitLines);
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
    const svg = infographicSvg(source, flags, measure, title);
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
