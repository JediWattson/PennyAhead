import { expect, test } from '@playwright/test';
import {
  FixtureBankProvider,
  DEMO_NOW,
  DEMO_OWNER_ID,
} from '../lib/server/fixtures.ts';
import { buildForecast } from '../lib/server/forecast.ts';
import { buildGrowthPlan } from '../lib/server/growth-plan.ts';
import type { DemoForecast } from '../lib/contracts.ts';

for (const sandbox of [false, true]) {
  test(`${sandbox ? 'Sandbox' : 'synthetic'} chat includes completed history, retries without duplicates and clears context`, async ({
    page,
  }) => {
    if (sandbox) {
      const snapshot = await new FixtureBankProvider('growth').getSnapshot(
        DEMO_OWNER_ID,
      );
      snapshot.source = 'plaid_sandbox';
      const view: DemoForecast = {
        clock: 'provider-observation',
        snapshotId: 'test-observation',
        scenario: 'growth',
        corrections: [],
        snapshot,
        forecast: buildForecast(snapshot, snapshot.accounts[0].id, DEMO_NOW),
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
    const requests: Array<{
      message: string;
      history?: Array<{ role: string; text: string }>;
    }> = [];
    let fail = false;
    await page.route(
      sandbox ? '**/api/sandbox/assistant' : '**/api/assistant',
      (route) => {
        const input = route.request().postDataJSON();
        requests.push(input);
        return fail
          ? route.fulfill({
              status: 503,
              json: { error: 'Temporary AI failure.' },
            })
          : route.fulfill({
              json: {
                mode: 'mock',
                source: sandbox ? 'plaid_sandbox' : 'synthetic',
                reads: [],
                text: `Reply to: ${input.message}`,
                asOf: DEMO_NOW,
              },
            });
      },
    );
    await page.goto(sandbox ? '/sandbox' : '/');
    const send = async (message: string) => {
      await page.getByLabel('Ask about your demo accounts').fill(message);
      await page.getByRole('button', { name: 'Send message' }).click();
      if (fail)
        await expect(
          page.locator('.error-message[role="alert"]'),
        ).toContainText(
          sandbox ? 'Temporary AI failure' : 'The assistant could not answer',
        );
      else
        await expect(page.getByRole('log')).toContainText(
          `Reply to: ${message}`,
        );
    };
    await send('Call this the Rainy Day Plan.');
    expect(requests[0].history).toBeUndefined();
    await send('What did I call it?');
    expect(requests[1].history).toEqual([
      { role: 'user', text: 'Call this the Rainy Day Plan.' },
      { role: 'assistant', text: 'Reply to: Call this the Rainy Day Plan.' },
    ]);
    fail = true;
    await send('Explain that again.');
    expect(requests[2].history).toHaveLength(4);
    fail = false;
    await send('Explain that again.');
    expect(requests[3].history).toEqual(requests[2].history);
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(page.getByRole('log')).toBeEmpty();
    await send('Starting fresh.');
    expect(requests[4].history).toBeUndefined();
    if (sandbox) {
      await page.getByRole('button', { name: 'Refresh Sandbox data' }).click();
    } else {
      await page
        .getByRole('tab', { name: 'Save & invest', exact: true })
        .click();
      await page.getByText('Edit plan assumptions', { exact: true }).click();
      await page
        .getByLabel('Comfort with investment losses')
        .selectOption('growth');
      await page
        .getByRole('button', { name: 'Update plan', exact: true })
        .click();
    }
    await expect(page.getByRole('log')).toBeEmpty();
    await send('Use the new context.');
    expect(requests[5].history).toBeUndefined();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('button', { name: 'New chat', exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await expect(
      page.getByRole('button', { name: 'New chat', exact: true }),
    ).toBeEnabled();
    await page.mouse.move(0, 0);
    await page.screenshot({
      animations: 'disabled',
      path: `work/chat-context-${sandbox ? 'sandbox' : 'synthetic'}-390.png`,
    });
  });
}
