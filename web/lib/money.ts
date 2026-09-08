export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents))
    throw new Error('Money must be safe integer cents');
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}
