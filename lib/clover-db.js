import { decryptToken, encryptToken, getSql } from './db.js';

let cloverSchemaPromise;

function legacyCloverMerchants() {
  return [
    {
      storeKey: 'shell',
      storeName: 'Shell',
      merchantId: String(process.env.CLOVER_SHELL_MERCHANT_ID || '').trim(),
      accessToken: String(process.env.CLOVER_SHELL_ACCESS_TOKEN || '').trim()
    },
    {
      storeKey: 'original',
      storeName: 'Food Truck Original',
      merchantId: String(process.env.CLOVER_ORIGINAL_MERCHANT_ID || '').trim(),
      accessToken: String(process.env.CLOVER_ORIGINAL_ACCESS_TOKEN || '').trim()
    }
  ];
}

async function importLegacyCloverMerchants(sql) {
  for (const merchant of legacyCloverMerchants()) {
    if (!/^[A-Za-z0-9]{8,32}$/.test(merchant.merchantId) || merchant.accessToken.length < 10) continue;
    const encrypted = encryptToken(merchant.accessToken);
    await sql`
      INSERT INTO clover_merchants (
        store_key, store_name, merchant_id, merchant_name, access_token_encrypted,
        currency, timezone, status, updated_at
      ) VALUES (
        ${merchant.storeKey}, ${merchant.storeName}, ${merchant.merchantId}, ${merchant.storeName},
        ${encrypted}, 'USD', 'America/New_York', 'active', NOW()
      ) ON CONFLICT (store_key) DO NOTHING
    `;
  }
}

