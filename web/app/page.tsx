import { DEMO_OWNER_ID } from '../lib/server/fixtures.ts';
import { getDemoForecast } from '../lib/server/demo-forecast.ts';
import { Dashboard } from '../components/dashboard';

export default async function Home() {
  return <Dashboard initialDemo={await getDemoForecast(DEMO_OWNER_ID)} />;
}
