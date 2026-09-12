import { API_PREFIX, sudoResultSchema } from '@outpost/shared';
import { ApiError, apiSend } from '@outpost/web-plugin-api';
import { ref } from 'vue';

interface PendingConfirmation {
  resolve: () => void;
  reject: (error: Error) => void;
}

/** Set while the password dialog is open (see SudoDialog.vue). */
export const sudoRequest = ref<PendingConfirmation | null>(null);

export class SudoCancelled extends Error {
  override name = 'SudoCancelled';
}

/**
 * Runs an action; when the server first wants the password confirmed (sudo mode), asks for it
 * and runs the action again. Rejects with SudoCancelled when the user closes the dialog.
 */
export async function withSudo<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'sudo_required')) throw error;
    await new Promise<void>((resolve, reject) => {
      sudoRequest.value = { resolve, reject };
    });
    return action();
  }
}

export async function confirmSudo(password: string): Promise<void> {
  await apiSend('POST', `${API_PREFIX}/auth/sudo`, { password }, sudoResultSchema);
  sudoRequest.value?.resolve();
  sudoRequest.value = null;
}

export function cancelSudo(): void {
  sudoRequest.value?.reject(new SudoCancelled());
  sudoRequest.value = null;
}
