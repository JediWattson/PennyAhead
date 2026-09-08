export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents))
    throw new Error('Money must be safe integer cents');
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function parseMoney(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))
    throw new Error('Enter dollars with at most two decimal places');
  const [whole, fraction = ''] = value.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000)
    throw new Error('Enter an amount between $0.01 and $1,000,000');
  return cents;
}
