import { API_PREFIX, serverListSchema, type ServerSummary } from '@outpost/shared';
import { apiFetch } from '@outpost/web-plugin-api';
import { ref } from 'vue';

/** The servers the signed-in user can see; null until loaded. Sidebar and home page show them. */
export const servers = ref<ServerSummary[] | null>(null);

export async function loadServers(): Promise<ServerSummary[]> {
  const list = (await apiFetch(`${API_PREFIX}/servers`, serverListSchema)).servers;
  servers.value = list;
  return list;
}

/** A short name suggested from the server name: `My Survival!` gives `my-survival`. */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}
