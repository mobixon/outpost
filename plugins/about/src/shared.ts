import { pluginInfoSchema } from '@outpost/shared';
import { z } from 'zod';

export const ABOUT_PLUGIN_ID = 'outpost.about';

export const aboutInfoSchema = z.object({
  version: z.string(),
  /** ISO 8601 time of the first start of this instance. */
  installedAt: z.string(),
  plugins: z.array(pluginInfoSchema),
});
export type AboutInfo = z.infer<typeof aboutInfoSchema>;
