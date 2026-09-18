import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCloverSummary,
  dateFilterPath,
  normalizePayment,
  normalizeRefund,
  sumAdditionalCharges
} from '../lib/clover.js';

const merchant = { merchant_id: 'MERCHANT12345', store_key: 'shell' };

test('sends Clover date ranges as two filter parameters', () => {
  const path = dateFilterPath('MERCHANT12345', 'payments', 1000, 2000, 0);
  const query = new URL(`https://api.clover.com${path}`).searchParams;
  assert.deepEqual(query.getAll('filter'), ['createdTime>=1000', 'createdTime<=2000']);
});

test('separates Clover additional charge types', () => {
  assert.deepEqual(sumAdditionalCharges({ additionalCharges: { elements: [
    { type: 'CREDIT_SURCHARGE', amount: 105 },
    { type: 'CONVENIENCE_FEE', amount: 300 },
    { type: 'OTHER', amount: 25 }
  ] } }), { surchargeCents: 105, convenienceFeeCents: 300, otherChargeCents: 25 });
});

test('normalizes payments and refunds in cents', () => {
  const payment = normalizePayment({
    id: 'PAY1', amount: 2500, tipAmount: 500, taxAmount: 175, createdTime: 1000,
    result: 'SUCCESS', tender: { id: 'CASH', type: 'CASH', label: 'Cash' },
    additionalCharges: { elements: [{ type: 'CREDIT_SURCHARGE', amount: 105 }] }
  }, merchant);
  const refund = normalizeRefund({
    id: 'REF1', amount: 500, taxAmount: 35, createdTime: 2000,
    additionalCharges: { elements: [{ type: 'CREDIT_SURCHARGE', amount: 18 }] }
  }, merchant);
  assert.equal(payment.surchargeCents, 105);
  assert.equal(payment.tipCents, 500);
  assert.equal(payment.tenderLabel, 'Cash');
  assert.equal(refund.taxCents, 35);
  assert.equal(refund.paymentId, null);
});

test('builds per-store and combined monthly totals', () => {
  const payments = [{
    store_key: 'shell', result: 'SUCCESS', amount_cents: 2500, tip_cents: 500, tax_cents: 175,
    surcharge_cents: 105, convenience_fee_cents: 0, other_charge_cents: 0
  }];
  const refunds = [{
    store_key: 'shell', result: 'SUCCESS', amount_cents: 500, tip_cents: 0, tax_cents: 35,
    surcharge_cents: 18, convenience_fee_cents: 0, other_charge_cents: 0
  }];
  const summary = buildCloverSummary([merchant], payments, refunds);
  assert.equal(summary.total.taxCents, 140);
  assert.equal(summary.total.refundsCents, 518);
  assert.equal(summary.total.netSalesCents, 1860);
  assert.equal(summary.total.netCents, 2587);
  assert.equal(summary.byStore.shell.transactions, 1);
});

test('tracks cash Clover income separately without changing the general total', () => {
  const payments = [{
    store_key: 'shell', result: 'SUCCESS', amount_cents: 1100, tip_cents: 100, tax_cents: 100,
    surcharge_cents: 0, convenience_fee_cents: 0, other_charge_cents: 0,
    cash_amount_cents: 1100, cash_tip_cents: 100, cash_tax_cents: 100, cash_fees_cents: 0,
    cash_transaction_count: 1, transaction_count: 1
  }];
  const refunds = [{
    store_key: 'shell', result: 'SUCCESS', amount_cents: 100, tip_cents: 0, tax_cents: 10,
    surcharge_cents: 0, convenience_fee_cents: 0, other_charge_cents: 0,
    cash_refund_amount_cents: 100, cash_refunded_tax_cents: 10, cash_refunds_cents: 100,
    cash_refund_count: 1, refund_count: 1
  }];
  const summary = buildCloverSummary([merchant], payments, refunds);
  assert.equal(summary.total.cash.netSalesCents, 910);
  assert.equal(summary.total.cash.netCents, 1100);
  assert.equal(summary.total.cash.transactions, 1);
  assert.equal(summary.total.netSalesCents, 910);
});
