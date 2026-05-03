// /api/share-plan — Save and retrieve shared travel plans (Supabase-backed).
//   POST: save a plan, return ShareId
//   GET ?id=<shareId>: retrieve a shared plan
const crypto = require('crypto');
const { getSupaAdmin, getSiteUrl } = require('./_lib/supabase');
const { setCors, getUserFromRequest } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET')  return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
};

async function handleGet(req, res) {
  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id parameter' });

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  try {
    const { data, error } = await getSupaAdmin()
      .from('shared_plans')
      .select('share_id, title, days, budget, style, lang, spot_names, plan_html, created_at')
      .eq('share_id', id)
      .maybeSingle();

    if (error) {
      console.error('share-plan GET error:', error);
      return res.status(500).json({ error: 'Failed to retrieve plan' });
    }
    if (!data) return res.status(404).json({ error: 'Plan not found' });

    return res.status(200).json({
      success: true,
      plan: {
        title: data.title,
        days: data.days || 0,
        budget: data.budget || '',
        style: data.style || '',
        spotNames: data.spot_names || [],
        planHtml: data.plan_html || '',
        lang: data.lang || 'en',
        sharedAt: data.created_at,
      },
    });
  } catch (err) {
    console.error('share-plan GET fatal:', err);
    return res.status(500).json({ error: 'Failed to retrieve plan' });
  }
}

async function handlePost(req, res) {
  const { title, days, budget, style, spotNames, planHtml, lang } = req.body || {};
  if (!title || !planHtml) {
    return res.status(400).json({ error: 'Missing required fields: title, planHtml' });
  }

  const owner = await getUserFromRequest(req);  // optional
  const supa = getSupaAdmin();

  for (let attempt = 0; attempt < 5; attempt++) {
    const shareId = crypto.randomBytes(4).toString('hex');
    try {
      const { error } = await supa.from('shared_plans').insert({
        share_id: shareId,
        user_id: owner ? owner.id : null,
        title,
        days: days || null,
        budget: budget || null,
        style: style || null,
        lang: lang || null,
        spot_names: Array.isArray(spotNames) ? spotNames : [],
        plan_html: planHtml,
      });
      if (error) {
        if (/duplicate key|share_id/i.test(error.message)) continue; // retry
        console.error('share-plan POST error:', error);
        return res.status(500).json({ error: 'Failed to save shared plan' });
      }
      return res.status(200).json({
        success: true,
        shareId,
        shareUrl: getSiteUrl(req) + '/plan/' + shareId,
      });
    } catch (err) {
      console.error('share-plan POST fatal:', err);
      return res.status(500).json({ error: 'Failed to save shared plan' });
    }
  }
  return res.status(500).json({ error: 'Could not allocate share id' });
}
