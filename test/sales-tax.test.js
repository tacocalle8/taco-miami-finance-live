import assert from 'node:assert/strict';
import test from 'node:test';
import { combineQuarterTax, listSalesTaxQuarters } from '../lib/sales-tax.js';

test('maps quarterly sales tax to the following payment month', () => {
  const quarters = listSalesTaxQuarters(2026);
  assert.deepEqual(quarters.map(row => row.paymentLabel), [
    'Abril 2026', 'Julio 2026', 'Octubre 2026', 'Enero 2027'
  ]);
});

test('subtracts refunded Clover sales tax within each quarter', () => {
  const quarters = combineQuarterTax(
    2026,
    [{ quarter: 1, tax_cents: 12000 }, { quarter: 3, tax_cents: 5000 }],
    [{ quarter: 1, tax_cents: 700 }]
  );
  assert.equal(quarters[0].taxCents, 11300);
  assert.equal(quarters[2].taxCents, 5000);
  assert.equal(quarters[3].taxCents, 0);
});
