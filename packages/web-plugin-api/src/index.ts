/**
 * Public web UI contracts for Outpost plugins. The web part of a plugin is bundled into the
 * Outpost web app and shown only when the server reports the plugin as enabled.
 */
import { isValidPluginId } from '@outpost/shared';
import type { Component } from 'vue';
import type { RouteRecordRaw } from 'vue-router';

export { ApiError, apiFetch, apiSend, onUnauthenticated, type SendMethod } from './api.js';
export { findMissingMessageKeys, type LocaleMessages } from './messages.js';
export * from './server.js';
import type { LocaleMessages } from './messages.js';
import { RESERVED_SERVER_TAB_KEYS, type ServerTab } from './server.js';

const SERVER_TAB_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Web plugin API version implemented by this package. */
export const WEB_PLUGIN_API_VERSION = 1;

export interface NavItem {
  /** Unique key within the plugin. */
  key: string;
  /** i18n key of the label. */
  label: string;
  /** Icon component, e.g. `InfoIcon` from `@lucide/vue`. */
  icon: Component;
  /** Route path to open. */
  to: string;
  /** Position in the sidebar; lower comes first. Defaults to 500. */
  order?: number;
}

export interface WebPluginDefinition {
  /** Same id as the server part of the plugin. */
  id: string;
  apiVersion: number;
  routes?: RouteRecordRaw[];
  navItems?: NavItem[];
  /** Tabs on the page of a game server, shown to users with the permission. */
  serverTabs?: ServerTab[];
  /**
   * Translations per locale; `en` is required and used when a locale is missing. Keep all keys
   * under one top-level key unique to the plugin (e.g. `about`): the messages of all plugins are
   * merged into one catalog.
   */
  messages?: { en: LocaleMessages } & Record<string, LocaleMessages>;
}

export class WebPluginDefinitionError extends Error {
  override name = 'WebPluginDefinitionError';
}

/** Validates a web plugin definition and returns it unchanged. */
export function defineWebPlugin<T extends WebPluginDefinition>(plugin: T): T {
  if (!isValidPluginId(plugin.id)) {
    throw new WebPluginDefinitionError(`Invalid plugin id "${plugin.id}"`);
  }
  if (plugin.apiVersion !== WEB_PLUGIN_API_VERSION) {
    throw new WebPluginDefinitionError(
      `Web plugin "${plugin.id}" targets web plugin API v${plugin.apiVersion}, but this Outpost supports v${WEB_PLUGIN_API_VERSION}`,
    );
  }
  for (const tab of plugin.serverTabs ?? []) {
    if (!SERVER_TAB_KEY_PATTERN.test(tab.key) || RESERVED_SERVER_TAB_KEYS.includes(tab.key)) {
      throw new WebPluginDefinitionError(
        `Web plugin "${plugin.id}" has an invalid or reserved server tab key "${tab.key}"`,
      );
    }
  }
  return plugin;
}
