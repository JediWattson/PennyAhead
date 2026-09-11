/** Eight operator-authored Friday paychecks, all strictly before the anchor date. */
export function weeklyIncomeTransactions(anchor: string) {
  const date = new Date(`${anchor}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== anchor
  )
    throw new Error('Valid income anchor required');
  const daysSinceFriday = (date.getUTCDay() + 2) % 7 || 7;
  date.setUTCDate(date.getUTCDate() - daysSinceFriday);
  return Array.from({ length: 8 }, (_, index) => {
    const payday = new Date(date);
    payday.setUTCDate(payday.getUTCDate() - index * 7);
    const day = payday.toISOString().slice(0, 10);
    return {
      date_transacted: day,
      date_posted: day,
      amount: -500,
      description: 'PennyAhead Weekly Payroll',
      currency: 'USD',
    };
  });
}
