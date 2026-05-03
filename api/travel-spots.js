// GET /api/travel-spots — public spot list backed by Supabase.
// Query params:
//   lang     - en | id | ms | ko | zh | ja | ar  (display language; falls back to en)
//   category - single category name OR comma-separated list
//   exclude  - comma-separated category names to exclude
//   region   - region name (Bali, Yogyakarta, Kuala Lumpur, …)
//   country  - 'ID' or 'MY'
//   halal    - "1" to filter halal-friendly spots
//   limit    - max rows (default 100)
//   cursor   - offset for pagination
//
// GET /api/travel-spots?render=page&id=...&lang=...
//   Returns a server-rendered HTML page for share / OG previews.
const { getSupaPublic, getSiteUrl } = require('./_lib/supabase');

const LANGS = ['en', 'id', 'ms', 'ko', 'zh', 'ja', 'ar'];

function pickTranslation(translations, lang) {
  const map = {};
  for (const t of translations || []) map[t.lang] = t;
  return {
    requested: map[lang] || null,
    en: map.en || null,
  };
}

function formatSpot(row, lang) {
  const tr = pickTranslation(row.spot_translations, lang);
  const name = (tr.requested && tr.requested.name) || (tr.en && tr.en.name) || row.name;
  const description = (tr.requested && tr.requested.description)
    || (tr.en && tr.en.description) || '';

  return {
    id: row.id,
    name,
    description,
    category: row.category || '',
    region: row.region || '',
    country: row.country || 'ID',
    lat: row.latitude,
    lng: row.longitude,
    address: row.address || '',
    coverImage: row.cover_image || '',
    photos: row.photos || [],
    tags: row.tags || [],
    instagram: row.instagram || '',
    website: row.website || '',
    googleMapLink: row.google_map_link || '',
    rating: row.rating || 0,
    featured: !!row.featured,
    halal: !!row.halal,
    prayerRoom: !!row.prayer_room,
    vegFriendly: !!row.veg_friendly,
    entryFee: row.entry_fee,
    bestTimeToVisit: row.best_time_to_visit || '',
    localTips: row.local_tips || '',
    openingHours: row.opening_hours || '',
    submittedBy: '',
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS = `
  id, name, category, region, country, latitude, longitude, address, cover_image,
  photos, tags, instagram, website, google_map_link, rating, featured,
  halal, prayer_room, veg_friendly, entry_fee, best_time_to_visit, local_tips,
  opening_hours, created_at, published,
  spot_translations ( lang, name, description )
`;

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function listSpots(req, res) {
  const { lang, category, exclude, region, country, halal, limit, cursor } = req.query || {};
  const l = LANGS.indexOf(lang) !== -1 ? lang : 'en';
  const pageSize = Math.min(parseInt(limit, 10) || 100, 100);
  const offset = parseInt(cursor, 10) || 0;

  try {
    let q = getSupaPublic()
      .from('spots')
      .select(SELECT_COLUMNS)
      .eq('published', true);

    if (category && category !== 'all') {
      const cats = category.split(',').map((s) => s.trim()).filter(Boolean);
      if (cats.length === 1) q = q.eq('category', cats[0]);
      else if (cats.length > 1) q = q.in('category', cats);
    }
    if (exclude) {
      const excludeCats = exclude.split(',').map((s) => s.trim()).filter(Boolean);
      if (excludeCats.length) q = q.not('category', 'in', '(' + excludeCats.join(',') + ')');
    }
    if (region) q = q.eq('region', region);
    if (country) q = q.eq('country', country);
    if (halal === '1' || halal === 'true') q = q.eq('halal', true);

    q = q
      .order('featured', { ascending: false })
      .order('rating', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    const { data, error } = await q;
    if (error) throw error;

    const spots = (data || []).map((row) => formatSpot(row, l));
    const hasMore = spots.length === pageSize;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.json({
      spots,
      hasMore,
      nextCursor: hasMore ? String(offset + pageSize) : null,
      lang: l,
    });
  } catch (err) {
    console.error('travel-spots error:', err);
    res.status(500).json({ error: 'Failed to load spots', detail: err.message });
  }
}

async function renderSpotPage(req, res) {
  const { id, lang } = req.query || {};
  if (!id) return res.status(400).send('Missing spot id');
  const l = LANGS.indexOf(lang) !== -1 ? lang : 'en';
  const SITE = getSiteUrl(req);

  try {
    const { data: row, error } = await getSupaPublic()
      .from('spots')
      .select(SELECT_COLUMNS)
      .eq('id', id)
      .eq('published', true)
      .maybeSingle();

    if (error || !row) return res.redirect(302, SITE + '/');
    const spot = formatSpot(row, l);

    const e = escHtml;
    const ogImage = spot.coverImage || (spot.photos[0] || SITE + '/images/splash.png');
    const ogTitle = e(spot.name + ' — Travel-ID');
    const ogDesc = e((spot.description || '').substring(0, 200));
    const spotUrl = SITE + '/spot/' + id + (lang ? '?lang=' + lang : '');
    const appUrl = SITE + '/?spot=' + id + (lang ? '&lang=' + lang : '');
    const localeMap = { en: 'en_US', id: 'id_ID', ms: 'ms_MY', ko: 'ko_KR', zh: 'zh_CN', ja: 'ja_JP', ar: 'ar_SA' };
    const dirAttr = l === 'ar' ? ' dir="rtl"' : '';
    const CAT_EMOJI = {
      beach: '🏖️', temple: '🛕', cultural: '🎭', volcano: '🌋',
      nature: '🌿', diving: '🤿', food: '🍜', cafe: '☕',
      shopping: '🛍️', nightlife: '🌙', museum: '🏛️',
      adventure: '🧗', wellness: '🧘', mosque: '🕌',
    };
    const catEmoji = CAT_EMOJI[spot.category] || '📍';

    const html = `<!DOCTYPE html>
<html lang="${l}"${dirAttr}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ogTitle}</title>
<meta name="description" content="${ogDesc}">
<meta property="og:type" content="article">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${ogDesc}">
<meta property="og:image" content="${e(ogImage)}">
<meta property="og:url" content="${e(spotUrl)}">
<meta property="og:locale" content="${localeMap[l] || 'en_US'}">
<meta property="og:site_name" content="Travel-ID">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${ogTitle}">
<meta name="twitter:description" content="${ogDesc}">
<meta name="twitter:image" content="${e(ogImage)}">
<link rel="canonical" href="${e(spotUrl)}">
<meta http-equiv="refresh" content="0; url=${e(appUrl)}">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 24px auto; padding: 16px; color: #1F2937; }
  h1 { font-size: 1.6rem; margin-bottom: 4px; }
  .meta { color: #6B7280; font-size: 0.9rem; margin-bottom: 16px; }
  .cta { display: inline-block; background: #E11D2E; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; margin-top: 16px; }
  img { max-width: 100%; border-radius: 12px; margin: 12px 0; }
</style>
</head>
<body>
${spot.coverImage ? `<img src="${e(spot.coverImage)}" alt="${e(spot.name)}">` : ''}
<h1>${catEmoji} ${e(spot.name)}</h1>
<div class="meta">${e(spot.region)} · ${e(spot.category)}</div>
<p>${e(spot.description)}</p>
<a class="cta" href="${e(appUrl)}">Open in Travel-ID →</a>
</body>
</html>`;

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    console.error('renderSpotPage error:', err);
    return res.redirect(302, SITE + '/');
  }
}

module.exports = async function handler(req, res) {
  if (req.query && req.query.render === 'page') return renderSpotPage(req, res);
  return listSpots(req, res);
};
