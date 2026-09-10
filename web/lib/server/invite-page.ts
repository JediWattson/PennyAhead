import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  INVITE_COOKIE,
  inviteRequired,
  validInviteSession,
} from './invite-access';

export async function requireInvitePage() {
  if (
    inviteRequired() &&
    !validInviteSession((await cookies()).get(INVITE_COOKIE)?.value)
  )
    redirect('/unlock');
}
