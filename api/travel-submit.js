// POST /api/travel-submit — community spot submission.
// Inserted into spot_submissions with status='pending'. Admin reviews via
// Supabase Dashboard and (optionally) creates a corresponding spots row.
// Body: { name, category, description, address, instagram, author, lat?, lng?, country? }
const { getSupaAdmin } = require('./_lib/supabase');
const { setCors } = require('./_lib/auth');

const ALLOWED_CATEGORIES = new Set([
  'beach','temple','cultural','volcano','nature','diving','food','cafe',
  'shopping','nightlife','museum','adventure','wellness','mosque',
]);

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, category, description, address, instagram, author, lat, lng, country, lang, photos } = req.body || {};
  if (!name || !category || !description) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!ALLOWED_CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  try {
    const payload = {
      name: String(name).slice(0, 200),
      description: String(description).slice(0, 3000),
      category,
      address: address ? String(address).slice(0, 500) : null,
      lat: typeof lat === 'number' ? lat : (lat ? parseFloat(lat) : null),
      lng: typeof lng === 'number' ? lng : (lng ? parseFloat(lng) : null),
      instagram: instagram ? String(instagram).slice(0, 100) : null,
      country: country === 'MY' ? 'MY' : 'ID',
      lang: lang || 'en',
      photos: Array.isArray(photos) ? photos : [],
      author: author ? String(author).slice(0, 100) : null,
    };

    const { error } = await getSupaAdmin().from('spot_submissions').insert({
      submitter_email: payload.author,
      payload,
      status: 'pending',
    });
    if (error) {
      console.error('travel-submit error:', error);
      return res.status(500).json({ error: 'Failed to submit spot' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('travel-submit fatal:', err);
    return res.status(500).json({ error: 'Failed to submit spot', detail: err.message });
  }
};
