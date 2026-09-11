/** Fictional labels for operator-authored Sandbox activity only. */
export const DEMO_MERCHANT_RENAMES: Record<string, string> = {
  'PennyAhead Mobile': 'Cedar Wireless',
  'PennyAhead Home Internet': 'Harbor Home Internet',
  'PennyAhead Gym': 'Summit Athletics',
  'PennyAhead Electric': 'Northstar Electric',
  'PennyAhead Neighborhood Market': 'Maple Street Market',
  'PennyAhead Corner Coffee': 'Juniper Roasters',
  'PennyAhead Paycheck': 'Oakridge Design Paycheck',
  'PennyAhead Savings Deposit': 'Transfer to Savings',
  'PennyAhead Savings Interest': 'Savings Interest Credit',
  'PennyAhead Weekly Payroll': 'Riverton Labs Payroll',
};
export function renameDemoMerchant(description: string): string {
  const name = DEMO_MERCHANT_RENAMES[description];
  if (!name && /^pennyahead/i.test(description))
    throw new Error('Unrecognized authored demo merchant');
  return name ?? description;
}
