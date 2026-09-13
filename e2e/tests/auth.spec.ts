import { expect, test, type Page } from '@playwright/test';
import { totpAt } from '../totp.js';

const SETUP_TOKEN = process.env['OUTPOST_E2E_SETUP_TOKEN'] ?? '';
const USERNAME = 'admin';
const PASSWORD = 'an end-to-end test passphrase';

test.describe.configure({ mode: 'serial' });

let secret = '';
let backupCodes: string[] = [];

/** Signs the administrator in with a backup code (authenticator codes may be used up). */
async function signInWithBackupCode(page: Page, code: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(USERNAME);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Use a backup code' }).click();
  await page.getByLabel('Backup code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('first run: create the administrator and turn on two-factor authentication', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByLabel('Setup token').fill(SETUP_TOKEN);
  await page.getByLabel('Username').fill(USERNAME);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repeat the password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText('Administrators must use two-factor authentication')).toBeVisible();

  const card = page.getByTestId('two-factor-card');
  await card.getByRole('button', { name: 'Turn on' }).click();
  secret = ((await card.getByTestId('totp-secret').textContent()) ?? '').replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  await card.getByRole('textbox').fill(totpAt(secret, Date.now()));
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card.getByTestId('backup-codes').getByRole('listitem')).toHaveCount(10);
  backupCodes = await card.getByTestId('backup-codes').getByRole('listitem').allTextContents();
  await card.getByRole('button', { name: 'I have saved them' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'About' })).toBeVisible();
});

test('sign in again with a code and sign out', async ({ page }) => {
  await page.goto('/about');
  // vue-router leaves "/" unencoded in the query string.
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)about$/);

  await page.getByLabel('Username').fill(USERNAME);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter the 6-digit code from your authenticator app.')).toBeVisible();

  // The code that turned 2FA on was used; the next time step is accepted as clock drift.
  await page.getByRole('textbox').fill(totpAt(secret, Date.now() + 30_000));
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { name: 'About Outpost' })).toBeVisible();

  await page.getByRole('button', { name: `Account menu for ${USERNAME}` }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('invite a user who creates an account with the invitation link', async ({ page, browser }) => {
  await signInWithBackupCode(page, backupCodes[0] ?? '');

  await page.getByRole('link', { name: 'Invitations' }).first().click();
  await page.getByLabel('Note').fill('Moderator');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  const link = await page.getByTestId('invitation-link').inputValue();
  expect(link).toMatch(/\/invite\/[\w-]{43}$/);

  // The invited person opens the link in their own browser.
  const guest = await browser.newContext();
  const invited = await guest.newPage();
  await invited.goto(link);
  await expect(invited.getByText('You are invited to Outpost')).toBeVisible();
  await invited.getByLabel('Username').fill('moderator');
  await invited.getByLabel('Password', { exact: true }).fill('a passphrase for the invitation');
  await invited.getByLabel('Repeat the password').fill('a passphrase for the invitation');
  await invited.getByRole('button', { name: 'Create account' }).click();
  await expect(invited).toHaveURL(/\/$/);
  await expect(invited.getByRole('button', { name: 'Account menu for moderator' })).toBeVisible();
  await expect(invited.getByRole('link', { name: 'Users' })).toHaveCount(0);

  // The link works only once.
  const second = await guest.newPage();
  await second.goto(link);
  await expect(second.getByText('Invitation not valid')).toBeVisible();
  await guest.close();

  await page.goto('/admin/users');
  await expect(page.getByTestId('user-moderator')).toContainText('Password');
  await page.goto('/admin/invitations');
  await expect(page.getByRole('row', { name: /Moderator/ })).toContainText('Used');
});

test('add a server and invite a moderator to it', async ({ page, browser }) => {
  await signInWithBackupCode(page, backupCodes[1] ?? '');

  await page.getByRole('button', { name: 'Add server' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Survival');
  await expect(dialog.getByLabel('Short name')).toHaveValue('survival');
  await dialog.getByRole('button', { name: 'Add server' }).click();
  await expect(page).toHaveURL(/\/servers\/survival$/);

  await page.getByRole('link', { name: 'Members' }).click();
  await page.locator('#invite-role').click();
  await page.getByRole('option', { name: 'Moderator' }).click();
  await page.getByRole('button', { name: 'Create invitation' }).click();
  const link = await page.getByTestId('invitation-link').inputValue();

  const guest = await browser.newContext();
  const invited = await guest.newPage();
  await invited.goto(link);
  await expect(invited.getByText('invited you to the server Survival as Moderator')).toBeVisible();
  await invited.getByLabel('Username').fill('survival-mod');
  await invited.getByLabel('Password', { exact: true }).fill('a passphrase for the server');
  await invited.getByLabel('Repeat the password').fill('a passphrase for the server');
  await invited.getByRole('button', { name: 'Create account' }).click();
  await expect(invited).toHaveURL(/\/$/);

  // The moderator sees the server, but not the pages for owners and admins.
  await invited.getByRole('link', { name: 'Survival', exact: true }).click();
  await expect(invited.getByRole('heading', { name: 'Survival' })).toBeVisible();
  await expect(invited.getByText('Moderator').first()).toBeVisible();
  await expect(invited.getByRole('link', { name: 'Members' })).toHaveCount(0);
  await guest.close();

  await page.reload();
  await expect(page.getByTestId('member-survival-mod')).toContainText('Moderator');
});

test('connect the server and see why RCON and the files do not answer', async ({ page }) => {
  await signInWithBackupCode(page, backupCodes[2] ?? '');
  await page.goto('/servers/survival/settings');

  const card = page.getByTestId('connection-card');
  await card.getByLabel('Host').fill('no-such-host.invalid');
  await card.getByLabel('RCON password').fill('a password');
  await card.getByRole('button', { name: 'Test' }).click();
  await expect(card.getByTestId('connection-test')).toContainText(
    'The host name cannot be resolved.',
  );
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('The connection was saved.')).toBeVisible();

  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByTestId('server-reachable')).toContainText('The server does not answer');

  await page.getByRole('link', { name: 'Console' }).click();
  await page.getByLabel('Command', { exact: true }).fill('list');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('console-output')).toContainText(
    'The host name cannot be resolved.',
  );

  // Nothing is mounted below /servers in the test container.
  await page.goto('/servers/survival/settings');
  const files = page.getByTestId('files-card');
  await files.getByLabel('Folder', { exact: true }).fill('survival');
  await files.getByRole('button', { name: 'Test' }).click();
  await expect(files.getByTestId('files-test')).toContainText('The folder does not exist');
});
