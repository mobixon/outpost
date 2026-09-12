import { PERMISSION_KEY_PATTERN, type PermissionDeclaration } from '@outpost/plugin-api';
import { CorePermission, ROLE_KEYS, type RoleKey } from '@outpost/shared';

/** Higher ranks manage lower ones. */
export const ROLE_RANK: Readonly<Record<RoleKey, number>> = {
  owner: 4,
  admin: 3,
  moderator: 2,
  viewer: 1,
};

const CORE_PERMISSIONS: readonly PermissionDeclaration[] = [
  { key: CorePermission.view, roles: ['owner', 'admin', 'moderator', 'viewer'] },
  { key: CorePermission.manage, roles: ['owner'] },
  { key: CorePermission.members, roles: ['owner', 'admin'] },
  { key: CorePermission.audit, roles: ['owner', 'admin'] },
];

/**
 * All permissions of the instance: the core's and those declared by enabled plugins, with the
 * built-in roles that have them.
 */
export class PermissionRegistry {
  readonly #declaredBy = new Map<string, string>();
  readonly #byRole = new Map<RoleKey, Set<string>>(ROLE_KEYS.map((role) => [role, new Set()]));

  constructor() {
    for (const permission of CORE_PERMISSIONS) this.register('the core', permission);
  }

  register(source: string, { key, roles }: PermissionDeclaration): void {
    if (!PERMISSION_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid permission key "${key}" of ${source}: expected e.g. "players.kick"`);
    }
    const existing = this.#declaredBy.get(key);
    if (existing !== undefined) {
      throw new Error(`Permission "${key}" of ${source} is already declared by ${existing}`);
    }
    this.#declaredBy.set(key, source);
    for (const role of roles) this.#byRole.get(role)?.add(key);
  }

  has(key: string): boolean {
    return this.#declaredBy.has(key);
  }

  keys(): string[] {
    return [...this.#declaredBy.keys()];
  }

  forRole(role: RoleKey): ReadonlySet<string> {
    return this.#byRole.get(role) ?? new Set();
  }
}

/**
 * Whether someone with the `actor` role may give `role` to a member, or change and remove a member
 * who has it: superadmins and owners manage every role, others only lower ones.
 */
export function canManageRole(actor: RoleKey | 'superadmin', role: RoleKey): boolean {
  if (actor === 'superadmin' || actor === 'owner') return true;
  return ROLE_RANK[role] < ROLE_RANK[actor];
}
