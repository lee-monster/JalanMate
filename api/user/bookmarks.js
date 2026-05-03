// GET    /api/user/bookmarks — list bookmarks for the authenticated user.
// POST   /api/user/bookmarks — body: { spotId, type, action }
//   type: 'want_to_visit' | 'interested'
//   action: 'add' | 'remove'
// DELETE /api/user/bookmarks — delete the user's account (Notion page archive).
const { notion, userFromPage, updateUserBookmarks } = require('../_lib/notion');
const { getUserFromRequest, setCors } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = getUserFromRequest(req);
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

async function loadUserPage(userId) {
  const page = await notion().pages.retrieve({ page_id: userId });
  return userFromPage(page);
}

function flatten(bookmarks) {
  const out = [];
  (bookmarks.want_to_visit || []).forEach((id) => out.push({ spotId: id, type: 'want_to_visit' }));
  (bookmarks.interested || []).forEach((id) => out.push({ spotId: id, type: 'interested' }));
  return out;
}

async function list(user, res) {
  const u = await loadUserPage(user.sub);
  return res.status(200).json({ bookmarks: flatten(u.bookmarks) });
}

async function mutate(user, body, res) {
  const { spotId, type, action } = body || {};
  if (!spotId || !type || !action) return res.status(400).json({ error: 'Missing spotId, type, or action' });
  if (['want_to_visit', 'interested'].indexOf(type) === -1) return res.status(400).json({ error: 'Invalid type' });
  if (['add', 'remove'].indexOf(action) === -1) return res.status(400).json({ error: 'Invalid action' });

  const u = await loadUserPage(user.sub);
  const bm = {
    want_to_visit: u.bookmarks.want_to_visit || [],
    interested:    u.bookmarks.interested    || [],
  };
  const set = new Set(bm[type]);
  if (action === 'add') set.add(spotId);
  else set.delete(spotId);
  bm[type] = Array.from(set);
  await updateUserBookmarks(user.sub, bm);
  return res.status(200).json({ success: true, bookmarks: flatten(bm) });
}

async function del(user, res) {
  // Notion has no hard-delete via API; archive instead. Frontend should also
  // wipe its local JWT to fully sign out.
  await notion().pages.update({ page_id: user.sub, archived: true });
  return res.status(200).json({ success: true, message: 'Account archived' });
}
