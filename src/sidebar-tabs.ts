export type SidebarTab = 'manage' | 'stats' | 'badges' | 'save-export';

export function createSidebarTabs(container: HTMLElement, change: (tab: SidebarTab) => void) {
  const ids: SidebarTab[] = ['manage', 'stats', 'badges', 'save-export'];
  const buttons = ids.map((id) => {
    const button = container.querySelector<HTMLButtonElement>(`#tab-${id}`);
    const panel = container.querySelector<HTMLElement>(`#panel-${id}`);
    if (!button || !panel) throw new Error(`Missing sidebar tab: ${id}`);
    return { id, button, panel };
  });
  let current: SidebarTab = 'manage';
  function activate(id: SidebarTab): void {
    if (current === id) return;
    current = id;
    for (const tab of buttons) {
      tab.button.setAttribute('aria-selected', String(tab.id === id));
      tab.button.tabIndex = tab.id === id ? 0 : -1;
      tab.panel.hidden = tab.id !== id;
    }
    change(id);
  }
  for (const [index, tab] of buttons.entries()) {
    tab.button.addEventListener('click', () => activate(tab.id));
    tab.button.addEventListener('keydown', (event) => {
      const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length
        : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined;
      if (next === undefined) return;
      event.preventDefault();
      const target = buttons[next]!;
      activate(target.id);
      target.button.focus({ preventScroll: true });
    });
  }
  return {
    get current(): SidebarTab { return current; },
    focus: (): void => buttons.find((tab) => tab.id === current)!.button.focus({ preventScroll: true }),
  };
}
