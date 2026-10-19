import { geoDistance, geoInterpolate, type GeoProjection, type ZoomTransform } from 'd3';

export type MapPoint = [number, number];
export type SceneryKind = 'ship' | 'plane' | 'cloud';

interface SceneryRoute {
  id: string;
  kind: SceneryKind;
  points: MapPoint[];
  duration: number;
  phase: number;
  mobile: boolean;
}

export const SCENERY_ROUTES: readonly SceneryRoute[] = [
  { id: 'atlantic-ship', kind: 'ship', points: [[-48, 14], [-38, 22], [-26, 30]], duration: 120000, phase: .2, mobile: true },
  { id: 'pacific-ship', kind: 'ship', points: [[-150, -12], [-135, -4], [-119, 7]], duration: 140000, phase: .64, mobile: true },
  { id: 'indian-ship', kind: 'ship', points: [[64, -24], [73, -17], [84, -12]], duration: 130000, phase: .5, mobile: false },
  { id: 'atlantic-plane', kind: 'plane', points: [[-74, 40], [-12, 52]], duration: 65000, phase: .35, mobile: true },
  { id: 'eurasian-plane', kind: 'plane', points: [[55, 26], [132, 36]], duration: 75000, phase: .65, mobile: false },
  { id: 'pacific-cloud', kind: 'cloud', points: [[-160, 30], [-120, 35]], duration: 185000, phase: .3, mobile: true },
  { id: 'atlantic-cloud', kind: 'cloud', points: [[-26, 48], [18, 52]], duration: 210000, phase: .2, mobile: false },
  { id: 'southern-cloud', kind: 'cloud', points: [[6, -27], [37, -20]], duration: 195000, phase: .55, mobile: true },
  { id: 'eastern-cloud', kind: 'cloud', points: [[100, 10], [144, 20]], duration: 205000, phase: .5, mobile: true },
];

export function createRouteSampler(points: readonly MapPoint[]): (progress: number) => MapPoint {
  if (points.length < 2 || points.some((point) => point.length !== 2
    || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 85)) {
    throw new Error('Scenery routes require at least two valid geographic points.');
  }
  let total = 0;
  const segments = points.slice(1).map((end, index) => {
    const start = points[index]!;
    const length = geoDistance(start, end);
    const from = total;
    total += length;
    return { from, to: total, length, interpolate: geoInterpolate(start, end) };
  }).filter((segment) => segment.length > 0);
  if (!total) throw new Error('Scenery routes must have a nonzero length.');
  return (progress) => {
    if (!Number.isFinite(progress)) throw new Error('Scenery progress must be finite.');
    const distance = Math.max(0, Math.min(1, progress)) * total;
    const segment = segments.find((part) => distance <= part.to) ?? segments[segments.length - 1]!;
    return segment.interpolate((distance - segment.from) / segment.length);
  };
}

export function projectedHeading(before: MapPoint, after: MapPoint, worldWidth: number): number {
  let dx = after[0] - before[0];
  if (dx > worldWidth / 2) dx -= worldWidth;
  if (dx < -worldWidth / 2) dx += worldWidth;
  return Math.atan2(after[1] - before[1], dx) * 180 / Math.PI;
}

export class SceneryClock {
  elapsed = 0;
  running = false;
  private previous: number | undefined;

  setRunning(running: boolean): void {
    if (this.running === running) return;
    this.running = running;
    this.previous = undefined;
  }

  advance(timestamp: number): number {
    if (!Number.isFinite(timestamp)) throw new Error('Animation timestamps must be finite.');
    if (!this.running) return this.elapsed;
    if (this.previous !== undefined) {
      this.elapsed += Math.min(100, Math.max(0, timestamp - this.previous));
    }
    this.previous = timestamp;
    return this.elapsed;
  }
}

export interface SceneryState {
  visible: boolean;
  paused: boolean;
  reducedMotion: boolean;
  running: boolean;
}

interface SceneryView {
  projection: GeoProjection;
  transform: ZoomTransform;
  width: number;
  height: number;
}

export interface SceneryController {
  updateView: (view: SceneryView) => void;
  togglePaused: () => void;
  toggleVisible: () => void;
  destroy: () => void;
}

const namespace = 'http://www.w3.org/2000/svg';
let sceneId = 0;

