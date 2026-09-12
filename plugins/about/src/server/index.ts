import { definePlugin, PLUGIN_API_VERSION } from '@outpost/plugin-api';
import { z } from 'zod';
import { ABOUT_PLUGIN_ID, aboutInfoSchema } from '../shared.js';

export default definePlugin({
  id: ABOUT_PLUGIN_ID,
  version: '0.1.0',
  apiVersion: PLUGIN_API_VERSION,

  async setup(ctx) {
    const stored = z.number().safeParse(await ctx.kv.get('installedAt'));
    const installedAt = stored.success ? stored.data : Date.now();
    if (!stored.success) await ctx.kv.set('installedAt', installedAt);

    ctx.http.route({
      method: 'GET',
      url: '/info',
      schema: { response: aboutInfoSchema },
      handler: () => ({
        version: ctx.instance.version,
        installedAt: new Date(installedAt).toISOString(),
        plugins: [...ctx.plugins()],
      }),
    });
  },
});
