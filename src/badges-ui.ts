import { badgeCountryIds, evaluateBadge, parseBadges, type Badge } from './badges';
import { loadJson } from './geography';
import { formatPercentage } from './statistics';
import type { TravelStore } from './store';
import { errorMessage, STATUS_LABELS, type Territory } from './types';

export function createBadges(container: HTMLElement, registry: readonly Territory[], store: TravelStore) {
  const heading = document.createElement('h3');
  heading.textContent = 'Travel badges';
  const summary = document.createElement('p');
  summary.id = 'badge-summary';
  summary.className = 'insight-note';
  summary.setAttribute('aria-live', 'polite');
  const message = document.createElement('p');
  message.className = 'badge-message insight-note';
  message.setAttribute('role', 'status');
  const retry = document.createElement('button');
  retry.className = 'button secondary';
  retry.textContent = 'Retry loading badges';
  retry.hidden = true;
  const list = document.createElement('div');
  list.className = 'badge-list';
  container.append(heading, summary, message, retry, list);
  let state: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
  let badges: Badge[] = [];
  const territories = new Map(registry.map((country) => [country.id, country]));
  const rows: {
    badge: Badge; card: HTMLElement; state: HTMLElement; text: HTMLElement; progress: HTMLProgressElement;
    countries: { country: Territory; element: HTMLLIElement; status: HTMLSpanElement }[];
  }[] = [];

  function update(): void {
    if (state !== 'loaded') return;
    let earned = 0;
    let points = 0;
    const ranked = rows.map((row) => {
      const result = evaluateBadge(row.badge.condition, (id) => store.status(id));
      const percent = Math.max(0, Math.min(result.earned ? 100 : 99.9, result.completed / result.total * 100));
      const text = Number.isInteger(result.completed) ? `${result.completed}/${result.total}` : formatPercentage(percent);
      row.card.dataset.earned = String(result.earned);
      row.state.textContent = result.earned ? 'Earned' : 'In progress';
      row.text.textContent = text;
      row.progress.max = result.total;
      row.progress.value = result.completed;
      row.progress.setAttribute('aria-valuetext', `${text}, ${formatPercentage(percent)}, ${row.state.textContent}`);
      for (const { country, element, status } of row.countries) {
        const current = store.status(country.id);
        element.dataset.status = current;
        element.title = `${country.name}: ${STATUS_LABELS[current]}`;
        status.textContent = `: ${STATUS_LABELS[current]}`;
      }
      if (result.earned) { earned++; points += row.badge.value; }
      return { row, earned: result.earned, completion: result.completed / result.total };
    });
    ranked.sort((a, b) => Number(b.earned) - Number(a.earned)
      || (a.earned ? 0 : b.completion - a.completion)
      || b.row.badge.value - a.row.badge.value);
    const scrollTop = container.scrollTop;
    for (const [index, { row }] of ranked.entries()) {
      if (list.children[index] !== row.card) list.insertBefore(row.card, list.children[index] ?? null);
    }
    container.scrollTop = scrollTop;
    summary.textContent = `${earned}/${badges.length} badges earned \u00b7 ${points}/${badges.reduce((sum, badge) => sum + badge.value, 0)} points`;
  }

  async function load(): Promise<void> {
    if (state === 'loading' || state === 'loaded') return;
    state = 'loading';
    container.setAttribute('aria-busy', 'true');
    if (document.activeElement === retry) container.focus({ preventScroll: true });
    retry.hidden = true;
    message.textContent = 'Loading badges\u2026';
    try {
      badges = parseBadges(await loadJson('badges.json'), registry);
      for (const [index, badge] of badges.entries()) {
        const card = document.createElement('article');
        card.className = 'badge-card';
        const title = document.createElement('h4');
        title.id = `badge-title-${index}`;
        title.textContent = badge.name;
        card.setAttribute('aria-labelledby', title.id);
        const description = document.createElement('p');
        description.textContent = badge.description;
        const countryList = document.createElement('ul');
        countryList.className = 'badge-countries';
        countryList.setAttribute('aria-label', 'Countries that count toward this badge');
        const countries = badgeCountryIds(badge.condition).map((id) => {
          const country = territories.get(id)!;
          const element = document.createElement('li');
          element.className = 'badge-country';
          element.dataset.country = id;
          const name = document.createElement('span');
          name.textContent = country.name;
          const status = document.createElement('span');
          status.className = 'sr-only';
          element.append(name, status);
          countryList.append(element);
          return { country, element, status };
        });
        const points = document.createElement('span');
        points.className = 'badge-points';
        points.textContent = `${badge.value} points`;
        const status = document.createElement('strong');
        status.className = 'badge-state';
        const text = document.createElement('span');
        text.className = 'badge-progress-text';
        const progress = document.createElement('progress');
        progress.className = 'insight-progress';
        progress.setAttribute('aria-labelledby', title.id);
        card.append(title, description, countryList, points, status, text, progress);
        list.append(card);
        rows.push({ badge, card, state: status, text, progress, countries });
      }
      state = 'loaded';
      message.textContent = badges.length ? 'Visited and Lived / Living count. Badges and points reflect your current map.' : 'No badges have been configured yet.';
      update();
    } catch (error) {
      state = 'error';
      message.textContent = `Could not load badges. ${errorMessage(error)}`;
      retry.hidden = false;
    } finally {
      container.setAttribute('aria-busy', 'false');
    }
  }
  retry.addEventListener('click', () => { void load(); });
  store.subscribe(update);
  return { activate: (): void => { if (state === 'idle') void load(); } };
}
