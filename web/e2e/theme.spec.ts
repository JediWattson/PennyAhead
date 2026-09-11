import { expect, test } from '@playwright/test';
import {
  FixtureBankProvider,
  DEMO_OWNER_ID,
  DEMO_NOW,
} from '../lib/server/fixtures.ts';
import { buildForecast } from '../lib/server/forecast.ts';
import { buildGrowthPlan } from '../lib/server/growth-plan.ts';
import type { DemoForecast } from '../lib/contracts.ts';

const darkBackground = 'rgb(16, 27, 40)';
const lightBackground = 'rgb(244, 246, 250)';

test('theme follows the system, preserves drafts, remembers explicit choice and syncs between pages', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const theme = page.getByLabel('Color theme');
  await expect(theme).toHaveValue('system');
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    darkBackground,
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    lightBackground,
  );
  await page.getByLabel('Ask about your demo accounts').fill('Keep this draft');
  await page.getByRole('tab', { name: 'Save & invest', exact: true }).click();
  await theme.selectOption('dark');
  await expect(page.getByLabel('Ask about your demo accounts')).toHaveValue(
    'Keep this draft',
  );
  await expect(
    page.getByRole('tab', { name: 'Save & invest', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(theme).toHaveValue('dark');
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    darkBackground,
  );
  const other = await context.newPage();
  await other.goto('/unlock');
  await expect(other.getByLabel('Color theme')).toHaveValue('dark');
  await other.getByLabel('Color theme').selectOption('light');
  await expect(theme).toHaveValue('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    lightBackground,
  );
  await theme.selectOption('system');
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    darkBackground,
  );
  await other.close();
});

test('saved dark preference paints before hydration and storage failures still allow switching', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() =>
    localStorage.setItem('pennyahead-theme', 'dark'),
  );
  await page.route('**/_next/**/*.js', (route) => route.abort());
  await page.goto('/unlock', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveClass('dark');
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    darkBackground,
  );
  await expect(page.locator('.invite-card')).toHaveCSS(
    'background-color',
    'rgb(25, 40, 55)',
  );
  await page.unroute('**/_next/**/*.js');
  await page.reload();
  await expect(page.getByLabel('Color theme')).toHaveValue('dark');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage unavailable');
    };
  });
  await page.getByLabel('Color theme').selectOption('light');
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    lightBackground,
  );
  await expect(page.getByLabel('Color theme')).toHaveValue('light');
});

for (const sandbox of [false, true]) {
  test(`${sandbox ? 'Sandbox' : 'synthetic'} screens render light and dark themes at desktop and mobile widths`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (sandbox) {
      const snapshot = await new FixtureBankProvider('growth').getSnapshot(
        DEMO_OWNER_ID,
      );
      snapshot.source = 'plaid_sandbox';
      const view: DemoForecast = {
        clock: 'provider-observation',
        snapshotId: 'theme-observation',
        scenario: 'growth',
        corrections: [],
        snapshot,
        forecast: buildForecast(snapshot, snapshot.accounts[0].id, DEMO_NOW),
        sampleRothProfile: true,
      };
      await page.route('**/api/sandbox', (route) =>
        route.fulfill({ json: view }),
      );
      await page.route('**/api/sandbox/growth', (route) =>
        route.fulfill({
          json: buildGrowthPlan(view, route.request().postDataJSON().growth, 0),
        }),
      );
    }
    await page.goto(sandbox ? '/sandbox' : '/');
    await expect(page.getByLabel('Color theme')).toBeVisible();
    await page.route(
      sandbox ? '**/api/sandbox/assistant' : '**/api/assistant',
      (route) =>
        route.fulfill({
          json: {
            mode: 'mock',
            source: sandbox ? 'plaid_sandbox' : 'synthetic',
            asOf: DEMO_NOW,
            reads: ['get_accounts'],
            text: '**Your plan** keeps spending cash available.\n\n| Plan | Amount |\n| --- | --- |\n| Example contribution | $250.00 |\n\n```js\nconst preview = true;\n```',
          },
        }),
    );
    await page
      .getByLabel('Ask about your demo accounts')
      .fill('Explain my plan');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('log')).toContainText('Your plan');
    for (const mode of ['dark', 'light']) {
      await page.getByLabel('Color theme').selectOption(mode);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1050 });
        for (const tab of ['Overview', 'Save & invest', 'Bills']) {
          await page.getByRole('tab', { name: tab, exact: true }).click();
          if (tab === 'Save & invest')
            await expect(page.locator('.growth-card')).toBeVisible();
          await page.evaluate(() => scrollTo(0, 0));
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.screenshot({
            path: `work/theme-${sandbox ? 'sandbox' : 'synthetic'}-${mode}-${width}-${tab.split(' ')[0].toLowerCase()}.png`,
            animations: 'disabled',
          });
        }
        await page
          .locator('.assistant-panel')
          .screenshot({
            path: `work/theme-chat-${sandbox ? 'sandbox' : 'synthetic'}-${mode}-${width}.png`,
            animations: 'disabled',
          });
      }
    }
    expect(errors).toEqual([]);
  });
}
