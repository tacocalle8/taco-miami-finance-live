const PLAID_HOSTS = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com'
};

export function getPlaidConfig() {
  const environment = (process.env.PLAID_ENV || 'production').toLowerCase();
  return {
    clientId: process.env.PLAID_CLIENT_ID || '',
    secret: process.env.PLAID_SECRET || process.env.PLAID_PRODUCTION_SECRET || '',
    environment,
    host: PLAID_HOSTS[environment] || PLAID_HOSTS.production,
    redirectUri: process.env.PLAID_REDIRECT_URI || ''
  };
}

export function getDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || '';
}

export function getOwnerPassword() {
  return process.env.OWNER_PASSWORD || process.env.OWNER_PIN || '';
}

export function getRequestOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

export function getRedirectUri(req) {
  const configured = getPlaidConfig().redirectUri;
  if (configured) return configured;
  const origin = getRequestOrigin(req);
  return origin ? `${origin}/` : '';
}

export async function plaidRequest(path, body) {
  const config = getPlaidConfig();
  if (!config.clientId || !config.secret) {
    const error = new Error('Faltan PLAID_CLIENT_ID o PLAID_SECRET en Vercel.');
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(`${config.host}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PLAID-CLIENT-ID': config.clientId,
      'PLAID-SECRET': config.secret
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_message || data.display_message || `Plaid respondió ${response.status}.`);
    error.statusCode = response.status >= 500 ? 502 : 400;
    error.code = data.error_code || 'PLAID_ERROR';
    error.type = data.error_type || '';
    error.requestId = data.request_id || '';
    throw error;
  }
  return data;
}

export function sendError(res, error) {
  const status = error.statusCode || 500;
  res.status(status).json({
    ok: false,
    error: error.message || 'Error inesperado.',
    code: error.code || 'INTERNAL_ERROR',
    requestId: error.requestId || undefined
  });
}
