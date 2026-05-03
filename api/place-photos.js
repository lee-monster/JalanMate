// GET /api/place-photos?name=...&lat=...&lng=... - Google Places Photos proxy
// Returns photo URLs for a place using Google Places API (New)
// Uses server-side API key (no referrer restriction)

const API_KEY = process.env.GOOGLE_GEOCODING_API_KEY; // server-side key, no referrer restriction

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Cache for 24 hours (server) and 1 hour (client)
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800, public');

  const { name, lat, lng } = req.query;
  if (!name || !lat || !lng) {
    return res.status(400).json({ error: 'Missing required params: name, lat, lng' });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'Google API key not configured' });
  }

  try {
    // Step 1: Find place by text query with location bias
    const searchUrl = 'https://places.googleapis.com/v1/places:searchText';
    const searchRes = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.photos,places.regularOpeningHours,places.websiteUri'
      },
      body: JSON.stringify({
        textQuery: name,
        locationBias: {
          circle: {
            center: { latitude: parseFloat(lat), longitude: parseFloat(lng) },
            radius: 1000.0
          }
        },
        maxResultCount: 1,
        languageCode: 'en'
      })
    });

    const searchData = await searchRes.json();

    if (!searchData.places || searchData.places.length === 0) {
      return res.status(200).json({ photos: [], source: 'google' });
    }

    const place = searchData.places[0];
    if (!place.photos || place.photos.length === 0) {
      return res.status(200).json({ photos: [], source: 'google' });
    }

    // Step 2: Build photo URLs (max 6 photos)
    const photos = place.photos.slice(0, 6).map(function(photo) {
      // photo.name format: "places/{placeId}/photos/{photoRef}"
      var photoUrl = 'https://places.googleapis.com/v1/' + photo.name + '/media'
        + '?maxHeightPx=400&maxWidthPx=600&key=' + API_KEY;
      return {
        url: photoUrl,
        attribution: (photo.authorAttributions && photo.authorAttributions[0])
          ? photo.authorAttributions[0].displayName : 'Google'
      };
    });

    // Opening hours
    var openingHours = null;
    if (place.regularOpeningHours && place.regularOpeningHours.weekdayDescriptions) {
      openingHours = place.regularOpeningHours.weekdayDescriptions;
    }

    return res.status(200).json({
      photos: photos,
      placeName: place.displayName ? place.displayName.text : name,
      websiteUri: place.websiteUri || null,
      openingHours: openingHours,
      source: 'google'
    });
  } catch (err) {
    console.error('Place photos error:', err);
    return res.status(500).json({ error: 'Failed to fetch photos', detail: err.message });
  }
};
