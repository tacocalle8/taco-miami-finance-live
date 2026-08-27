import assert from 'node:assert/strict';
import test from 'node:test';
import {
  combineVisitSales,
  listPropertyVisits,
  summarizeVisitsByProperty
} from '../lib/property-visits.js';

test('contains the approved 2026 property calendar without December 31', () => {
  const visits = listPropertyVisits(2026);
  assert.equal(visits.length, 45);
  assert.ok(visits.some(visit => visit.date === '2026-08-04' && visit.propertyName === 'Remi on the River'));
  assert.ok(visits.some(visit => visit.date === '2026-07-29' && visit.propertyName === 'Solena Miramar'));
  assert.ok(visits.some(visit => visit.date === '2026-07-14' && visit.propertyName === 'Grove Station'));
  assert.ok(visits.some(visit => visit.date === '2026-09-23' && visit.propertyName === 'Solena Miramar'));
  assert.ok(visits.some(visit => visit.date === '2026-08-14' && visit.propertyName === 'Grove Station'));
  assert.equal(visits.some(visit => visit.date === '2026-12-31'), false);
});

test('assigns Food Truck Original totals to the scheduled visit date', () => {
  const visits = [{ date: '2026-08-25', propertyName: 'Mirador Doral' }];
  const combined = combineVisitSales(visits, [{
    visit_date: '2026-08-25', payment_amount_cents: 10000, payment_tip_cents: 1000,
    payment_tax_cents: 650, payment_fee_cents: 100, transactions: 12
  }], [{
    visit_date: '2026-08-25', refund_amount_cents: 500, refund_tip_cents: 50,
    refund_tax_cents: 33, refund_fee_cents: 0, refunds: 1
  }]);
  assert.equal(combined[0].netCents, 10550);
  assert.equal(combined[0].netSalesCents, 8883);
  assert.equal(combined[0].taxCents, 617);
  assert.equal(combined[0].transactions, 12);
});

test('summarizes sales and completed visits by property', () => {
  const totals = summarizeVisitsByProperty([
    { propertyName: 'Mirador Doral', netCents: 1000, netSalesCents: 800, taxCents: 65, tipsCents: 100, refundsCents: 0, transactions: 2 },
    { propertyName: 'Mirador Doral', netCents: 0, netSalesCents: 0, taxCents: 0, tipsCents: 0, refundsCents: 0, transactions: 0 }
  ]);
  assert.deepEqual(totals[0], {
    propertyName: 'Mirador Doral', visits: 2, completedVisits: 1, netCents: 1000, netSalesCents: 800,
    taxCents: 65, tipsCents: 100, refundsCents: 0, transactions: 2
  });
});
