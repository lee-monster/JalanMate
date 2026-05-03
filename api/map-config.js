// Public client config: Google Maps key + Google OAuth Client ID.
// Travel-ID uses Google Maps as the sole map provider (Naver Maps does not
// cover Indonesia). All values returned here are safe to expose to the browser
// — restrict the Maps key with HTTP referrer rules in Google Cloud Console.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.json({
    googleKey: process.env.GOOGLE_MAPS_API_KEY || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  });
};
