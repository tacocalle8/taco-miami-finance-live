import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { getDatabaseUrl, getPlaidConfig } from './config.js';

let sqlClient;
let schemaPromise;

export function getSql() {
  const url = getDatabaseUrl();
  if (!url) {
    const error = new Error('Falta DATABASE_URL de Neon en Vercel.');
    error.statusCode = 503;
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }
  if (!sqlClient) sqlClient = neon(url);
  return sqlClient;
}

export async function ensureSchema() {
  if (!schemaPromise) {
    const sql = getSql();
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS plaid_items (
          item_id TEXT PRIMARY KEY,
          access_token_encrypted TEXT NOT NULL,
          institution_id TEXT,
          institution_name TEXT,
          cursor TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS plaid_accounts (
          account_id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
          persistent_account_id TEXT,
          name TEXT NOT NULL,
          official_name TEXT,
          type TEXT,
          subtype TEXT,
          mask TEXT,
          current_balance NUMERIC,
          available_balance NUMERIC,
          iso_currency_code TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS plaid_transactions (
          transaction_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          date DATE NOT NULL,
          name TEXT NOT NULL,
          merchant_name TEXT,
          amount NUMERIC NOT NULL,
          iso_currency_code TEXT,
          pending BOOLEAN NOT NULL DEFAULT FALSE,
          category JSONB,
          personal_finance_category JSONB,
          removed BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS plaid_transactions_date_idx ON plaid_transactions(date DESC)`;
    })().catch(error => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

function encryptionKey() {
  const source = process.env.TOKEN_ENCRYPTION_KEY || getPlaidConfig().secret;
  if (!source) {
    const error = new Error('Falta TOKEN_ENCRYPTION_KEY o PLAID_SECRET para cifrar tokens privados.');
    error.statusCode = 503;
    throw error;
  }
  return crypto.createHash('sha256').update(source).digest();
}

export function encryptToken(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(part => part.toString('base64url')).join('.');
}

export function decryptToken(value) {
  const [ivText, tagText, encryptedText] = String(value).split('.');
  if (!ivText || !tagText || !encryptedText) throw new Error('El token privado guardado no es válido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

export async function upsertItemAndAccounts({ itemId, accessToken, institution, accounts }) {
  await ensureSchema();
  const sql = getSql();
  const encrypted = encryptToken(accessToken);
  await sql`
    INSERT INTO plaid_items (item_id, access_token_encrypted, institution_id, institution_name, status, updated_at)
    VALUES (${itemId}, ${encrypted}, ${institution?.institution_id || null}, ${institution?.name || 'Banco conectado'}, 'active', NOW())
    ON CONFLICT (item_id) DO UPDATE SET
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      institution_id = EXCLUDED.institution_id,
      institution_name = EXCLUDED.institution_name,
      status = 'active',
      updated_at = NOW()
  `;

  for (const account of accounts) {
    await sql`
      INSERT INTO plaid_accounts (
        account_id, item_id, persistent_account_id, name, official_name, type, subtype, mask,
        current_balance, available_balance, iso_currency_code, updated_at
      ) VALUES (
        ${account.account_id}, ${itemId}, ${account.persistent_account_id || null}, ${account.name || 'Cuenta'},
        ${account.official_name || null}, ${account.type || null}, ${account.subtype || null}, ${account.mask || null},
        ${account.balances?.current ?? null}, ${account.balances?.available ?? null},
        ${account.balances?.iso_currency_code || account.balances?.unofficial_currency_code || 'USD'}, NOW()
      ) ON CONFLICT (account_id) DO UPDATE SET
        item_id = EXCLUDED.item_id,
        persistent_account_id = EXCLUDED.persistent_account_id,
        name = EXCLUDED.name,
        official_name = EXCLUDED.official_name,
        type = EXCLUDED.type,
        subtype = EXCLUDED.subtype,
        mask = EXCLUDED.mask,
        current_balance = EXCLUDED.current_balance,
        available_balance = EXCLUDED.available_balance,
        iso_currency_code = EXCLUDED.iso_currency_code,
        updated_at = NOW()
    `;
  }
}

export async function listAccounts() {
  await ensureSchema();
  const sql = getSql();
  return sql`
    SELECT a.account_id, a.name, a.official_name, a.type, a.subtype, a.mask,
           a.current_balance, a.available_balance, a.iso_currency_code,
           i.item_id, i.institution_name, i.status, a.updated_at
    FROM plaid_accounts a
    JOIN plaid_items i ON i.item_id = a.item_id
    WHERE i.status = 'active'
    ORDER BY i.institution_name, a.name
  `;
}

export async function listItems() {
  await ensureSchema();
  const sql = getSql();
  return sql`SELECT item_id, access_token_encrypted, cursor FROM plaid_items WHERE status = 'active' ORDER BY created_at`;
}

export async function saveCursor(itemId, cursor) {
  const sql = getSql();
  await sql`UPDATE plaid_items SET cursor = ${cursor}, updated_at = NOW() WHERE item_id = ${itemId}`;
}

export async function upsertTransactions(itemId, transactions, removedIds = []) {
  const sql = getSql();
  for (const transaction of transactions) {
    await sql`
      INSERT INTO plaid_transactions (
        transaction_id, account_id, item_id, date, name, merchant_name, amount,
        iso_currency_code, pending, category, personal_finance_category, removed, updated_at
      ) VALUES (
        ${transaction.transaction_id}, ${transaction.account_id}, ${itemId}, ${transaction.date},
        ${transaction.name || 'Movimiento'}, ${transaction.merchant_name || null}, ${transaction.amount || 0},
        ${transaction.iso_currency_code || transaction.unofficial_currency_code || 'USD'},
        ${Boolean(transaction.pending)}, ${JSON.stringify(transaction.category || [])},
        ${JSON.stringify(transaction.personal_finance_category || null)}, FALSE, NOW()
      ) ON CONFLICT (transaction_id) DO UPDATE SET
        account_id = EXCLUDED.account_id,
        date = EXCLUDED.date,
        name = EXCLUDED.name,
        merchant_name = EXCLUDED.merchant_name,
        amount = EXCLUDED.amount,
        iso_currency_code = EXCLUDED.iso_currency_code,
        pending = EXCLUDED.pending,
        category = EXCLUDED.category,
        personal_finance_category = EXCLUDED.personal_finance_category,
        removed = FALSE,
        updated_at = NOW()
    `;
  }
  for (const transactionId of removedIds) {
    await sql`UPDATE plaid_transactions SET removed = TRUE, updated_at = NOW() WHERE transaction_id = ${transactionId}`;
  }
}

export async function listTransactions(limit = 200) {
  await ensureSchema();
  const sql = getSql();
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  return sql`
    SELECT t.transaction_id, t.date, t.name, t.merchant_name, t.amount, t.iso_currency_code,
           t.pending, t.category, t.personal_finance_category, a.name AS account_name,
           i.institution_name
    FROM plaid_transactions t
    JOIN plaid_accounts a ON a.account_id = t.account_id
    JOIN plaid_items i ON i.item_id = t.item_id
    WHERE t.removed = FALSE
    ORDER BY t.date DESC, t.updated_at DESC
    LIMIT ${safeLimit}
  `;
}
