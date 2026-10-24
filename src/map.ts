import { geoPath, select, zoom, zoomIdentity, type D3ZoomEvent } from 'd3';
import type { Boundaries } from './geography';
import type { TravelStore } from './store';
import { NON_ISO_LABEL, territorySymbol, STATUS_LABELS, type SelectTerritory, type Territory } from './types';
import { createScenery, type SceneryState } from './scenery';
import { DEFAULT_PROJECTION, liveProjection, markerPoint, type ProjectionId } from './projection';

export interface MapControls {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  focusCountry: (id: string) => void;
  previewCountry: (id: string | undefined) => void;
  toggleSceneryMotion: () => void;
  toggleSceneryVisibility: () => void;
  setThemeArtwork: (artwork: string) => void;
  setProjection: (id: ProjectionId) => void;
}

export function createMap(
  container: HTMLElement,
  countries: Boundaries,
  background: Boundaries,
  registry: readonly Territory[],
  store: TravelStore,
  onSelect: SelectTerritory,
  onNavigate: () => void,
  onSceneryState: (state: SceneryState) => void,
  artwork?: string,
  projectionId: ProjectionId = DEFAULT_PROJECTION,
): MapControls {
  const territories = new Map(registry.map((country) => [country.id, country]));
  function getTerritory(id: string): Territory {
    const country = territories.get(id);
    if (!country) throw new Error(`Unknown map feature: ${id}`);
    return country;
  }
  const svg = select(container).append('svg').attr('class', 'world-map')
    .attr('aria-label', 'Interactive travel map. Use the territory list to change status with a keyboard.')
    .attr('role', 'img');
  const land = svg.append('g').attr('class', 'land-layer');
  const backgroundPaths = land.append('g').attr('class', 'background-layer').selectAll('path')
    .data(background.features).join('path');
  const paths = land.append('g').selectAll<SVGPathElement, Boundaries['features'][number]>('path')
    .data(countries.features).join('path').attr('class', 'country-boundary')
    .attr('data-country', (boundary) => String(boundary.id))
    .attr('data-kind', (boundary) => getTerritory(String(boundary.id)).kind)
    .attr('vector-effect', 'non-scaling-stroke');
  const countryPaths = new Map<string, SVGPathElement>();
  paths.each(function (boundary) { countryPaths.set(String(boundary.id), this); });
  const preview = land.append('path').attr('class', 'sidebar-country-preview')
    .attr('vector-effect', 'non-scaling-stroke').attr('aria-hidden', 'true')
    .style('display', 'none');
  const scenery = createScenery(svg.node()!, onSceneryState, artwork);
  const markers = svg.append('g').attr('class', 'marker-layer').selectAll('g')
    .data(registry.filter((country) => country.microstate)).join('g')
    .attr('class', 'microstate-marker').attr('data-country', (country) => country.id);
  markers.append('circle').attr('class', 'marker-target').attr('r', 12);
  markers.append('circle').attr('class', 'marker-dot').attr('r', 4.5);

  const tooltip = document.createElement('div');
  tooltip.className = 'map-tooltip';
  tooltip.hidden = true;
  tooltip.setAttribute('role', 'tooltip');
  document.body.append(tooltip);

  let projection = liveProjection(projectionId, 1, 1);
  const path = geoPath(projection);
  let transform = zoomIdentity;
  let width = 0;
  let height = 0;
  let hoveredId: string | undefined;
  let tooltipWidth = 0;
  let tooltipHeight = 0;
  let navigationActive = false;
  let activeId: string | undefined;
  let previewId: string | undefined;
  const markerPositions = new Map<string, [number, number]>();

  function updatePreviewGeometry(): void {
    if (previewId === undefined) {
      preview.attr('d', null).attr('data-preview-country', null).style('display', 'none');
      return;
    }
    const countryPath = countryPaths.get(previewId);
    if (!countryPath) throw new Error(`Missing rendered boundary for ${previewId}`);
    preview.attr('d', countryPath.getAttribute('d'))
      .attr('data-preview-country', previewId)
      .attr('data-favourite', String(store.isFavourite(previewId))).style('display', null);
  }

  function nearestMarker(event: MouseEvent, fallback: string): string {
    const rect = svg.node()!.getBoundingClientRect();
    const x = (event.clientX - rect.left) * width / rect.width;
    const y = (event.clientY - rect.top) * height / rect.height;
    let distance = Infinity;
    let nearest = fallback;
    for (const [id, point] of markerPositions) {
      const squared = (point[0] - x) ** 2 + (point[1] - y) ** 2;
      if (squared < distance) {
        distance = squared;
        nearest = id;
      }
    }
    return nearest;
  }

  function hideTooltip(): void {
    tooltip.hidden = true;
    hoveredId = undefined;
  }

  function showTooltip(event: MouseEvent, id: string): void {
    if (navigationActive) return;
    if (hoveredId !== id || tooltip.hidden) {
      const country = getTerritory(id);
      hoveredId = id;
      tooltip.replaceChildren();
      const title = document.createElement('strong');
      title.textContent = `${territorySymbol(country)} ${country.name}`;
      const status = document.createElement('span');
      status.textContent = `${id} \u00b7 ${country.kind === 'custom' ? `${NON_ISO_LABEL} \u00b7 ` : ''}${STATUS_LABELS[store.status(id)]}${store.isFavourite(id) ? ' \u00b7 Favourite' : ''}`;
      tooltip.append(title, status);
      tooltip.hidden = false;
      const rect = tooltip.getBoundingClientRect();
      tooltipWidth = rect.width;
      tooltipHeight = rect.height;
    }
    tooltip.style.left = `${Math.max(8, Math.min(event.clientX + 16, window.innerWidth - tooltipWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(event.clientY + 16, window.innerHeight - tooltipHeight - 8))}px`;
  }

  function activate(event: MouseEvent, id: string): void {
    if (event.defaultPrevented || navigationActive) return;
    hideTooltip();
    onSelect(id, { x: event.clientX, y: event.clientY, trigger: svg.node()! });
  }

  paths.on('pointermove', (event: MouseEvent, boundary) => showTooltip(event, String(boundary.id)))
    .on('pointerleave', hideTooltip)
    .on('click', (event: MouseEvent, boundary) => activate(event, String(boundary.id)));
  // Enlarged hit areas overlap at world scale; choose by distance, not SVG order.
  markers.on('pointermove', (event: MouseEvent, country) => showTooltip(event, nearestMarker(event, country.id)))
    .on('pointerleave', hideTooltip)
    .on('click', (event: MouseEvent, country) => {
      event.stopPropagation();
      activate(event, nearestMarker(event, country.id));
    });
  svg.attr('tabindex', -1);

  function positionMarkers(): void {
    markers.attr('transform', (country) => {
      const point = markerPoint(projection, country.marker, country.id, projectionId, height - 18);
      const [x, y] = transform.apply(point);
      markerPositions.set(country.id, [x, y]);
      return `translate(${x},${y})`;
    });
  }

  const behavior = zoom<SVGSVGElement, unknown>().scaleExtent([1, 24]).clickDistance(5)
    .duration(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250)
    .on('start', () => {
      navigationActive = true;
      svg.attr('data-navigating', 'true');
      hideTooltip();
      onNavigate();
    })
    .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
      transform = event.transform;
      land.attr('transform', transform.toString());
      positionMarkers();
      scenery.updateView({ projection, transform, width, height });
    })
    .on('end', () => {
      navigationActive = false;
      svg.attr('data-navigating', null);
    });
  svg.call(behavior);

  function resize(force = false, resetView = false): void {
    const bounds = container.getBoundingClientRect();
    const nextWidth = Math.max(bounds.width, 1);
    const nextHeight = Math.max(bounds.height, 1);
    if (!force && nextWidth === width && nextHeight === height) return;
    hideTooltip();
    const previousCenter = width && height ? projection.invert?.(transform.invert([width / 2, height / 2])) : null;
    width = nextWidth;
    height = nextHeight;
    projection = liveProjection(projectionId, width, height);
    path.projection(projection);
    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('data-projection', projectionId);
    paths.attr('d', (boundary) => path(boundary));
    updatePreviewGeometry();
    backgroundPaths.attr('d', (boundary) => path(boundary));
    behavior.extent([[0, 0], [width, height]])
      .translateExtent([[-width * 0.4, -height * 0.5], [width * 1.4, height * 1.5]]);
    const center = previousCenter ? projection(previousCenter) : null;
    const next = !resetView && center && transform.k > 1
      ? zoomIdentity.translate(width / 2 - center[0] * transform.k, height / 2 - center[1] * transform.k).scale(transform.k)
      : zoomIdentity;
    svg.call(behavior.transform, next);
  }

  function update(): void {
    paths.attr('data-status', (boundary) => store.status(String(boundary.id)))
      .attr('data-favourite', (boundary) => String(store.isFavourite(String(boundary.id))))
      .classed('is-selected', (boundary) => boundary.id === activeId);
    markers.attr('data-status', (country) => store.status(country.id))
      .attr('data-favourite', (country) => String(store.isFavourite(country.id)))
      .classed('is-selected', (country) => country.id === activeId);
    if (previewId !== undefined) preview.attr('data-favourite', String(store.isFavourite(previewId)));
    if (hoveredId) hideTooltip();
  }
  store.subscribe(update);
  new ResizeObserver(() => resize()).observe(container);
  resize();
  update();

  return {
    zoomIn: () => svg.call(behavior.scaleBy, 1.7),
    zoomOut: () => svg.call(behavior.scaleBy, 1 / 1.7),
    reset: () => svg.call(behavior.transform, zoomIdentity),
    toggleSceneryMotion: scenery.togglePaused,
    toggleSceneryVisibility: scenery.toggleVisible,
    setThemeArtwork: (next) => {
      hideTooltip();
      scenery.setArtwork(next);
    },
    setProjection: (id) => {
      if (id === projectionId) return;
      projectionId = id;
      resize(true, true);
    },
    focusCountry: (id: string) => {
      activeId = id;
      update();
    },
    previewCountry: (id: string | undefined) => {
      if (id !== undefined) getTerritory(id);
      if (id === previewId) return;
      previewId = id;
      updatePreviewGeometry();
      markers.classed('is-previewed', (country) => country.id === previewId);
    },
  };
}
