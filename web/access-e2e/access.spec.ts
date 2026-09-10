import { test, expect } from '@playwright/test';

const token = 'a'.repeat(43);
test('public pages redirect and every data API blocks direct requests and proxy-bypass headers', async ({
  page,
  request,
}) => {
  for (const path of ['/', '/sandbox', '/?token=' + token]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/unlock$/);
    await expect(
      page.getByRole('heading', { name: 'A step ahead starts here.' }),
    ).toBeVisible();
    await expect(page.getByTestId('proposal-title')).toHaveCount(0);
  }
  for (const path of [
    '/api/accounts',
    '/api/forecast',
    '/api/monitor',
    '/api/assistant',
    '/api/transfers',
    '/api/sandbox',
    '/api/sandbox/assistant',
  ]) {
    for (const method of ['GET', 'POST', 'PATCH']) {
      const response = await request.fetch(path, {
        method,
        headers: { 'x-middleware-subrequest': 'proxy:proxy:proxy:proxy:proxy' },
      });
      expect(response.status(), `${method} ${path}`).toBe(401);
      expect(await response.json()).toMatchObject({ code: 'INVITE_REQUIRED' });
    }
  }
  expect((await request.get('/api/health')).status()).toBe(200);
});

test('mobile token entry unlocks the working demo, keeps access private, and locks again', async ({
  page,
  context,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/unlock');
  await page.screenshot({ path: 'work/access-mobile.png', fullPage: true });
  await page.getByLabel('Invitation token').fill('wrong-token');
  await page.getByRole('button', { name: 'Unlock PennyAhead' }).click();
  await expect(page.locator('#invite-error')).toContainText('invalid');
  await page.screenshot({ path: 'work/access-mobile-error.png', fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.getByLabel('Invitation token').fill(token);
  await page.getByRole('button', { name: 'Unlock PennyAhead' }).click();
  await expect(page.getByTestId('proposal-title')).toContainText('$35.36', {
    timeout: 15000,
  });
  const access = (await context.cookies()).find(
    (cookie) => cookie.name === 'pennyahead_access',
  )!;
  expect(access.httpOnly).toBe(true);
  expect(access.secure).toBe(true);
  expect(access.sameSite).toBe('Strict');
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    'pennyahead_access',
  );
  await page
    .getByRole('checkbox', {
      name: 'I approve $35.36 from savings to checking.',
    })
    .check();
  await page
    .getByRole('button', { name: 'Approve $35.36 simulation', exact: true })
    .click();
  await expect(page.getByTestId('transfer-record')).toContainText('pending');
  await page
    .getByRole('button', { name: 'Simulate success', exact: true })
    .click();
  await expect(page.getByTestId('transfer-record')).toContainText('completed');
  await page.getByRole('button', { name: 'What are my balances?' }).click();
  await expect(page.getByRole('log')).toContainText('$183.96');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Lock this browser' }),
  ).toBeVisible();
  const other = await browser.newContext();
  const outsider = await other.newPage();
  await outsider.goto('http://127.0.0.1:3003/');
  await expect(outsider).toHaveURL(/\/unlock$/);
  await other.close();
  await page.getByRole('button', { name: 'Lock this browser' }).click();
  await expect(page).toHaveURL(/\/unlock$/);
  expect((await context.request.get('/api/accounts')).status()).toBe(401);
});

test('private link clears its fragment, produces separate browser sessions, and rejects an expired cookie', async ({
  page,
  context,
  browser,
}) => {
  const observed: string[] = [];
  page.on('request', (request) => observed.push(request.url()));
  await page.goto('/unlock#token=' + token);
  await expect(page.getByTestId('proposal-title')).toContainText('$35.36', {
    timeout: 15000,
  });
  expect(page.url()).not.toContain(token);
  expect(observed.every((url) => !url.includes(token))).toBe(true);
  const cookie = (await context.cookies()).find(
    (value) => value.name === 'pennyahead_access',
  )!;
  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await secondPage.goto('http://127.0.0.1:3003/unlock#token=' + token);
  await expect(secondPage.getByTestId('proposal-title')).toContainText(
    '$35.36',
    { timeout: 15000 },
  );
  const secondCookie = (await second.cookies()).find(
    (value) => value.name === 'pennyahead_access',
  )!;
  expect(secondCookie.value).not.toBe(cookie.value);
  const firstMonitor = await page.evaluate(async () => {
    const response = await fetch('/api/monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenario: 'shortfall',
        corrections: [],
        enabled: true,
        savingsMinimumCents: 100000,
        timing: 'standard',
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(firstMonitor.status).toBe(201);
  expect(firstMonitor.body.id).toBeTruthy();
  expect(
    await secondPage.evaluate(async () => (await fetch('/api/monitor')).status),
  ).toBe(404);
  // Browser expiration removes an otherwise valid cookie; signed timestamp expiry is tested at the API layer.
  await context.addCookies([
    { ...cookie, expires: Math.floor(Date.now() / 1000) - 1 },
  ]);
  await page.goto('/');
  await expect(page).toHaveURL(/\/unlock$/);
  await second.close();
});
