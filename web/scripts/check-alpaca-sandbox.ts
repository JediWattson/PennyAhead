import { brokerConnection } from '../lib/server/alpaca-broker.ts';

// Read-only. Load credentials using node --env-file=.env.local; never print tokens or keys.
const result = await brokerConnection();
console.log(JSON.stringify(result, null, 2));
if (result.status === 'unavailable' || result.status === 'not_configured')
  process.exitCode = 1;
