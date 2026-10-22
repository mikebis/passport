import { create } from 'qrcode';
import type { Territory } from './types';

const assetFiles = import.meta.glob<string>('/node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true, query: '?url&no-inline', import: 'default',
});
export const flagAssetUrls = new Map(Object.entries(assetFiles).map(([path, url]) =>
  [path.split('/').at(-1)!.replace('.svg', '').toUpperCase(), url]));
const loaded = new Map<string, Promise<string>>();

export async function loadInfographicFlags(countries: readonly Territory[]): Promise<ReadonlyMap<string, string>> {
  const codes = [...new Set(countries.flatMap((country) => country.kind === 'iso' ? [country.alpha2] : []))];
  const result = new Map<string, string>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, codes.length) }, async () => {
    while (next < codes.length) {
      const code = codes[next++]!;
      let pending = loaded.get(code);
      if (!pending) {
        const url = flagAssetUrls.get(code);
        if (!url) throw new Error(`No infographic flag asset for ${code}.`);
        pending = fetch(url).then(async (response) => {
          if (!response.ok) throw new Error(`Could not load flag ${code} (HTTP ${response.status}).`);
          const svg = await response.text();
          const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
          if (document.documentElement.localName !== 'svg' || document.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg'
            || document.querySelector('parsererror')
            || /<script\b|\son\w+\s*=|(?:href|src)\s*=\s*["'](?!#)/i.test(svg)) {
            throw new Error(`Flag ${code} is not a self-contained SVG.`);
          }
          return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        }).catch((error: unknown) => { loaded.delete(code); throw error; });
        loaded.set(code, pending);
      }
      result.set(code, await pending);
    }
  }));
  return result;
}

export const QR_BOX = { x: 1990, y: 80, size: 300 } as const;
export interface QrBox { x: number; y: number; size: number }

export function qrSvg(address: string, box: QrBox = QR_BOX): string {
  const { modules } = create(address, { errorCorrectionLevel: 'M' });
  const cells = modules.size + 8;
  const scale = Math.floor(box.size / cells);
  if (scale < 3) throw new Error('The app address is too long for a readable QR code.');
  const inset = Math.floor((box.size - cells * scale) / 2);
  const parts: string[] = [];
  for (let row = 0; row < modules.size; row++) {
    for (let column = 0; column < modules.size; column++) {
      if (modules.get(row, column)) parts.push(`M${(column + 4) * scale},${(row + 4) * scale}h${scale}v${scale}h-${scale}z`);
    }
  }
  return `<g transform="translate(${box.x},${box.y})"><rect width="${box.size}" height="${box.size}" rx="6" fill="#fff"/><path transform="translate(${inset},${inset})" d="${parts.join('')}" fill="#142a35" shape-rendering="crispEdges"/></g>`;
}
