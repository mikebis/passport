import type { TravelStore } from './store';
import { NON_ISO_LABEL, territorySymbol, STATUSES, STATUS_LABELS, type SelectionAnchor, type Territory } from './types';

export class StatusPopover {
  private element = document.createElement('div');
  private currentId: string | undefined;
  private trigger: Element | undefined;
  private countries: Map<string, Territory>;
  private anchor: SelectionAnchor | undefined;
  private scrollOrigin = { x: 0, y: 0 };

  constructor(
    private store: TravelStore,
    registry: readonly Territory[],
    private announce: (message: string) => void,
    private focusFallback?: () => void,
  ) {
    this.countries = new Map(registry.map((country) => [country.id, country]));
    this.element.className = 'status-popover';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', 'Change travel status');
    document.body.append(this.element);
    document.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Node && !this.element.contains(event.target)) this.close(false);
    });
    document.addEventListener('keydown', (event) => {
      if (this.element.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
      if (event.key === 'Tab') {
        const buttons = [...this.element.querySelectorAll('button')];
        const first = buttons[0];
        const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    });
    window.addEventListener('resize', () => this.close(false));
    window.addEventListener('scroll', () => this.position(), true);
  }

  open(id: string, anchor: SelectionAnchor): void {
    const country = this.countries.get(id);
    if (!country) throw new Error(`Unknown territory: ${id}`);
    this.currentId = id;
    this.trigger = anchor.trigger;
    this.anchor = anchor;
    this.scrollOrigin = { x: window.scrollX, y: window.scrollY };
    this.element.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'popover-heading';
    const title = document.createElement('strong');
    title.textContent = `${territorySymbol(country)} ${country.name}`;
    const close = document.createElement('button');
    close.className = 'icon-button close-popover';
    close.textContent = '\u00d7';
    close.setAttribute('aria-label', 'Close status choices');
    close.addEventListener('click', () => this.close());
    heading.append(title, close);
    const code = document.createElement('p');
    code.className = 'popover-subtitle';
    code.textContent = `${country.id} \u00b7 ${country.kind === 'custom' ? NON_ISO_LABEL : 'Make it part of your story'}`;
    this.element.append(heading, code);
    for (const status of STATUSES) {
      const button = document.createElement('button');
      button.className = 'status-choice';
      button.dataset.status = status;
      button.setAttribute('aria-pressed', String(this.store.status(id) === status));
      const dot = document.createElement('span');
      dot.className = `status-dot ${status}`;
      dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = status === 'unvisited' ? 'Reset (Unvisited)' : STATUS_LABELS[status];
      const check = document.createElement('span');
      check.className = 'choice-check';
      check.textContent = this.store.status(id) === status ? '\u2713' : '';
      check.setAttribute('aria-hidden', 'true');
      button.append(dot, text, check);
      button.addEventListener('click', () => {
        this.store.setStatus(id, status);
        this.announce(`${country.name}: ${STATUS_LABELS[status]}.`);
        this.close();
      });
      this.element.append(button);
    }
    this.element.hidden = false;
    this.position();
    this.element.querySelector<HTMLButtonElement>(`[data-status="${this.store.status(id)}"]`)?.focus({ preventScroll: true });
  }

  private position(): void {
    if (this.element.hidden || !this.anchor) return;
    const triggerRect = this.trigger instanceof HTMLElement ? this.trigger.getBoundingClientRect() : undefined;
    const x = triggerRect?.left ?? this.anchor.x - (window.scrollX - this.scrollOrigin.x);
    const y = triggerRect?.top ?? this.anchor.y - (window.scrollY - this.scrollOrigin.y);
    const rect = this.element.getBoundingClientRect();
    const left = Math.max(12, Math.min(x + 12, window.innerWidth - rect.width - 12));
    const top = Math.max(12, Math.min(y + 12, window.innerHeight - rect.height - 12));
    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
  }

  close(restoreFocus = true): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    this.currentId = undefined;
    if (restoreFocus) {
      if ((this.trigger instanceof HTMLElement || this.trigger instanceof SVGElement)
        && this.trigger.isConnected && this.trigger.checkVisibility() && this.trigger.getClientRects().length) {
        this.trigger.focus({ preventScroll: true });
      } else this.focusFallback?.();
    }
  }

  get selectedId(): string | undefined {
    return this.currentId;
  }
}
