import { requireAuth } from '../../lib/auth.js';
import { getRedirectUri, plaidRequest, sendError } from '../../lib/config.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  if (!requireAuth(req, res)) return;
  try {
    const redirectUri = getRedirectUri(req);
    if (!redirectUri) {
      const error = new Error('No se pudo determinar PLAID_REDIRECT_URI.');
      error.statusCode = 503;
      throw error;
    }
    const data = await plaidRequest('/link/token/create', {
      user: { client_user_id: 'taco-miami-owner-finance' },
      client_name: 'Taco Miami Finance',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'es',
      redirect_uri: redirectUri,
      transactions: { days_requested: 730 }
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, linkToken: data.link_token, expiration: data.expiration, redirectUri });
  } catch (error) {
    return sendError(res, error);
  }
}
