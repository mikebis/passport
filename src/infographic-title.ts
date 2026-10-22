import latin from '@fontsource/caveat/files/caveat-latin-600-normal.woff2?url&no-inline';
import latinExt from '@fontsource/caveat/files/caveat-latin-ext-600-normal.woff2?url&no-inline';
import cyrillic from '@fontsource/caveat/files/caveat-cyrillic-600-normal.woff2?url&no-inline';
import cyrillicExt from '@fontsource/caveat/files/caveat-cyrillic-ext-600-normal.woff2?url&no-inline';

export interface TitleRaster { href: string; width: number; height: number }
export interface TitleBox { x: number; y: number; width: number; height: number; size: number }
const files = [
  [latin, 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  [latinExt, 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'],
  [cyrillic, 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  [cyrillicExt, 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F'],
] as const;
const fonts = new Map<string, Promise<FontFace>>();
export const TITLE_COLOR = '#163f61';
export const titleFont = (size: number) => `600 ${size}px PassportHandwriting,Arial,sans-serif`;

export async function loadTitleFont(): Promise<void> {
  await Promise.all(files.map(([url, unicodeRange]) => {
    let pending = fonts.get(url);
    if (!pending) {
      pending = fetch(url).then(async (response) => {
        if (!response.ok) throw new Error(`Could not load the handwritten title font (HTTP ${response.status}).`);
        const face = new FontFace('PassportHandwriting', await response.arrayBuffer(), { weight: '600', unicodeRange });
        await face.load();
        document.fonts.add(face);
        return face;
      }).catch((error: unknown) => { fonts.delete(url); throw error; });
      fonts.set(url, pending);
    }
    return pending;
  }));
}

export function rasterTitle(
  value: string, box: TitleBox,
  wrap: (value: string, width: number, size: number, count: number, measure: (text: string, size: number) => number) => string[],
): TitleRaster {
  if (!value) return { href: '', width: box.width, height: 0 };
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the handwritten title.');
  try {
    const measure = (text: string, size: number) => {
      context.font = titleFont(size);
      const metrics = context.measureText(text);
      return Math.max(metrics.width, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight);
    };
    let size = box.size;
    let lines: string[];
    let ascent: number;
    let descent: number;
    let height: number;
    do {
      lines = wrap(value, box.width - 12, size, 2, measure);
      context.font = titleFont(size);
      const metrics = lines.map((line) => context.measureText(line));
      ascent = Math.max(...metrics.map((metric) => metric.actualBoundingBoxAscent));
      descent = Math.max(0, ...metrics.map((metric) => metric.actualBoundingBoxDescent));
      height = Math.ceil(ascent + descent + (lines.length - 1) * size * 1.12 + 8);
      if (height <= box.height) break;
      size--;
    } while (size >= 24);
    if (height > box.height) throw new Error('The handwritten title does not fit this picture format.');
    canvas.width = box.width;
    canvas.height = height;
    context.font = titleFont(size);
    context.fillStyle = TITLE_COLOR;
    for (const [index, line] of lines.entries()) {
      const left = Math.max(0, context.measureText(line).actualBoundingBoxLeft);
      context.fillText(line, 6 + left, 4 + ascent + index * size * 1.12);
    }
    const href = canvas.toDataURL('image/png');
    if (!href.startsWith('data:image/png;base64,')) throw new Error('The browser could not encode the handwritten title.');
    return { href, width: canvas.width, height: canvas.height };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
