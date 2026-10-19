import classicArtwork from './classic/scenery.svg?raw';
import medievalArtwork from './medieval/scenery.svg?raw';

export const DEFAULT_ARTWORK = classicArtwork;

export const THEMES = [
  { id: 'classic', label: 'Classic', artwork: classicArtwork, sceneryDescription: 'Decorative ships, airplanes, and clouds.' },
  { id: 'dark', label: 'Dark', artwork: classicArtwork, sceneryDescription: 'Decorative ships, airplanes, and clouds.' },
  { id: 'medieval', label: 'Medieval', artwork: medievalArtwork, sceneryDescription: 'Decorative sailing ships, birds, and ink-style clouds.' },
] as const;

export type Theme = typeof THEMES[number];
export type ThemeId = Theme['id'];

export function findTheme(id: string): Theme | undefined {
  return THEMES.find(theme => theme.id === id);
}
