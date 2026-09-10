import { requireInvitePage } from '../lib/server/invite-page';
import { inviteRequired } from '../lib/server/invite-access';
import { LockAccess } from '../components/lock-access';
import { DEMO_OWNER_ID } from '../lib/server/fixtures.ts';
import { getDemoForecast } from '../lib/server/demo-forecast.ts';
import { assistantMode } from '../lib/server/strands-assistant.ts';
import { plaidSandboxEnabled } from '../lib/server/plaid-bank.ts';
export const dynamic = 'force-dynamic';
import { Dashboard } from '../components/dashboard';

export default async function Home() {
  await requireInvitePage();
  return (
    <>
      {inviteRequired() && <LockAccess />}
      <Dashboard
        assistantProvider={assistantMode()}
        sandboxAvailable={plaidSandboxEnabled()}
        initialDemo={await getDemoForecast(DEMO_OWNER_ID)}
      />
    </>
  );
}
