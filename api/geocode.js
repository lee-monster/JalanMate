// Geocode API — Convert address to coordinates (Google Maps Geocoding only).
// Naver Maps does not cover Indonesia.
//   GET /api/geocode?query=Jl.+Raya+Ubud+No.123,+Ubud,+Bali
//
// Region biased to Indonesia (region=id) so partial Indonesian addresses
// resolve correctly without disambiguation.
const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse response')); }
      });
    }).on('error', reject);
  });
}

async function googleGeocode(query, apiKey, lang) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&language=${lang || 'en'}&region=id&key=${apiKey}`;
  const result = await httpsGet(url);
  if (result.status !== 'OK' || !result.results || result.results.length === 0) return [];
  return result.results.map((r) => ({
    formattedAddress: r.formatted_address || '',
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    provider: 'google',
  }));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { query, lang } = req.query || {};
  if (!query) return res.status(400).json({ error: 'query parameter required' });

  const googleKey = process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!googleKey) return res.status(500).json({ error: 'Geocoding API key not configured' });

  try {
    const addresses = await googleGeocode(query, googleKey, lang);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ query, addresses });
  } catch (err) {
    console.error('Geocode error:', err);
    res.status(500).json({ error: 'Geocoding failed', detail: err.message });
  }
};
