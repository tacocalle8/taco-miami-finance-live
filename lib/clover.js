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

export function normalizePayment(payment, merchant) {
  const charges = sumAdditionalCharges(payment);
  return {
    merchantId: merchant.merchant_id,
    storeKey: merchant.store_key,
    paymentId: payment.id,
    orderId: payment.order?.id || null,
    tenderId: payment.tender?.id || null,
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
  return {
    merchantId: merchant.merchant_id,
    storeKey: merchant.store_key,
    refundId: refund.id,
    paymentId: refund.payment?.id || null,
    orderId: refund.orderRef?.id || refund.order?.id || null,
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
  query.set('expand', 'additionalCharges');
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
  const base = () => ({
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
  const byStore = Object.fromEntries(merchants.map(merchant => [merchant.store_key, base()]));
  const total = base();

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
  }

  for (const row of [...Object.values(byStore), total]) {
    const grossTaxCents = row.taxCents;
    const refundedSaleCents = Math.max(0, row.refundAmountCents - row.refundedTaxCents);
    row.netSalesCents = Math.max(0, row.paymentsCents - grossTaxCents - refundedSaleCents);
    row.taxCents = Math.max(0, row.taxCents - row.refundedTaxCents);
    row.netCents = row.paymentsCents + row.tipsCents + row.feesCents - row.refundsCents;
  }
  return { byStore, total };
}
