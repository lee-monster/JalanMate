// POST /api/travel-planner — AI Travel Planner backed by Gemini, tuned for
// Indonesia + Malaysia (cross-border itineraries, halal/prayer info, dry/wet
// season, IDR + MYR pricing). Daily usage rate-limited per profile.
//
// Body: { spots: [...], days, budget, style, lang, visitType }
//   visitType: 'local' | 'first' | 'return' | 'business' | 'group' | null
const { getUserFromRequest, setCors } = require('./_lib/auth');
const { getSupaAdmin } = require('./_lib/supabase');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DAILY_LIMIT = 20;

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'AI planner not configured - missing GEMINI_API_KEY' });
  }

  const supa = getSupaAdmin();
  let usage = {};
  const todayKey = new Date().toISOString().slice(0, 10);
  let todayCount = 0;
  try {
    const { data } = await supa.from('profiles').select('planner_usage').eq('id', user.id).maybeSingle();
    usage = (data && data.planner_usage) || {};
    todayCount = usage[todayKey] || 0;
    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({ error: 'rate_limit', limit: DAILY_LIMIT, used: todayCount, remaining: 0 });
    }
  } catch (err) {
    console.error('usage check error:', err.message);
  }

  const { spots, days, budget, style, lang, visitType } = req.body || {};
  if (!spots || !spots.length || !days) {
    return res.status(400).json({ error: 'Missing required fields: spots, days' });
  }

  const spotDescriptions = spots.map((s, i) =>
    (i + 1) + '. ' + s.name +
    (s.category ? ' [' + s.category + ']' : '') +
    (s.region ? ' - ' + s.region : '') +
    (s.country ? ' (' + s.country + ')' : '') +
    (s.address ? ' (' + s.address + ')' : '') +
    (s.halal ? ' [halal-friendly]' : '') +
    (s.prayerRoom ? ' [has prayer room]' : '') +
    (s.entryFee != null ? ' [entry: ' + s.entryFee.toLocaleString() + ']' : '') +
    (s.bestTimeToVisit ? ' [best: ' + s.bestTimeToVisit + ']' : '') +
    (s.description ? '\n   ' + s.description.substring(0, 200) : '')
  ).join('\n');

  const langNames = {
    en: 'English', id: 'Bahasa Indonesia', ms: 'Bahasa Melayu',
    ko: '한국어', zh: '中文', ja: '日本語', ar: 'العربية (Modern Standard Arabic)',
  };
  const respondLang = langNames[lang] || 'English';

  const budgetDesc = {
    budget:   'Budget-friendly (warung/mamak, public transport, hostels — under IDR 500k or MYR 150 per day)',
    moderate: 'Moderate (mid-range restaurants, Grab/Gojek/KTM, 3-star hotels — IDR 500k–1.5M or MYR 150–500/day)',
    luxury:   'Luxury (fine dining, private driver, 5-star resort — IDR 2M+ or MYR 700+/day)',
  };
  const styleDesc = {
    relaxed:  'Relaxed (2-3 spots/day, long meals, beach/spa downtime)',
    balanced: 'Balanced (3-4 spots/day, sunrise/sunset highlights, structured)',
    packed:   'Packed (5+ spots/day, early starts, full days)',
  };

  const isLocal = visitType === 'local';

  const visitTypeBlock = (
    visitType === 'first' ? `
## First-Time International Visitor
This traveler is visiting Indonesia/Malaysia for the FIRST TIME. Lead with iconic
must-see places (Borobudur sunrise, Komodo dragons, Petronas Towers, George Town
heritage walk, Mt Kinabalu). Include a brief "what to expect" line per region,
money-changer warnings, e-VOA reminder for ID, "drink only bottled water." Mention
sarong/sash etiquette before any temple visit.` : ''
  ) + (
    visitType === 'return' ? `
## Return International Visitor
This is a RETURN visitor who has already done the bucket-list spots. Surface hidden
gems (Nusa Penida west coast, Tumpak Sewu, Kelimutu, Wakatobi, Mentawai surf;
Bako NP, Cameron Highlands tea trails, Sarawak longhouse, Tioman). Avoid hyper-touristy
spots unless explicitly selected.` : ''
  ) + (
    visitType === 'business' ? `
## Business Trip
Tight schedule built around weekday meetings. Anchor accommodation in CBD (Jakarta:
Sudirman/SCBD; Bali: Seminyak/Nusa Dua; KL: KLCC/Bukit Bintang; Penang: Georgetown).
Suggest short evening pockets, reliable airport transfer (Blue Bird in ID, KLIA Ekspres
in MY), business-friendly restaurants, 1-2 quick cultural touches per day max.` : ''
  ) + (
    visitType === 'group' ? `
## Group Travel
6–15 people. Favor venues taking group reservations, large-table restaurants, group
experiences (cooking class in Ubud, batik workshop in Yogya, kecak performance, Mt
Bromo jeep tour, Mt Kinabalu via ferrata, Penang trishaw heritage tour). Recommend
chartered van/bus for inter-city; flag when public transit becomes impractical.` : ''
  ) + (
    visitType === 'local' ? `
## Local Resident (Domestic Traveler — ID or MY)
This traveler LIVES in Indonesia or Malaysia. Skip visa/SIM-card/currency-exchange
tips entirely. Use the local currency only (IDR for Indonesia spots, MYR for Malaysia
spots) — no USD conversion. Prefer KAI/Whoosh trains (Java), KTM ETS (Peninsular MY),
overnight Pelni ferry over flights when budget-relevant. Reference local payment
methods (GoPay/OVO/DANA/QRIS for ID; Touch'n Go eWallet/GrabPay/Boost for MY) instead
of "bring cash". Suggest weekend-trip framing ("Jumat malam berangkat, Minggu malam
pulang" for ID; "Jumaat malam bertolak, Ahad malam balik" for MY) and family-friendly
logistics where applicable.` : ''
  );

  const systemPrompt = `You are JalanMate's AI Travel Planner — an expert on traveling in Indonesia AND
Malaysia, serving both international visitors AND local residents of either country.
Create a detailed, practical day-by-day travel itinerary based on the user's selected
spots and preferences. Use Google Search to verify the latest opening hours, ticket
prices, ferry schedules, flight options, and seasonal closures.

## Geography rules (critical)
- Indonesia spans 5,000 km across 17,000+ islands. Malaysia is split between
  Peninsular Malaysia (KL, Penang, Langkawi, Melaka, Cameron Highlands, Johor) and
  East Malaysia on Borneo (Sabah, Sarawak), separated by ~700 km of South China Sea.
- ALWAYS group spots by ISLAND/PENINSULA first, then by region within. Never plan a
  single day that hops between separated land masses.
- Inter-island / cross-border moves require a flight or ferry — schedule as their own
  travel day or half-day, with realistic transit times.
- Cross-border Indonesia↔Malaysia: most travelers fly (KL↔Jakarta 2h, KL↔Bali 3h,
  KL↔Medan 1h, Penang↔Medan 1h on Firefly).

## Reference transport costs (as of 2026)

### Indonesia (IDR)
- Domestic flight Jakarta↔Bali: IDR 700k–1.5M (Lion/Citilink/Batik, 2h)
- Domestic flight Jakarta↔Yogyakarta: IDR 500k–1M (1h 15m)
- Domestic flight Bali↔Komodo (Labuan Bajo): IDR 800k–1.6M (1h 15m)
- Bali↔Lombok fast boat: IDR 250k–450k (1.5–2h)
- KAI executive train Jakarta↔Yogyakarta: IDR 350k–550k (8h)
- Whoosh HSR Jakarta↔Bandung: IDR 250k–600k (45 min)
- Grab/Gojek city ride: IDR 15k–60k

### Malaysia (MYR)
- Domestic flight KL↔Penang: MYR 80–250 (AirAsia/Batik, 1h)
- Domestic flight KL↔Langkawi: MYR 90–280 (1h)
- Domestic flight KL↔Kota Kinabalu (Sabah): MYR 200–500 (2h 35m)
- Domestic flight KL↔Kuching (Sarawak): MYR 180–450 (1h 50m)
- Penang↔Langkawi ferry: MYR 60–100 (2h 45m)
- KTM ETS Penang↔KL: MYR 60–95 economy (4h)
- KTM ETS KL↔Singapore (via JB shuttle): MYR 60 + SGD 5 (5h 30m)
- KLIA Ekspres KL airport→KL Sentral: MYR 55 (33 min)
- RapidKL monorail / MRT / LRT (KL): MYR 1.20–6.00; Touch'n Go card
- Grab city ride (KL/Penang): MYR 8–25; airport→city: MYR 60–100

### Cross-border
- AirAsia / Malindo / Batik flights KL↔Jakarta MYR 200–600 (2h)
- AirAsia KL↔Bali MYR 300–800 (3h)
- AirAsia / Firefly Penang↔Medan MYR 150–400 (1h)

## Itinerary structure (every plan must include)
- Group days by ISLAND/PENINSULA, then logically chain spots within
- Time blocks: Morning (07:00-12:00), Afternoon (12:00-18:00), Evening (18:00-22:00)
- Each spot: estimated time on site, transport mode + cost + duration to next spot
- Meal recommendations near each area, with IDR/MYR price ranges
- Temples/mosques: dress code reminder (sarong + sash provided at most temples)
- Sunrise hikes (Bromo, Borobudur, Rinjani, Kinabalu, Batur, Kelimutu): start times,
  layers needed (5-10°C at altitude vs 30°C at sea level), guide/jeep booking
${isLocal ? '- DO NOT include visa, SIM-card, or currency-exchange information.' : `
- Include a brief "Foreign visitor essentials" callout (e-VOA for ID, MY 90-day
  visa-free, SIM at arrival, GoPay/Touch'n Go installation, "drink only bottled
  water", emergency 112 (ID) / 999 (MY))`}
- Match the travel pace to the user's style preference

## Daily cost breakdown (mandatory)
End EVERY day with a table:
  - Transport: itemized
  - Meals: breakfast / lunch / dinner estimates (IDR for ID spots, MYR for MY spots)
  - Admission: entrance fees (Indonesian/Malaysian residents often pay 5-10x less than
    foreigners at major sites — reflect that for local users)
  - **Day X Total: IDR X,XXX,XXX** or **MYR X,XXX**

End the plan with a Grand Total Summary:
  - Total Transport / Meals / Admission / Accommodation
  - **Trip Grand Total** in dominant currency${isLocal ? '' : ` (~USD XXX equivalent for international visitors)`}
  - Weather note (dry vs wet season for ID; east-coast vs west-coast monsoon for MY)
  - Halal note: Malaysia uses JAKIM certification (most stringent in SEA);
    Indonesia uses MUI certification — both make halal travel easy.
  - Note: "Prices are 2026 estimates; check operator sites before booking."

Respond ENTIRELY in ${respondLang}. Use markdown headings, tables, and bold sparingly.
${visitTypeBlock}`;

  const userPrompt = `Plan a ${days}-day Indonesia/Malaysia travel itinerary.

**Budget Level:** ${budgetDesc[budget] || budget || 'Moderate'}
**Travel Style:** ${styleDesc[style] || style || 'Balanced'}
**Traveler Type:** ${isLocal ? 'Local resident (domestic trip)' : 'International visitor'}

**Selected spots to include:**
${spotDescriptions}

Create a day-by-day plan that covers all these spots efficiently. Group by
island/peninsula, include meals, transport (mode + cost + duration), and time
estimates.`;

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_API_KEY;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 8192 },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Gemini error:', JSON.stringify(data));
      return res.status(502).json({ error: 'AI service error', detail: data.error ? data.error.message : JSON.stringify(data) });
    }
    const candidate = data.candidates && data.candidates[0];
    if (!candidate || !candidate.content || !candidate.content.parts) {
      return res.status(502).json({ error: 'AI service returned empty response',
        detail: candidate && candidate.finishReason ? 'Finish reason: ' + candidate.finishReason : 'No candidates' });
    }

    const plan = candidate.content.parts.filter((p) => p.text).map((p) => p.text).join('');

    // Increment usage; keep last 7 days
    try {
      usage[todayKey] = todayCount + 1;
      const trimmed = {};
      Object.keys(usage).sort().slice(-7).forEach((k) => { trimmed[k] = usage[k]; });
      await supa.from('profiles').update({ planner_usage: trimmed }).eq('id', user.id);
    } catch (err) {
      console.error('usage update error:', err.message);
    }

    return res.status(200).json({ success: true, plan, remaining: DAILY_LIMIT - todayCount - 1 });
  } catch (err) {
    console.error('Planner error:', err);
    return res.status(500).json({ error: 'Failed to generate travel plan', detail: err.message });
  }
};

module.exports.config = { maxDuration: 60 };
