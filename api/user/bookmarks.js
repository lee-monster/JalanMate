// /api/user/bookmarks — Supabase-backed bookmark CRUD.
// Auth: Bearer <Supabase access_token>. We use the admin client for
// consistency in response shape; RLS would also work for SELECT/INSERT/DELETE.
const { getUserFromRequest, setCors } = require('../_lib/auth');
const { getSupaAdmin } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') return list(user, res);
    if (req.method === 'POST') return mutate(user, req.body, res);
    if (req.method === 'DELETE') return del(user, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Bookmarks error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

async function list(user, res) {
  const supa = getSupaAdmin();
  const { data, error } = await supa
    .from('bookmarks')
    .select('spot_id, type')
    .eq('user_id', user.id);
  if (error) {
    console.error('bookmarks select:', error);
    return res.status(500).json({ error: 'Failed to read bookmarks' });
  }
  const bookmarks = (data || []).map((b) => ({ spotId: b.spot_id, type: b.type }));
  return res.status(200).json({ bookmarks });
}

async function mutate(user, body, res) {
  const { spotId, type, action } = body || {};
  if (!spotId || !type || !action) return res.status(400).json({ error: 'Missing spotId, type, or action' });
  if (['want_to_visit', 'interested'].indexOf(type) === -1) return res.status(400).json({ error: 'Invalid bookmark type' });
  if (['add', 'remove'].indexOf(action) === -1) return res.status(400).json({ error: 'Invalid action' });

  const supa = getSupaAdmin();

  if (action === 'add') {
    const { error } = await supa
      .from('bookmarks')
      .upsert({ user_id: user.id, spot_id: spotId, type }, { onConflict: 'user_id,spot_id,type' });
    if (error) {
      console.error('bookmark add:', error);
      return res.status(500).json({ error: 'Failed to add bookmark' });
    }
  } else {
    const { error } = await supa
      .from('bookmarks')
      .delete()
      .eq('user_id', user.id).eq('spot_id', spotId).eq('type', type);
    if (error) {
      console.error('bookmark remove:', error);
      return res.status(500).json({ error: 'Failed to remove bookmark' });
    }
  }

  // Return the fresh list so the frontend can re-render in one round-trip
  const { data } = await supa
    .from('bookmarks')
    .select('spot_id, type')
    .eq('user_id', user.id);
  const bookmarks = (data || []).map((b) => ({ spotId: b.spot_id, type: b.type }));
  return res.status(200).json({ success: true, bookmarks });
}

async function del(user, res) {
  // Removing the auth user cascades to profiles/bookmarks via FK.
  const supa = getSupaAdmin();
  const { error } = await supa.auth.admin.deleteUser(user.id);
  if (error) {
    console.error('deleteAccount:', error);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
  return res.status(200).json({ success: true, message: 'Account deleted' });
}
