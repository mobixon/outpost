import { ref } from 'vue';

export interface Flash {
  kind: 'error' | 'success';
  message: string;
  /** The page that shows the message; it disappears when the user moves on. */
  path: string;
}

/** A one-time message for the page a redirect leads to (see AuthReturnPage and FlashMessage). */
export const flash = ref<Flash | null>(null);
