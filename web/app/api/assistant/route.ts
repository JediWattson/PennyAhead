import { bankProvider, DEMO_OWNER_ID } from '../../../lib/server/fixtures.ts';
import { MockAssistant } from '../../../lib/server/mock-assistant.ts';
const assistant = new MockAssistant(bankProvider);
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send a JSON message.' }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== 'object' ||
    !('message' in body) ||
    typeof body.message !== 'string' ||
    !body.message.trim() ||
    body.message.length > 1000
  ) {
    return Response.json(
      { error: 'Enter a message between 1 and 1,000 characters.' },
      { status: 400 },
    );
  }
  // No owner/account IDs are accepted from the browser or the assistant.
  return Response.json(await assistant.reply(DEMO_OWNER_ID, body.message), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
