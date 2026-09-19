/**
 * Services plugins offer each other through `ctx.services`. A plugin adds its own by declaration
 * merging, and the plugins that use it name it in `dependsOn`:
 *
 * ```ts
 * declare module '@outpost/plugin-api' {
 *   interface OutpostServices {
 *     'acme.economy': { balance(userId: string): Promise<number> };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OutpostServices {}

export type ServiceName = keyof OutpostServices;

export interface Services {
  /** Offers a service under a name, during `setup`. Throws when the name is taken. */
  provide<K extends ServiceName>(name: K, service: OutpostServices[K]): void;
  /** The service of another plugin; undefined when it is not provided, e.g. when it is disabled. */
  get<K extends ServiceName>(name: K): OutpostServices[K] | undefined;
}
