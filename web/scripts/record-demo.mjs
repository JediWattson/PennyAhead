import { chromium } from '@playwright/test';
import { mkdir, rename } from 'node:fs/promises';
const output = new URL('../work/demo-video/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  recordVideo: { dir: output, size: { width: 1440, height: 1080 } },
});
const page = await context.newPage();
const video = page.video();
async function caption(text) {
  await page.evaluate((text) => {
    let el = document.getElementById('demo-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-caption';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.cssText =
      'position:fixed;bottom:18px;left:10%;width:80%;padding:16px 24px;background:#123e35;color:white;font:600 20px/1.4 system-ui;box-shadow:0 5px 25px #0003;border-radius:12px;z-index:99999;text-align:center;pointer-events:none';
  }, text);
}
async function hold(ms = 5000) {
  await page.waitForTimeout(ms);
}
try {
  await page.goto(
    process.env.DEMO_URL ?? 'http://127.0.0.1:3000/?scenario=shortfall',
  );
  await caption(
    'PennyAhead · A step ahead of your bills. Synthetic accounts, mock assistant, local simulated transfers.',
  );
  await hold(6500);
  await page.getByRole('tab', { name: 'Bills', exact: true }).click();
  await page.getByTestId('forecast-title').scrollIntoViewIfNeeded();
  await caption(
    '$148.60 available checking. Five estimated bills total $183.96. A $35.36 shortfall appears before the end of two weeks.',
  );
  await hold(6500);
  await page.getByTestId('proposal-title').scrollIntoViewIfNeeded();
  await page
    .getByRole('checkbox', {
      name: 'I approve $35.36 from savings to checking.',
    })
    .waitFor();
  await caption(
    'The background monitor proposes $35.36 from savings, respecting the $1,000 floor and estimated arrival.',
  );
  await hold(6500);
  await page
    .getByRole('checkbox', {
      name: 'I approve $35.36 from savings to checking.',
    })
    .check();
  await caption(
    'The user approves the exact amount and accounts. Chat has no authority to move money.',
  );
  await hold(3500);
  await page
    .getByRole('button', { name: 'Approve $35.36 simulation', exact: true })
    .click();
  await page.getByTestId('transfer-record').scrollIntoViewIfNeeded();
  await caption(
    'Pending: savings is reserved, but checking has not received money. The shortage is still present.',
  );
  await hold(6500);
  await page
    .getByRole('button', { name: 'Simulate success', exact: true })
    .click();
  await page.getByTestId('forecast-title').scrollIntoViewIfNeeded();
  await caption(
    'Simulated success updates the ledger and forecast. Checking now has $183.96; detected bills fit. No bank transfer occurred.',
  );
  await hold(6500);
  await page
    .getByText('Reset simulated money', { exact: true })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Reset simulated money', exact: true })
    .click();
  await page.getByText('Monitoring preferences', { exact: true }).click();
  await page.getByLabel('Savings minimum ($)').fill('1850');
  await page
    .getByRole('button', { name: 'Save monitoring preferences' })
    .click();
  await page
    .getByTestId('funding-proposal')
    .filter({ hasText: 'No eligible savings account' })
    .waitFor({ timeout: 30000 });
  await page.getByTestId('proposal-title').scrollIntoViewIfNeeded();
  await caption(
    'A higher savings floor blocks funding. The backend enforces the restriction rather than claiming coverage.',
  );
  await hold(6500);
  await page.getByLabel('Savings minimum ($)').fill('1000');
  await page.getByLabel('Demo transfer timing').selectOption('delayed');
  await page
    .getByRole('button', { name: 'Save monitoring preferences' })
    .click();
  await page
    .getByTestId('funding-proposal')
    .filter({ hasText: 'too late' })
    .waitFor({ timeout: 30000 });
  await page.getByTestId('proposal-title').scrollIntoViewIfNeeded();
  await caption(
    'Late arrival also blocks funding. Timing is an estimate, never a guarantee.',
  );
  await hold(6500);
  await caption(
    'Built with Next.js, deterministic policies, SQLite and Strands tools. Live model access and bank sandbox verification remain pending.',
  );
  await hold(7000);
  await page.screenshot({ path: `${output}closing.png` });
} catch (error) {
  await page.screenshot({
    path: `${output}recording-failure.png`,
    fullPage: true,
  });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
await rename(await video.path(), `${output}pennyahead-local-walkthrough.webm`);
process.stdout.write(`${output}pennyahead-local-walkthrough.webm\n`);
