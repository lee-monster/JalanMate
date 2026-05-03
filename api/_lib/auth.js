// JWT helpers + Google ID token verification for Travel-ID.
// We issue our own HS256 JWT after verifying a Google ID token. Bookmarks/plans
// live in the Notion Users DB; the JWT is the only session state.
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_TTL_SECONDS = 60 * 60 * 24 * 30;  // 30 days

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ─── Minimal HS256 JWT (no extra dependency) ───
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function signJwt(payload) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not configured');
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = Object.assign({ iat: now, exp: now + JWT_TTL_SECONDS }, payload);
  const head = b64url(Buffer.from(JSON.stringify(header)));
  const data = b64url(Buffer.from(JSON.stringify(body)));
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(head + '.' + data).digest());
  return head + '.' + data + '.' + sig;
}

function verifyJwt(token) {
  if (!JWT_SECRET || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, data, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', JWT_SECRET).update(head + '.' + data).digest());
  if (expected.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const payload = JSON.parse(b64urlDecode(data).toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function getBearerToken(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) return null;
  return auth.slice(7).trim();
}

function getUserFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  return verifyJwt(token);  // { sub: notionPageId, email, name, picture, ... }
}

// ─── Google ID token verification via Google's tokeninfo endpoint ───
// Sufficient for low-traffic apps. Switch to JWKS verification (cached certs)
// if you start hitting tokeninfo's rate limit.
async function verifyGoogleIdToken(idToken) {
  if (!idToken) return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const claims = await r.json();
    if (process.env.GOOGLE_CLIENT_ID && claims.aud !== process.env.GOOGLE_CLIENT_ID) return null;
    if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') return null;
    return {
      googleId: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified === 'true' || claims.email_verified === true,
      name: claims.name || '',
      picture: claims.picture || '',
      locale: (claims.locale || '').split('-')[0],
    };
  } catch (e) {
    return null;
  }
}

module.exports = { setCors, signJwt, verifyJwt, getUserFromRequest, verifyGoogleIdToken };
