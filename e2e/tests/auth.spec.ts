import { expect, test } from '@playwright/test';
import { totpAt } from '../totp.js';

const SETUP_TOKEN = process.env['OUTPOST_E2E_SETUP_TOKEN'] ?? '';
const USERNAME = 'admin';
const PASSWORD = 'an end-to-end test passphrase';

test.describe.configure({ mode: 'serial' });

let secret = '';

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
