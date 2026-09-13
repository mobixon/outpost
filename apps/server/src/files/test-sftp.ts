// Helpers for tests against a real SFTP server (OUTPOST_TEST_SFTP_URL).
import { randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import type { SFTPWrapper, Stats } from 'ssh2';

/** Runs an SFTP call with a callback as a promise. */
export function sftpCall<T = void>(
  action: (done: (err?: Error | null, value?: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    action((err, value) => (err ? reject(err) : resolve(value as T)));
  });
}

/** Creates a folder with `server.properties` and an empty `world` on the SFTP server. */
export async function createServerFolder(sftp: SFTPWrapper, base: string): Promise<string> {
  const folder = posix.join(base, `test-${randomBytes(4).toString('hex')}`);
  await sftpCall((done) => sftp.mkdir(folder, done));
  await sftpCall((done) => sftp.mkdir(`${folder}/world`, done));
  await sftpCall((done) =>
    sftp.writeFile(`${folder}/server.properties`, 'level-name=world\nonline-mode=false\n', done),
  );
  return folder;
}

/** Deletes a folder with everything in it. */
export async function removeTree(sftp: SFTPWrapper, directory: string): Promise<void> {
  const entries = await sftpCall<{ filename: string; attrs: Stats }[]>((done) =>
    sftp.readdir(directory, done),
  );
  for (const entry of entries) {
    const path = posix.join(directory, entry.filename);
    if (entry.attrs.isDirectory()) await removeTree(sftp, path);
    else await sftpCall((done) => sftp.unlink(path, done));
  }
  await sftpCall((done) => sftp.rmdir(directory, done));
}
