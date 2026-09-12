import { HouseIcon, MailPlusIcon, UsersIcon } from '@lucide/vue';
import type { SessionState } from '@outpost/shared';
import type { WebPluginDefinition } from '@outpost/web-plugin-api';
import { inject, type Component, type InjectionKey } from 'vue';

export interface ShellNavItem {
  /** `<plugin id>.<item key>`, or `core.*` for entries of the shell itself. */
  id: string;
  label: string;
  icon: Component;
  to: string;
  order: number;
}

export interface ShellState {
  navItems: readonly ShellNavItem[];
  /** Session state loaded at startup; null when the server could not be reached. */
  session: SessionState | null;
}

export const shellKey: InjectionKey<ShellState> = Symbol('outpost.shell');

const DEFAULT_ORDER = 500;

/**
 * Sidebar entries: the home entry, the administration pages for superadmins and the entries of
 * enabled plugins, sorted by `order`.
 */
export function buildNavItems(
  plugins: readonly WebPluginDefinition[],
  session: SessionState | null = null,
): ShellNavItem[] {
  const items: ShellNavItem[] = [
    { id: 'core.home', label: 'nav.home', icon: HouseIcon, to: '/', order: 0 },
  ];
  if (session?.user?.isSuperadmin === true) {
    items.push(
      { id: 'core.users', label: 'nav.users', icon: UsersIcon, to: '/admin/users', order: 900 },
      {
        id: 'core.invitations',
        label: 'nav.invitations',
        icon: MailPlusIcon,
        to: '/admin/invitations',
        order: 910,
      },
    );
  }
  for (const plugin of plugins) {
    for (const item of plugin.navItems ?? []) {
      items.push({
        id: `${plugin.id}.${item.key}`,
        label: item.label,
        icon: item.icon,
        to: item.to,
        order: item.order ?? DEFAULT_ORDER,
      });
    }
  }
  // Array.prototype.sort is stable, so entries with the same order keep the plugin order.
  return items.sort((a, b) => a.order - b.order);
}

export function useShell(): ShellState {
  const shell = inject(shellKey);
  if (!shell) throw new Error('Shell state is not provided');
  return shell;
}
