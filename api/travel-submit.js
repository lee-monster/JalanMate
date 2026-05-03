// POST /api/travel-submit — community spot submission.
// New rows are created with Published=false; an admin flips Published=true in
// Notion to make the spot visible.
// Body: { name, category, description, address, instagram, author, lat?, lng? }
const { notion, SPOTS_DB } = require('./_lib/notion');
const { setCors } = require('./_lib/auth');

const ALLOWED_CATEGORIES = new Set([
  'beach','temple','cultural','volcano','nature','diving','food','cafe',
  'shopping','nightlife','museum','adventure','wellness','mosque',
]);

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, category, description, address, instagram, author, lat, lng } = req.body || {};
  if (!name || !category || !description) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!ALLOWED_CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  // Notion's rich_text caps individual chunks at 2000 chars.
  const trimmedDesc = String(description).slice(0, 1900);
  const trimmedAddress = String(address || '').slice(0, 500);

  try {
    const props = {
      Name: { title: [{ text: { content: String(name).slice(0, 200) } }] },
      Category: { select: { name: category } },
      Description: { rich_text: [{ text: { content: trimmedDesc } }] },
      Published: { checkbox: false },
      Featured: { checkbox: false },
    };
    if (trimmedAddress) props.Address = { rich_text: [{ text: { content: trimmedAddress } }] };
    if (instagram) props.Instagram = { rich_text: [{ text: { content: String(instagram).slice(0, 100) } }] };
    if (author) props.SubmittedBy = { rich_text: [{ text: { content: String(author).slice(0, 100) } }] };
    if (typeof lat === 'number') props.Latitude = { number: lat };
    if (typeof lng === 'number') props.Longitude = { number: lng };

    await notion().pages.create({
      parent: { database_id: SPOTS_DB },
      properties: props,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('travel-submit error:', err);
    return res.status(500).json({ error: 'Failed to submit', detail: err.message });
  }
};
