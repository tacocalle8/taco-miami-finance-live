import assert from 'node:assert/strict';
import test from 'node:test';
import {
  combineVisitSales,
  listPropertyVisits,
  summarizeVisitsByProperty
} from '../lib/property-visits.js';

test('contains the approved 2026 property calendar without December 31', () => {
  const visits = listPropertyVisits(2026);
  assert.equal(visits.length, 66);
  assert.equal(visits.some(visit => visit.date === '2026-10-21' && visit.propertyName === 'Remi on the River'), false);
  assert.ok(visits.some(visit => visit.date === '2026-08-04' && visit.propertyName === 'Remi on the River'));
  assert.ok(visits.some(visit => visit.date === '2026-07-29' && visit.propertyName === 'Solena Miramar'));
  assert.ok(visits.some(visit => visit.date === '2026-07-14' && visit.propertyName === 'Grove Station'));
  assert.equal(visits.some(visit => visit.date === '2026-09-23' && visit.propertyName === 'Solena Miramar'), false);
  assert.ok(visits.some(visit => visit.date === '2026-08-14' && visit.propertyName === 'Grove Station'));
  assert.equal(visits.some(visit => visit.date === '2026-12-31'), false);
  assert.equal(visits.find(visit => visit.date === '2026-07-14' && visit.propertyName === 'Grove Station').storeKey, 'shell');
  assert.equal(visits.find(visit => visit.date === '2026-08-14' && visit.propertyName === 'Grove Station').storeKey, 'original');
  for (const date of ['2026-09-23', '2026-10-07', '2026-10-19', '2026-11-04', '2026-11-18', '2026-12-02', '2026-12-16', '2026-12-30']) {
    assert.ok(visits.some(visit => visit.date === date && visit.propertyName === 'Remi on the River'));
  }
});

test('assigns approved AMLI Mondays to On Tour while keeping Wednesdays for Remi', () => {
  const visits = listPropertyVisits(2026);
  const amli = visits.filter(visit => visit.propertyName === 'AMLI 8800' && visit.date >= '2026-10-26');
  assert.equal(amli.length, 10);
  assert.equal(amli[0].date, '2026-10-26');
  assert.equal(amli.at(-1).date, '2026-12-28');
  for (const visit of amli) {
    assert.equal(new Date(`${visit.date}T12:00:00Z`).getUTCDay(), 1);
    assert.equal(visit.storeKey, 'original');
    assert.equal(visit.eventTime, '5:00–10:00 pm');
    assert.equal(visits.filter(other => other.date === visit.date && other.storeKey === 'original').length, 1);
  }
  const combined = combineVisitSales(visits, [
    { store_key: 'original', visit_date: '2026-11-02', payment_amount_cents: 10000, transactions: 4 },
    { store_key: 'original', visit_date: '2026-11-04', payment_amount_cents: 20000, transactions: 8 }
  ]);
  assert.equal(combined.find(visit => visit.date === '2026-11-02' && visit.propertyName === 'AMLI 8800').netSalesCents, 10000);
  assert.equal(combined.find(visit => visit.date === '2026-11-04' && visit.propertyName === 'Remi on the River').netSalesCents, 20000);
  assert.equal(summarizeVisitsByProperty(combined).find(row => row.propertyName === 'AMLI 8800').visits, 12);
});

test('uses the Clover store assigned to each property visit', () => {
  const visits = [
    { date: '2026-07-14', propertyName: 'Grove Station', storeKey: 'shell' },
    { date: '2026-07-14', propertyName: 'Otra propiedad', storeKey: 'original' }
  ];
  const combined = combineVisitSales(visits, [
    { store_key: 'shell', visit_date: '2026-07-14', payment_amount_cents: 25000, transactions: 8 },
    { store_key: 'original', visit_date: '2026-07-14', payment_amount_cents: 10000, transactions: 3 }
  ]);
  assert.equal(combined[0].netSalesCents, 25000);
  assert.equal(combined[0].transactions, 8);
  assert.equal(combined[1].netSalesCents, 10000);
  assert.equal(combined[1].transactions, 3);
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

test('prioritizes Remi on the River when a Wednesday has another same-truck visit', () => {
  const visits = [
    { id: '2026-09-23:Solena Miramar', date: '2026-09-23', propertyName: 'Solena Miramar', storeKey: 'original' },
    { id: '2026-09-23:Remi on the River', date: '2026-09-23', propertyName: 'Remi on the River', storeKey: 'original' }
  ];
  const combined = combineVisitSales(visits, [{
    visit_date: '2026-09-23', payment_amount_cents: 10000, payment_tax_cents: 650, transactions: 4
  }]);
  assert.equal(combined[0].transactions, 0);
  assert.equal(combined[0].netSalesCents, 0);
  assert.equal(combined[1].transactions, 4);
  assert.equal(combined[1].netSalesCents, 9350);
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

test('separates the tax-exempt UM payment from AMLI without changing daily totals', () => {
  const visits = listPropertyVisits(2026).filter(visit => visit.date === '2026-10-15');
  const rows = combineVisitSales(visits, [{
    store_key: 'original', visit_date: '2026-10-15',
    payment_amount_cents: 279174, payment_tax_cents: 6372,
    payment_tip_cents: 7326, transactions: 34
  }], [{
    store_key: 'original', visit_date: '2026-10-15',
    refund_amount_cents: 1775, refunds: 1
  }]);
  const um = rows.find(row => row.propertyName === 'Universidad de Miami');
  const amli = rows.find(row => row.propertyName === 'AMLI 8800');
  assert.equal(um.netSalesCents, 180000);
  assert.equal(um.taxCents, 0);
  assert.equal(um.transactions, 1);
  assert.equal(amli.netSalesCents, 91027);
  assert.equal(amli.netCents, 104725);
  assert.equal(amli.taxCents, 6372);
  assert.equal(amli.tipsCents, 7326);
  assert.equal(amli.transactions, 33);
  assert.equal(rows.reduce((sum, row) => sum + row.netCents, 0), 284725);
  assert.equal(rows.reduce((sum, row) => sum + row.netSalesCents, 0), 271027);
  assert.deepEqual(combineVisitSales(visits).map(row => row.netCents), [0, 0]);
});
