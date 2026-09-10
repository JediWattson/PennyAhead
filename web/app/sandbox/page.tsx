import { requireInvitePage } from '../../lib/server/invite-page';
import { inviteRequired } from '../../lib/server/invite-access';
import { LockAccess } from '../../components/lock-access';
import { SandboxDashboard } from '../../components/sandbox-dashboard';
export const dynamic = 'force-dynamic';
export default async function SandboxPage() {
  await requireInvitePage();
  return (
    <>
      {inviteRequired() && <LockAccess />}
      <SandboxDashboard />
    </>
  );
}
