import { bankProvider, DEMO_OWNER_ID } from '../lib/server/fixtures.ts';
import { Dashboard } from '../components/dashboard';

export default async function Home() {
  return <Dashboard snapshot={await bankProvider.getSnapshot(DEMO_OWNER_ID)} />;
}