export function createScenery(svg: SVGSVGElement, onState: (state: SceneryState) => void): SceneryController {
  const id = `map-scenery-${sceneId++}`;
  const layer = document.createElementNS(namespace, 'g');
  layer.id = id;
  layer.classList.add('map-scenery');
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('pointer-events', 'none');
  layer.innerHTML = `
    <defs>
      <symbol id="${id}-ship" viewBox="-20 -16 40 32">
        <path d="M-18-3h5m-6 6h6" fill="none" stroke="#83a9b3" stroke-width="1.3" stroke-linecap="round"/>
        <path d="M-11-4Q-14 0-11 4L4 5Q10 4 14 0Q10-4 4-5Z" fill="#b6ddcd" stroke="#638b83" stroke-width="1.1" stroke-linejoin="round"/>
        <rect x="-6" y="-3" width="10" height="6" rx="2" fill="#fff9e9" stroke="#7d998b" stroke-width=".8"/>
        <path d="M1-9V7M2-8 9-1H2Z" fill="#fffdf4" stroke="#7d998b" stroke-width=".8" stroke-linejoin="round"/>
      </symbol>
      <symbol id="${id}-plane" viewBox="-20 -16 40 32">
        <path d="M16 0 2-3-2-12h-4l1 9-7 1-3-3h-3l4 5-4 5h3l3-3 7 1-1 9h4L2 3Z" fill="#fffdf3" stroke="#7b919c" stroke-width="1.1" stroke-linejoin="round"/>
        <path d="M6-1h4M-4-10l1 6M-4 10l1-6" fill="none" stroke="#b8a6d0" stroke-width="1.2" stroke-linecap="round"/>
      </symbol>
      <symbol id="${id}-cloud" viewBox="-28 -18 56 36">
        <path d="M-18 10C-30 10-29-5-18-5C-17-19 3-21 8-8C20-12 29-3 23 5C29 13 14 16 6 11Z" fill="#fffefa" stroke="#fffefa" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M-17 6h7m16 1h9" fill="none" stroke="#dceaf0" stroke-width="1" stroke-linecap="round"/>
      </symbol>
    </defs>`;
  svg.append(layer);
  const objects = [...SCENERY_ROUTES].sort((a, b) => Number(a.kind === 'cloud') - Number(b.kind === 'cloud')).map((route) => {
    const group = document.createElementNS(namespace, 'g');
    group.classList.add('scenery-object', `scenery-${route.kind}`);
    group.dataset.sceneryId = route.id;
    group.dataset.mobile = String(route.mobile);
    const art = document.createElementNS(namespace, 'use');
    const size = route.kind === 'cloud' ? 69 : route.kind === 'plane' ? 34.5 : 37.5;
    art.classList.add('scenery-art');
    art.setAttribute('href', `#${id}-${route.kind}`);
    art.setAttribute('x', String(-size / 2));
    art.setAttribute('y', String(-size / 2));
    art.setAttribute('width', String(size));
    art.setAttribute('height', String(size));
    group.append(art);
    layer.append(group);
    return { route, group, sample: createRouteSampler(route.points), size };
  });

  const clock = new SceneryClock();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = window.matchMedia('(max-width: 720px)');
  let visible = true;
  let paused = false;
  let view: SceneryView | undefined;
  let frame: number | undefined;
  let destroyed = false;

  function render(): void {
    if (!view || !visible || destroyed) return;
    const { projection, transform, width, height } = view;
    for (const { route, group, sample, size } of objects) {
      if (mobile.matches && !route.mobile) {
        group.style.display = 'none';
        continue;
      }
      const progress = (route.phase + clock.elapsed / route.duration) % 1;
      const position = projection(sample(progress));
      const before = projection(sample(Math.max(0, progress - .001)));
      const after = projection(sample(Math.min(1, progress + .001)));
      if (!position || !before || !after || ![...position, ...before, ...after].every(Number.isFinite)) {
        throw new Error(`Could not project scenery route ${route.id}.`);
      }
      const point = transform.apply(position);
      const bob = route.kind === 'ship' ? Math.sin(clock.elapsed / 850 + route.phase * Math.PI * 2) * .65 : 0;
      const angle = route.kind === 'cloud' ? 0 : projectedHeading(before, after, projection.scale() * Math.PI * 2);
      const outside = point[0] < -size || point[0] > width + size || point[1] < -size || point[1] > height + size;
      group.style.display = outside ? 'none' : '';
      group.setAttribute('transform', `translate(${point[0].toFixed(3)},${(point[1] + bob).toFixed(3)}) rotate(${angle.toFixed(3)})`);
      const fade = Math.max(0, Math.min(1, progress / .045, (1 - progress) / .045));
      group.setAttribute('opacity', String(fade * (route.kind === 'cloud' ? .5 : .85)));
    }
  }

  function tick(timestamp: number): void {
    frame = undefined;
    if (!clock.running || destroyed) return;
    clock.advance(timestamp);
    render();
    frame = requestAnimationFrame(tick);
  }

  function reconcile(): void {
    if (destroyed) return;
    const running = Boolean(view) && visible && !paused && !reduced.matches && !document.hidden;
    clock.setRunning(running);
    layer.style.display = visible ? '' : 'none';
    layer.dataset.motion = !visible ? 'hidden' : reduced.matches ? 'reduced' : document.hidden ? 'background' : paused ? 'paused' : 'running';
    if (!running && frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
    render();
    onState({ visible, paused, reducedMotion: reduced.matches, running });
    if (running && frame === undefined) frame = requestAnimationFrame(tick);
  }

  function refreshResponsive(): void {
    render();
  }

  function pageHide(event: PageTransitionEvent): void {
    if (!event.persisted) destroy();
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    clock.setRunning(false);
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    reduced.removeEventListener('change', reconcile);
    mobile.removeEventListener('change', refreshResponsive);
    document.removeEventListener('visibilitychange', reconcile);
    window.removeEventListener('pagehide', pageHide);
    layer.remove();
  }

  reduced.addEventListener('change', reconcile);
  mobile.addEventListener('change', refreshResponsive);
  document.addEventListener('visibilitychange', reconcile);
  window.addEventListener('pagehide', pageHide);
  reconcile();
  return {
    updateView(next) {
      const firstView = !view;
      view = next;
      if (firstView) reconcile();
      else render();
    },
    togglePaused() {
      if (!visible || reduced.matches || destroyed) return;
      paused = !paused;
      reconcile();
    },
    toggleVisible() {
      if (destroyed) return;
      visible = !visible;
      reconcile();
    },
    destroy,
  };
}
