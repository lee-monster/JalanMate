// Auth utilities — validates Supabase access tokens issued by the front-end's
// supabase.auth.signInWithIdToken() flow.
const { getSupaPublic } = require('./supabase');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getUserFromRequest(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  try {
    const supa = getSupaPublic();
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data || !data.user) return null;
    const u = data.user;
    return {
      id: u.id,                                          // auth.users.id (uuid)
      email: u.email || '',
      googleId: (u.user_metadata && u.user_metadata.google_id) || null,
      name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name))
            || (u.email || '').split('@')[0],
      avatar: (u.user_metadata && (u.user_metadata.avatar_url || u.user_metadata.picture)) || '',
    };
  } catch (e) {
    console.error('getUserFromRequest error:', e.message);
    return null;
  }
}

module.exports = { setCors, getUserFromRequest };
