import { requireInvitePage } from '../lib/server/invite-page';
import { inviteRequired } from '../lib/server/invite-access';
import { LockAccess } from '../components/lock-access';
import { DEMO_OWNER_ID } from '../lib/server/fixtures.ts';
import {
  parseDemoOptions,
  getDemoForecast,
} from '../lib/server/demo-forecast.ts';
import { assistantMode } from '../lib/server/strands-assistant.ts';
import { plaidSandboxEnabled } from '../lib/server/plaid-bank.ts';
export const dynamic = 'force-dynamic';
import { Dashboard } from '../components/dashboard';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  await requireInvitePage();
  const requested = (await searchParams).scenario;
  let options = parseDemoOptions({ scenario: 'growth' });
  try {
    options = parseDemoOptions({ scenario: requested ?? 'growth' });
  } catch {
    /* Unknown demo links open the primary growth scenario. */
  }
  return (
    <>
      {inviteRequired() && <LockAccess />}
      <Dashboard
        assistantProvider={assistantMode()}
        sandboxAvailable={plaidSandboxEnabled()}
        initialDemo={await getDemoForecast(DEMO_OWNER_ID, options)}
      />
    </>
  );
}
