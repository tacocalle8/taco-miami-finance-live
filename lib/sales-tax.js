const quarterDefinitions = [
  { quarter: 1, periodLabel: 'Enero–Marzo', paymentMonth: 'Abril' },
  { quarter: 2, periodLabel: 'Abril–Junio', paymentMonth: 'Julio' },
  { quarter: 3, periodLabel: 'Julio–Septiembre', paymentMonth: 'Octubre' },
  { quarter: 4, periodLabel: 'Octubre–Diciembre', paymentMonth: 'Enero' }
];

export function listSalesTaxQuarters(year) {
  return quarterDefinitions.map(definition => ({
    ...definition,
    id: `${year}-Q${definition.quarter}`,
    year,
    paymentYear: definition.quarter === 4 ? year + 1 : year,
    paymentLabel: `${definition.paymentMonth} ${definition.quarter === 4 ? year + 1 : year}`,
    taxCents: 0
  }));
}

export function combineQuarterTax(year, paymentRows = [], refundRows = []) {
  const payments = new Map(paymentRows.map(row => [Number(row.quarter), Number(row.tax_cents) || 0]));
  const refunds = new Map(refundRows.map(row => [Number(row.quarter), Number(row.tax_cents) || 0]));
  return listSalesTaxQuarters(year).map(row => ({
    ...row,
    taxCents: Math.max(0, (payments.get(row.quarter) || 0) - (refunds.get(row.quarter) || 0))
  }));
}
