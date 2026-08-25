import { authConfigured, isAuthenticated } from '../lib/auth.js';
import { getDatabaseUrl, getPlaidConfig, getRedirectUri } from '../lib/config.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  const plaid = getPlaidConfig();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    authConfigured: authConfigured(),
    authenticated: isAuthenticated(req),
    plaidConfigured: Boolean(plaid.clientId && plaid.secret),
    databaseConfigured: Boolean(getDatabaseUrl()),
    environment: plaid.environment,
    redirectUri: getRedirectUri(req)
  });
}
