const DEFAULT_CLOVER_HOST = 'https://api.clover.com';
const MAX_PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export function getCloverHost() {
  return String(process.env.CLOVER_API_HOST || DEFAULT_CLOVER_HOST).replace(/\/$/, '');
}

export async function cloverRequest(path, accessToken) {
  if (!accessToken) {
    const error = new Error('Falta el API token de Clover.');
    error.statusCode = 400;
    error.code = 'CLOVER_TOKEN_REQUIRED';
    throw error;
  }

  const response = await fetch(`${getCloverHost()}${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data.message || data.error?.message || data.error || `Clover respondió ${response.status}.`
    );
    error.statusCode = response.status === 401 || response.status === 403 ? 401 : response.status >= 500 ? 502 : 400;
    error.code = response.status === 401 || response.status === 403 ? 'CLOVER_AUTH_ERROR' : 'CLOVER_API_ERROR';
    throw error;
  }
  return data;
}

export function sumAdditionalCharges(record) {
  const totals = { surchargeCents: 0, convenienceFeeCents: 0, otherChargeCents: 0 };
  for (const charge of record?.additionalCharges?.elements || []) {
    const amount = Number(charge.amount) || 0;
    if (charge.type === 'CREDIT_SURCHARGE' || charge.type === 'INTERAC_V2') totals.surchargeCents += amount;
    else if (charge.type === 'CONVENIENCE_FEE') totals.convenienceFeeCents += amount;
    else totals.otherChargeCents += amount;
  }
  return totals;
}

export function isCashTender(record) {
  const type = record?.tenderType ?? record?.tender_type ?? '';
  const label = record?.tenderLabel ?? record?.tender_label ?? '';
  return `${type} ${label}`.toLowerCase().includes('cash');
}

function tenderValues(tender) {
  return {
    tenderType: tender?.type || tender?.labelKey || null,
    tenderLabel: tender?.label || tender?.name || null
  };
}

export function normalizePayment(payment, merchant) {
  const charges = sumAdditionalCharges(payment);
  const tender = tenderValues(payment.tender);
  return {
    merchantId: merchant.merchant_id,
    storeKey: merchant.store_key,
    paymentId: payment.id,
    orderId: payment.order?.id || null,
    tenderId: payment.tender?.id || null,
    tenderType: tender.tenderType,
    tenderLabel: tender.tenderLabel,
    amountCents: Number(payment.amount) || 0,
    tipCents: Number(payment.tipAmount) || 0,
    taxCents: Number(payment.taxAmount) || 0,
    surchargeCents: charges.surchargeCents,
    convenienceFeeCents: charges.convenienceFeeCents,
    otherChargeCents: charges.otherChargeCents,
    createdTime: Number(payment.createdTime) || Number(payment.clientCreatedTime) || Date.now(),
    modifiedTime: Number(payment.modifiedTime) || null,
    result: payment.result || 'UNKNOWN',
    offline: Boolean(payment.offline)
  };
}

export function normalizeRefund(refund, merchant) {
  const charges = sumAdditionalCharges(refund);
  const tender = tenderValues(refund.tender || refund.payment?.tender);
  return {
    merchantId: merchant.merchant_id,
    storeKey: merchant.store_key,
    refundId: refund.id,
    paymentId: refund.payment?.id || null,
    orderId: refund.orderRef?.id || refund.order?.id || null,
    tenderType: tender.tenderType,
    tenderLabel: tender.tenderLabel,
    amountCents: Number(refund.amount) || 0,
    tipCents: Number(refund.tipAmount) || 0,
    taxCents: Number(refund.taxAmount) || 0,
    surchargeCents: charges.surchargeCents,
    convenienceFeeCents: charges.convenienceFeeCents,
    otherChargeCents: charges.otherChargeCents,
    createdTime: Number(refund.createdTime) || Number(refund.clientCreatedTime) || Date.now(),
    result: refund.result || 'SUCCESS'
  };
}

export function dateFilterPath(merchantId, resource, startMs, endMs, offset) {
  const query = new URLSearchParams();
  // Clover documents a date range as two repeated filter parameters.
  query.append('filter', `createdTime>=${startMs}`);
  query.append('filter', `createdTime<=${endMs}`);
  query.set('expand', 'additionalCharges,tender');
  query.set('limit', String(MAX_PAGE_SIZE));
  query.set('offset', String(offset));
  return `/v3/merchants/${encodeURIComponent(merchantId)}/${resource}?${query}`;
}

async function fetchRange(merchant, resource, startMs, endMs) {
  const records = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * MAX_PAGE_SIZE;
    const data = await cloverRequest(
      dateFilterPath(merchant.merchant_id, resource, startMs, endMs, offset),
      merchant.access_token
    );
    const elements = Array.isArray(data.elements) ? data.elements : [];
    records.push(...elements);
    if (elements.length < MAX_PAGE_SIZE) break;
  }
  return records;
}

export async function fetchRecentCloverData(merchant, options = {}) {
  const endMs = Math.min(Number(options.endMs) || Date.now(), Date.now());
  const startMs = Number(options.startMs) || endMs - 89 * DAY_MS;
  const [payments, refunds] = await Promise.all([
    fetchRange(merchant, 'payments', startMs, endMs),
    fetchRange(merchant, 'refunds', startMs, endMs)
  ]);
  return {
    payments: payments.filter(item => item?.id).map(item => normalizePayment(item, merchant)),
    refunds: refunds.filter(item => item?.id).map(item => normalizeRefund(item, merchant)),
    startMs,
    endMs
  };
}

export function buildCloverSummary(merchants, payments, refunds) {
  const moneyBase = () => ({
    paymentsCents: 0,
    tipsCents: 0,
    taxCents: 0,
    feesCents: 0,
    refundAmountCents: 0,
    refundsCents: 0,
    refundedTaxCents: 0,
    netSalesCents: 0,
    netCents: 0,
    transactions: 0,
    refunds: 0
  });
  const base = () => ({ ...moneyBase(), cash: moneyBase() });
  const byStore = Object.fromEntries(merchants.map(merchant => [merchant.store_key, base()]));
  const total = base();

  const addValues = (target, values) => {
    for (const [key, value] of Object.entries(values)) target[key] += value;
  };

  const cashPaymentValues = payment => ({
    paymentsCents: Number(payment.cash_amount_cents ?? (isCashTender(payment) ? payment.amount_cents : 0)),
    tipsCents: Number(payment.cash_tip_cents ?? (isCashTender(payment) ? payment.tip_cents : 0)),
    taxCents: Number(payment.cash_tax_cents ?? (isCashTender(payment) ? payment.tax_cents : 0)),
    feesCents: Number(payment.cash_fees_cents ?? (isCashTender(payment)
      ? Number(payment.surcharge_cents) + Number(payment.convenience_fee_cents) + Number(payment.other_charge_cents)
      : 0)),
    transactions: Number(payment.cash_transaction_count ?? (isCashTender(payment) ? (Number(payment.transaction_count) || 1) : 0))
  });

  for (const payment of payments) {
    if (payment.result && payment.result !== 'SUCCESS') continue;
    const row = byStore[payment.store_key] || (byStore[payment.store_key] = base());
    const fees = Number(payment.surcharge_cents) + Number(payment.convenience_fee_cents) + Number(payment.other_charge_cents);
    const values = {
      paymentsCents: Number(payment.amount_cents),
      tipsCents: Number(payment.tip_cents),
      taxCents: Number(payment.tax_cents),
      feesCents: fees,
      transactions: Number(payment.transaction_count) || 1
    };
    for (const [key, value] of Object.entries(values)) {
      row[key] += value;
      total[key] += value;
    }
    const cashValues = cashPaymentValues(payment);
    addValues(row.cash, cashValues);
    addValues(total.cash, cashValues);
  }

  for (const refund of refunds) {
    if (refund.result && refund.result !== 'SUCCESS') continue;
    const row = byStore[refund.store_key] || (byStore[refund.store_key] = base());
    const fees = Number(refund.surcharge_cents) + Number(refund.convenience_fee_cents) + Number(refund.other_charge_cents);
    const refundAmount = Number(refund.amount_cents);
    const returned = refundAmount + Number(refund.tip_cents) + fees;
    row.refundAmountCents += refundAmount;
    row.refundsCents += returned;
    row.refundedTaxCents += Number(refund.tax_cents);
    const refundCount = Number(refund.refund_count) || 1;
    row.refunds += refundCount;
    total.refundAmountCents += refundAmount;
    total.refundsCents += returned;
    total.refundedTaxCents += Number(refund.tax_cents);
    total.refunds += refundCount;

    const cashAmount = Number(refund.cash_refund_amount_cents ?? (isCashTender(refund) ? refundAmount : 0));
    const cashTax = Number(refund.cash_refunded_tax_cents ?? (isCashTender(refund) ? refund.tax_cents : 0));
    const cashFees = Number(refund.cash_refunds_fees_cents ?? (isCashTender(refund) ? fees : 0));
    const cashReturned = Number(refund.cash_refunds_cents ?? (isCashTender(refund) ? returned : 0));
    const cashRefundCount = Number(refund.cash_refund_count ?? (isCashTender(refund) ? refundCount : 0));
    row.cash.refundAmountCents += cashAmount;
    row.cash.refundedTaxCents += cashTax;
    row.cash.refundsCents += cashReturned;
    row.cash.refunds += cashRefundCount;
    total.cash.refundAmountCents += cashAmount;
    total.cash.refundedTaxCents += cashTax;
    total.cash.refundsCents += cashReturned;
    total.cash.refunds += cashRefundCount;
  }

  for (const row of [...Object.values(byStore), total]) {
    const grossTaxCents = row.taxCents;
    const refundedSaleCents = Math.max(0, row.refundAmountCents - row.refundedTaxCents);
    row.netSalesCents = Math.max(0, row.paymentsCents - grossTaxCents - refundedSaleCents);
    row.taxCents = Math.max(0, row.taxCents - row.refundedTaxCents);
    row.netCents = row.paymentsCents + row.tipsCents + row.feesCents - row.refundsCents;
    const cash = row.cash;
    const cashRefundedSaleCents = Math.max(0, cash.refundAmountCents - cash.refundedTaxCents);
    cash.netSalesCents = Math.max(0, cash.paymentsCents - cash.taxCents - cashRefundedSaleCents);
    cash.taxCents = Math.max(0, cash.taxCents - cash.refundedTaxCents);
    cash.netCents = cash.paymentsCents + cash.tipsCents + cash.feesCents - cash.refundsCents;
  }
  return { byStore, total };
}
