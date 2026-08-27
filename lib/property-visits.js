const EVENT_TIME = '5:00–10:00 pm';

const schedules = {
  'Windsor Doral': [
    '2026-08-11', '2026-09-01', '2026-09-22', '2026-10-13',
    '2026-11-03', '2026-11-24', '2026-12-15'
  ],
  'Céntrico Doral': [
    '2026-08-18', '2026-09-08', '2026-09-29', '2026-10-20',
    '2026-11-10', '2026-12-01', '2026-12-22'
  ],
  'Mirador Doral': [
    '2026-08-25', '2026-09-15', '2026-10-06', '2026-10-27',
    '2026-11-17', '2026-12-08', '2026-12-29'
  ],
  'Remi on the River': [
    '2026-08-04', '2026-08-19', '2026-09-02', '2026-09-16', '2026-09-30', '2026-10-14',
    '2026-10-28', '2026-11-11', '2026-11-25', '2026-12-09', '2026-12-23'
  ],
  'Grove Station': [
    '2026-07-14', '2026-08-14', '2026-08-27', '2026-09-10', '2026-09-24', '2026-10-08',
    '2026-10-22', '2026-11-05', '2026-11-19', '2026-12-03', '2026-12-17'
  ],
  'Solena Miramar': ['2026-07-29', '2026-09-23']
};

export function listPropertyVisits(year = 2026) {
  return Object.entries(schedules)
    .flatMap(([propertyName, dates]) => dates.map(date => ({
      id: `${date}:${propertyName}`,
      date,
      propertyName,
      eventTime: EVENT_TIME,
      storeKey: 'original'
    })))
    .filter(visit => visit.date.startsWith(`${year}-`))
    .sort((a, b) => a.date.localeCompare(b.date) || a.propertyName.localeCompare(b.propertyName));
}

function rowsByDate(rows) {
  return new Map((rows || []).map(row => [String(row.visit_date), row]));
}

export function combineVisitSales(visits, paymentRows = [], refundRows = []) {
  const payments = rowsByDate(paymentRows);
  const refunds = rowsByDate(refundRows);
  return visits.map(visit => {
    const payment = payments.get(visit.date) || {};
    const refund = refunds.get(visit.date) || {};
    const paymentsCents = Number(payment.payment_amount_cents) || 0;
    const tipsCents = Number(payment.payment_tip_cents) || 0;
    const paymentTaxCents = Number(payment.payment_tax_cents) || 0;
    const feesCents = Number(payment.payment_fee_cents) || 0;
    const refundedAmountCents = Number(refund.refund_amount_cents) || 0;
    const refundedTipsCents = Number(refund.refund_tip_cents) || 0;
    const refundedTaxCents = Number(refund.refund_tax_cents) || 0;
    const refundedFeesCents = Number(refund.refund_fee_cents) || 0;
    const refundsCents = refundedAmountCents + refundedTipsCents + refundedFeesCents;
    return {
      ...visit,
      paymentsCents,
      tipsCents,
      taxCents: Math.max(0, paymentTaxCents - refundedTaxCents),
      feesCents,
      refundsCents,
      netSalesCents: Math.max(0, paymentsCents - paymentTaxCents - Math.max(0, refundedAmountCents - refundedTaxCents)),
      netCents: paymentsCents + tipsCents + feesCents - refundsCents,
      transactions: Number(payment.transactions) || 0,
      refunds: Number(refund.refunds) || 0
    };
  });
}

export function summarizeVisitsByProperty(visits) {
  const totals = new Map();
  for (const visit of visits) {
    const row = totals.get(visit.propertyName) || {
      propertyName: visit.propertyName,
      visits: 0,
      completedVisits: 0,
      netCents: 0,
      netSalesCents: 0,
      taxCents: 0,
      tipsCents: 0,
      refundsCents: 0,
      transactions: 0
    };
    row.visits += 1;
    if (visit.transactions || visit.refunds) row.completedVisits += 1;
    row.netCents += Number(visit.netCents) || 0;
    row.netSalesCents += Number(visit.netSalesCents) || 0;
    row.taxCents += Number(visit.taxCents) || 0;
    row.tipsCents += Number(visit.tipsCents) || 0;
    row.refundsCents += Number(visit.refundsCents) || 0;
    row.transactions += Number(visit.transactions) || 0;
    totals.set(visit.propertyName, row);
  }
  return [...totals.values()].sort((a, b) => a.propertyName.localeCompare(b.propertyName));
}
