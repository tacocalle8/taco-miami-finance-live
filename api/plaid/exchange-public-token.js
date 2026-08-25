import { requireAuth } from '../../lib/auth.js';
import { plaidRequest, sendError } from '../../lib/config.js';
import { upsertItemAndAccounts } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  if (!requireAuth(req, res)) return;
  try {
    const publicToken = req.body?.publicToken || req.body?.public_token;
    if (!publicToken || !String(publicToken).startsWith('public-')) {
      const error = new Error('Plaid no devolvió un public_token válido.');
      error.statusCode = 400;
      error.code = 'INVALID_PUBLIC_TOKEN';
      throw error;
    }

    const exchanged = await plaidRequest('/item/public_token/exchange', { public_token: publicToken });
    const accountsResponse = await plaidRequest('/accounts/get', { access_token: exchanged.access_token });
    const institution = req.body?.institution || null;

    await upsertItemAndAccounts({
      itemId: exchanged.item_id,
      accessToken: exchanged.access_token,
      institution,
      accounts: accountsResponse.accounts || []
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      itemId: exchanged.item_id,
      savedAccounts: (accountsResponse.accounts || []).length,
      accounts: (accountsResponse.accounts || []).map(account => ({
        accountId: account.account_id,
        name: account.name,
        officialName: account.official_name,
        type: account.type,
        subtype: account.subtype,
        mask: account.mask,
        currentBalance: account.balances?.current ?? null,
        availableBalance: account.balances?.available ?? null,
        currency: account.balances?.iso_currency_code || 'USD'
      }))
    });
  } catch (error) {
    return sendError(res, error);
  }
}
