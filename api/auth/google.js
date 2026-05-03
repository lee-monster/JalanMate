// POST /api/auth/google — exchange a Google ID token for a Travel-ID JWT.
// Body: { credential }  (the JWT credential from google.accounts.id callback)
// Returns: { token, user: { email, name, picture, locale } }
const { setCors, signJwt, verifyGoogleIdToken } = require('../_lib/auth');
const { findUserByGoogleId, findUserByEmail, createUser, touchUserLogin } = require('../_lib/notion');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Missing credential' });

  const claims = await verifyGoogleIdToken(credential);
  if (!claims) return res.status(401).json({ error: 'Invalid Google credential' });
  if (!claims.emailVerified) return res.status(403).json({ error: 'Email not verified by Google' });

  try {
    let user = await findUserByGoogleId(claims.googleId);
    if (!user) user = await findUserByEmail(claims.email);
    if (!user) {
      user = await createUser({
        email: claims.email,
        googleId: claims.googleId,
        name: claims.name,
        picture: claims.picture,
        locale: ['en','id','ko','zh','ja'].indexOf(claims.locale) !== -1 ? claims.locale : null,
      });
    } else {
      // Refresh LastLogin lazily
      touchUserLogin(user.id);
    }

    const token = signJwt({
      sub: user.id,
      email: user.email,
      name: user.name || claims.name,
      picture: user.picture || claims.picture,
    });

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || claims.name,
        picture: user.picture || claims.picture,
        locale: user.locale || null,
        bookmarks: user.bookmarks || { want_to_visit: [], interested: [] },
      },
    });
  } catch (err) {
    console.error('auth/google error:', err);
    return res.status(500).json({ error: 'Auth failed', detail: err.message });
  }
};