export async function ensureCloverSchema() {
  if (!cloverSchemaPromise) {
    const sql = getSql();
    cloverSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS clover_merchants (
          store_key TEXT PRIMARY KEY,
          store_name TEXT NOT NULL,
          merchant_id TEXT NOT NULL,
          merchant_name TEXT NOT NULL,
          access_token_encrypted TEXT NOT NULL,
          currency TEXT NOT NULL DEFAULT 'USD',
          timezone TEXT NOT NULL DEFAULT 'America/New_York',
          status TEXT NOT NULL DEFAULT 'active',
          last_synced_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS clover_payments (
          merchant_id TEXT NOT NULL,
          payment_id TEXT NOT NULL,
          store_key TEXT NOT NULL REFERENCES clover_merchants(store_key) ON DELETE CASCADE,
          order_id TEXT,
          tender_id TEXT,
          amount_cents BIGINT NOT NULL DEFAULT 0,
          tip_cents BIGINT NOT NULL DEFAULT 0,
          tax_cents BIGINT NOT NULL DEFAULT 0,
          surcharge_cents BIGINT NOT NULL DEFAULT 0,
          convenience_fee_cents BIGINT NOT NULL DEFAULT 0,
          other_charge_cents BIGINT NOT NULL DEFAULT 0,
          created_time BIGINT NOT NULL,
          modified_time BIGINT,
          result TEXT,
          offline BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (merchant_id, payment_id)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS clover_refunds (
          merchant_id TEXT NOT NULL,
          refund_id TEXT NOT NULL,
          store_key TEXT NOT NULL REFERENCES clover_merchants(store_key) ON DELETE CASCADE,
          payment_id TEXT,
          order_id TEXT,
          amount_cents BIGINT NOT NULL DEFAULT 0,
          tip_cents BIGINT NOT NULL DEFAULT 0,
          tax_cents BIGINT NOT NULL DEFAULT 0,
          surcharge_cents BIGINT NOT NULL DEFAULT 0,
          convenience_fee_cents BIGINT NOT NULL DEFAULT 0,
          other_charge_cents BIGINT NOT NULL DEFAULT 0,
          created_time BIGINT NOT NULL,
          result TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (merchant_id, refund_id)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS clover_payments_store_time_idx ON clover_payments(store_key, created_time DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS clover_refunds_store_time_idx ON clover_refunds(store_key, created_time DESC)`;
      // The first finance-hub deployment stored Clover credentials as four
      // Vercel environment variables. Import them once into the encrypted
      // database table so upgrades preserve both existing store connections.
      await importLegacyCloverMerchants(sql);
    })().catch(error => {
      cloverSchemaPromise = undefined;
      throw error;
    });
  }
  return cloverSchemaPromise;
}

export async function saveCloverMerchant({ storeKey, storeName, merchantId, merchantName, accessToken, currency, timezone }) {
  await ensureCloverSchema();
  const sql = getSql();
  const current = await sql`SELECT merchant_id FROM clover_merchants WHERE store_key = ${storeKey}`;
  if (current[0]?.merchant_id && current[0].merchant_id !== merchantId) {
    await sql`DELETE FROM clover_payments WHERE store_key = ${storeKey}`;
    await sql`DELETE FROM clover_refunds WHERE store_key = ${storeKey}`;
  }
  const encrypted = encryptToken(accessToken);
  await sql`
    INSERT INTO clover_merchants (
      store_key, store_name, merchant_id, merchant_name, access_token_encrypted, currency, timezone, status, updated_at
    ) VALUES (
      ${storeKey}, ${storeName}, ${merchantId}, ${merchantName}, ${encrypted}, ${currency || 'USD'},
      ${timezone || 'America/New_York'}, 'active', NOW()
    ) ON CONFLICT (store_key) DO UPDATE SET
      store_name = EXCLUDED.store_name,
      merchant_id = EXCLUDED.merchant_id,
      merchant_name = EXCLUDED.merchant_name,
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      currency = EXCLUDED.currency,
      timezone = EXCLUDED.timezone,
      status = 'active',
      updated_at = NOW()
  `;
}

export async function listCloverMerchants({ includeTokens = false } = {}) {
  await ensureCloverSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT store_key, store_name, merchant_id, merchant_name, currency, timezone, status,
           last_synced_at, updated_at, access_token_encrypted
    FROM clover_merchants
    WHERE status = 'active'
    ORDER BY CASE store_key WHEN 'shell' THEN 1 WHEN 'original' THEN 2 ELSE 3 END
  `;
  return rows.map(row => {
    const merchant = { ...row };
    if (includeTokens) merchant.access_token = decryptToken(merchant.access_token_encrypted);
    delete merchant.access_token_encrypted;
    return merchant;
  });
}

export async function upsertCloverPayments(payments) {
  await ensureCloverSchema();
  const sql = getSql();
  for (let index = 0; index < payments.length; index += 40) {
    const batch = payments.slice(index, index + 40);
    await Promise.all(batch.map(payment => sql`
      INSERT INTO clover_payments (
        merchant_id, payment_id, store_key, order_id, tender_id, amount_cents, tip_cents, tax_cents,
        surcharge_cents, convenience_fee_cents, other_charge_cents, created_time, modified_time, result, offline, updated_at
      ) VALUES (
        ${payment.merchantId}, ${payment.paymentId}, ${payment.storeKey}, ${payment.orderId}, ${payment.tenderId},
        ${payment.amountCents}, ${payment.tipCents}, ${payment.taxCents}, ${payment.surchargeCents},
        ${payment.convenienceFeeCents}, ${payment.otherChargeCents}, ${payment.createdTime}, ${payment.modifiedTime},
        ${payment.result}, ${payment.offline}, NOW()
      ) ON CONFLICT (merchant_id, payment_id) DO UPDATE SET
        store_key = EXCLUDED.store_key,
        order_id = EXCLUDED.order_id,
        tender_id = EXCLUDED.tender_id,
        amount_cents = EXCLUDED.amount_cents,
        tip_cents = EXCLUDED.tip_cents,
        tax_cents = EXCLUDED.tax_cents,
        surcharge_cents = EXCLUDED.surcharge_cents,
        convenience_fee_cents = EXCLUDED.convenience_fee_cents,
        other_charge_cents = EXCLUDED.other_charge_cents,
        created_time = EXCLUDED.created_time,
        modified_time = EXCLUDED.modified_time,
        result = EXCLUDED.result,
        offline = EXCLUDED.offline,
        updated_at = NOW()
    `));
  }
}

export async function upsertCloverRefunds(refunds) {
  await ensureCloverSchema();
  const sql = getSql();
  for (let index = 0; index < refunds.length; index += 40) {
    const batch = refunds.slice(index, index + 40);
    await Promise.all(batch.map(refund => sql`
      INSERT INTO clover_refunds (
        merchant_id, refund_id, store_key, payment_id, order_id, amount_cents, tip_cents, tax_cents,
        surcharge_cents, convenience_fee_cents, other_charge_cents, created_time, result, updated_at
      ) VALUES (
        ${refund.merchantId}, ${refund.refundId}, ${refund.storeKey}, ${refund.paymentId}, ${refund.orderId},
        ${refund.amountCents}, ${refund.tipCents}, ${refund.taxCents}, ${refund.surchargeCents},
        ${refund.convenienceFeeCents}, ${refund.otherChargeCents}, ${refund.createdTime}, ${refund.result}, NOW()
      ) ON CONFLICT (merchant_id, refund_id) DO UPDATE SET
        store_key = EXCLUDED.store_key,
        payment_id = EXCLUDED.payment_id,
        order_id = EXCLUDED.order_id,
        amount_cents = EXCLUDED.amount_cents,
        tip_cents = EXCLUDED.tip_cents,
        tax_cents = EXCLUDED.tax_cents,
        surcharge_cents = EXCLUDED.surcharge_cents,
        convenience_fee_cents = EXCLUDED.convenience_fee_cents,
        other_charge_cents = EXCLUDED.other_charge_cents,
        created_time = EXCLUDED.created_time,
        result = EXCLUDED.result,
        updated_at = NOW()
    `));
  }
}

export async function markCloverSynced(storeKey) {
  const sql = getSql();
  await sql`UPDATE clover_merchants SET last_synced_at = NOW(), updated_at = NOW() WHERE store_key = ${storeKey}`;
}

export async function listCloverActivity(startMs, endMs, limit = 100) {
  await ensureCloverSchema();
  const sql = getSql();
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const payments = await sql`
    SELECT p.*, m.store_name
    FROM clover_payments p
    JOIN clover_merchants m ON m.store_key = p.store_key
    WHERE p.created_time >= ${startMs} AND p.created_time < ${endMs}
    ORDER BY p.created_time DESC
    LIMIT ${safeLimit}
  `;
  const refunds = await sql`
    SELECT r.*, m.store_name
    FROM clover_refunds r
    JOIN clover_merchants m ON m.store_key = r.store_key
    WHERE r.created_time >= ${startMs} AND r.created_time < ${endMs}
    ORDER BY r.created_time DESC
    LIMIT ${safeLimit}
  `;
  return { payments, refunds };
}

export async function aggregateCloverActivity(startMs, endMs) {
  await ensureCloverSchema();
  const sql = getSql();
  const payments = await sql`
    SELECT store_key, 'SUCCESS' AS result,
           COALESCE(SUM(amount_cents), 0) AS amount_cents,
           COALESCE(SUM(tip_cents), 0) AS tip_cents,
           COALESCE(SUM(tax_cents), 0) AS tax_cents,
           COALESCE(SUM(surcharge_cents), 0) AS surcharge_cents,
           COALESCE(SUM(convenience_fee_cents), 0) AS convenience_fee_cents,
           COALESCE(SUM(other_charge_cents), 0) AS other_charge_cents,
           COUNT(*) AS transaction_count
    FROM clover_payments
    WHERE created_time >= ${startMs} AND created_time < ${endMs}
      AND (result IS NULL OR result = 'SUCCESS')
    GROUP BY store_key
  `;
  const refunds = await sql`
    SELECT store_key, 'SUCCESS' AS result,
           COALESCE(SUM(amount_cents), 0) AS amount_cents,
           COALESCE(SUM(tip_cents), 0) AS tip_cents,
           COALESCE(SUM(tax_cents), 0) AS tax_cents,
           COALESCE(SUM(surcharge_cents), 0) AS surcharge_cents,
           COALESCE(SUM(convenience_fee_cents), 0) AS convenience_fee_cents,
           COALESCE(SUM(other_charge_cents), 0) AS other_charge_cents,
           COUNT(*) AS refund_count
    FROM clover_refunds
    WHERE created_time >= ${startMs} AND created_time < ${endMs}
      AND (result IS NULL OR result = 'SUCCESS')
    GROUP BY store_key
  `;
  return { payments, refunds };
}
