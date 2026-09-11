import type {
  InvestmentPlan,
  InvestmentPreferences,
  RothHoldings,
} from '../investment-contracts.ts';
import { formatMoney } from '../money.ts';

export function buildInvestmentPlan(
  contributionCents: number,
  preferences?: InvestmentPreferences,
  holdings?: RothHoldings,
): InvestmentPlan {
  if (
    !Number.isSafeInteger(contributionCents) ||
    contributionCents < 0 ||
    contributionCents > 100000000
  )
    throw new Error('Invalid contribution amount');
  const base: InvestmentPlan = {
    status: 'needs_review',
    basis: 'proposed_roth_contribution',
    amountCents: 0,
    title: 'Choose how you want to invest',
    explanation:
      'Review your time horizon and comfort with losses in Edit plan assumptions to see an investment mix.',
    preferences: preferences ?? null,
    allocations: [],
    holdings: holdings ?? null,
    execution: 'not_connected',
  };
  if (!contributionCents)
    return {
      ...base,
      status: 'no_contribution',
      title: 'Plan a contribution first',
      explanation:
        'The current cash and eligibility checks suggest no new Roth contribution. Existing Roth holdings remain separate from this contribution preview.',
    };
  if (!preferences?.reviewed || preferences.risk === 'unknown') return base;
  if (preferences.horizonYears < 5)
    return {
      ...base,
      title: 'Review your shorter time horizon',
      explanation:
        'This starter portfolio is for money you can leave invested for at least five years. Review near-term needs before choosing investments; no purchases are suggested.',
    };
  // Illustrative policy, not an optimized portfolio. Medium horizons cap the stock share.
  const requestedStocks = { cautious: 30, balanced: 60, growth: 80 }[
    preferences.risk
  ];
  const stocks =
    preferences.horizonYears < 10
      ? Math.min(40, requestedStocks)
      : requestedStocks;
  const us = Math.round(stocks * 0.6);
  const weights = [us, stocks - us, 100 - stocks];
  const funds = [
    ['U.S. stocks', 'VTI', 'Vanguard Total Stock Market ETF'],
    ['International stocks', 'VXUS', 'Vanguard Total International Stock ETF'],
    ['U.S. bonds', 'BND', 'Vanguard Total Bond Market ETF'],
  ];
  // Largest remainder allocation conserves every cent, including tiny contributions.
  const amounts = weights.map((weight) =>
    Math.floor((contributionCents * weight) / 100),
  );
  const order = weights
    .map((weight, i) => ({ i, remainder: (contributionCents * weight) % 100 }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const left = contributionCents - amounts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < left; i++) amounts[order[i].i]++;
  return {
    ...base,
    status: 'preview',
    amountCents: contributionCents,
    title: `${stocks}% stocks · ${100 - stocks}% bonds`,
    explanation: `An illustrative starting mix for your ${preferences.horizonYears}-year horizon and ${preferences.risk} preference.${stocks !== requestedStocks ? ' The shorter horizon reduces the stock share in this example.' : ''} This splits only the proposed new contribution; it does not rebalance your existing portfolio. Stocks and bonds can both lose value.`,
    allocations: funds.map(([label, exampleTicker, exampleName], i) => ({
      label,
      exampleTicker,
      exampleName,
      percent: weights[i],
      amountCents: amounts[i],
      sourceUrl: `https://investor.vanguard.com/investment-products/etfs/profile/${exampleTicker.toLowerCase()}`,
    })),
  };
}

export function explainInvestmentPlan(plan: InvestmentPlan): string {
  const intro = `**${plan.title}**\n\n${plan.explanation}`;
  if (plan.status !== 'preview')
    return `${intro}\n\nNo investment order was created.`;
  return `${intro}\n\nIf the proposed **${formatMoney(plan.amountCents)}** Roth contribution arrives and is available to trade, this example would allocate:\n\n${plan.allocations.map((a) => `- **${formatMoney(a.amountCents)}** (${a.percent}%) to ${a.label.toLowerCase()} — for example [${a.exampleTicker}](${a.sourceUrl}).`).join('\n')}\n\nThese ETFs are examples, not the only choices. Compare fees, risks and overlap with your existing holdings, or consider a diversified target-date fund. PennyAhead has no Roth contribution approval or trading flow. If you decide to act, review eligibility and make the contribution at your brokerage yourself, then check settled cash, fund availability, fees and fractional shares before reviewing any purchase there. This is a contribution preview, not an order; no money was moved.`;
}
