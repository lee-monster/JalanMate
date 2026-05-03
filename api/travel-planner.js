// POST /api/travel-planner — AI Travel Planner backed by Gemini, tuned for
// Indonesia (inter-island flights/ferries, halal & prayer info, dry/wet season,
// rupiah pricing). Daily usage is rate-limited per Notion user.
//
// Body: { spots: [...], days, budget, style, lang, visitType }
//   visitType: 'local' | 'first' | 'return' | 'business' | 'group' | null
const { notion, USERS_DB } = require('./_lib/notion');
const { getUserFromRequest, setCors } = require('./_lib/auth');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DAILY_LIMIT = 20;

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'AI planner not configured - missing GEMINI_API_KEY' });
  }

  // Per-user daily rate limit, stored in Notion Users.Plans (we reuse the
  // Plans rich_text as a tiny JSON state container: { __usage: { yyyy-mm-dd: n } }).
  // For lower latency, swap this for KV / Upstash in production.
  let usage = {};
  let storedPlans = [];
  const todayKey = new Date().toISOString().slice(0, 10);
  let todayCount = 0;
  try {
    const userPage = await notion().pages.retrieve({ page_id: user.sub });
    const plansRaw = (userPage.properties.Plans && userPage.properties.Plans.rich_text || [])
      .map((t) => t.plain_text).join('');
    if (plansRaw) {
      const parsed = JSON.parse(plansRaw);
      if (Array.isArray(parsed)) storedPlans = parsed;
      else if (parsed && typeof parsed === 'object') {
        usage = parsed.__usage || {};
        storedPlans = parsed.plans || [];
      }
    }
    todayCount = usage[todayKey] || 0;
    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({ error: 'rate_limit', limit: DAILY_LIMIT, used: todayCount, remaining: 0 });
    }
  } catch (err) {
    console.error('usage check error:', err.message);
    // Continue with zero usage if Notion read fails — better UX than blocking.
  }

  const { spots, days, budget, style, lang, visitType } = req.body || {};
  if (!spots || !spots.length || !days) {
    return res.status(400).json({ error: 'Missing required fields: spots, days' });
  }

  const spotDescriptions = spots.map((s, i) =>
    (i + 1) + '. ' + s.name +
    (s.category ? ' [' + s.category + ']' : '') +
    (s.region ? ' - ' + s.region : '') +
    (s.address ? ' (' + s.address + ')' : '') +
    (s.halal ? ' [halal-friendly]' : '') +
    (s.prayerRoom ? ' [has prayer room]' : '') +
    (s.entryFeeIDR != null ? ' [entry IDR ' + s.entryFeeIDR.toLocaleString() + ']' : '') +
    (s.bestTimeToVisit ? ' [best: ' + s.bestTimeToVisit + ']' : '') +
    (s.description ? '\n   ' + s.description.substring(0, 200) : '')
  ).join('\n');

  const langNames = { en: 'English', id: 'Bahasa Indonesia', ko: '한국어', zh: '中文', ja: '日本語' };
  const respondLang = langNames[lang] || 'English';

  const budgetDesc = {
    budget:   'Budget-friendly (warung, public transport, hostels — under IDR 500k/day)',
    moderate: 'Moderate (mid-range restaurants, Grab/Gojek, 3-star hotels — IDR 500k–1.5M/day)',
    luxury:   'Luxury (fine dining, private driver, 5-star resort — IDR 2M+/day)',
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
This traveler is visiting Indonesia for the FIRST TIME. Lead with iconic must-see places
(Borobudur sunrise, Komodo dragons, Ubud rice terraces, Uluwatu kecak dance). Include
a brief "what to expect" line per region, money-changer warnings, e-VOA reminder, and
"don't drink tap water." Mention sarong/sash etiquette before any temple visit.` : ''
  ) + (
    visitType === 'return' ? `
## Return International Visitor
This is a RETURN visitor who has already done the bucket-list spots. Surface hidden gems
(Nusa Penida west coast, Tumpak Sewu, Kelimutu, Wakatobi, Mentawai surf), local festivals,
neighborhood walks (Petitenget, Kemang, Yogya kampung), and lesser-known islands.
Avoid hyper-touristy spots unless explicitly selected.` : ''
  ) + (
    visitType === 'business' ? `
## Business Trip
Tight schedule built around weekday meetings. Anchor accommodation in CBD (Jakarta:
Sudirman/SCBD; Bali: Seminyak/Nusa Dua; Bandung: Dago). Suggest short evening pockets,
reliable airport transfer (Blue Bird / hotel car > random taxi), business-friendly
restaurants (private rooms, quiet ambiance), 1-2 quick cultural touches per day max.` : ''
  ) + (
    visitType === 'group' ? `
## Group Travel
6–15 people. Favor venues taking group reservations, large-table restaurants, group
experiences (cooking class in Ubud, batik workshop in Yogya, kecak performance, Mt
Bromo jeep tour). Recommend chartered van/bus for inter-city; flag when public transit
becomes impractical. Note reservation lead times (2-4 weeks for popular spots).` : ''
  ) + (
    visitType === 'local' ? `
## Local Resident (Domestic Traveler)
This traveler LIVES in Indonesia. Skip visa/SIM-card/currency-exchange tips entirely.
Use IDR pricing without USD conversion. Prefer KAI train (Java) and overnight Pelni
ferry options over flights when budget-relevant. Reference local payment methods
(GoPay, OVO, DANA, ShopeePay, BCA, QRIS) instead of "bring cash". Suggest weekend-trip
framing ("Jumat malam berangkat, Minggu malam pulang") and family-friendly logistics
where applicable.` : ''
  );

  const systemPrompt = `You are Travel-ID's AI Travel Planner — an expert on traveling in Indonesia,
serving both international visitors AND Indonesian residents.
Create a detailed, practical day-by-day travel itinerary based on the user's selected
spots and preferences. Use Google Search to verify the latest opening hours, ticket
prices, ferry schedules, and seasonal closures.

## Geography rules (critical for Indonesia)
- Indonesia spans 5,000 km across 17,000+ islands. Always group spots by ISLAND first,
  then by region within an island, to avoid impossible same-day inter-island routes.
- Inter-island moves require a flight or ferry — schedule them as their own travel
  day or half-day, with realistic transit times (e.g., Bali → Lombok ferry 4-5h, or
  Lion Air flight 30 min + airport).
- Bali, Java, Lombok, Sumatra, Sulawesi, Komodo (Flores), Raja Ampat (Papua) are all
  separate islands — never plan a single day that hops between them.

## Reference transport costs (as of 2026, IDR)
- Domestic flight Jakarta↔Bali: IDR 700k–1.5M (Lion/Citilink/Batik Air, 2h)
- Domestic flight Jakarta↔Yogyakarta: IDR 500k–1M (1h 15m)
- Domestic flight Jakarta↔Medan: IDR 700k–1.4M (2h 15m)
- Domestic flight Bali↔Komodo (Labuan Bajo): IDR 800k–1.6M (1h 15m)
- Bali↔Lombok fast boat: IDR 250k–450k (1.5–2h, several operators incl. Eka Jaya, BlueWater)
- Bali↔Gili Trawangan fast boat: IDR 350k–550k (1.5h)
- Bali↔Nusa Penida fast boat: IDR 100k–200k (40–60 min)
- KAI executive train Jakarta↔Yogyakarta: IDR 350k–550k (8h)
- KAI executive train Jakarta↔Bandung (Whoosh HSR): IDR 250k–600k (45 min)
- Pelni ferry (national line, budget cabin Jakarta↔Surabaya): IDR 200k–500k (24h)
- Grab/Gojek city ride: IDR 15k–60k typical city ride; IDR 80k–150k airport→city
- Bluebird taxi (metered): IDR 7,500 base, ~IDR 4,500/km
- Scooter rental (Bali, Lombok): IDR 70k–120k/day; needs International Driving Permit

## Itinerary structure (every plan must include)
- Group days by ISLAND, then logically chain spots within each island
- Time blocks: Morning (07:00-12:00), Afternoon (12:00-18:00), Evening (18:00-22:00)
- Each spot: estimated time on site, transport mode + cost + duration to next spot
- Meal recommendations near each area, with IDR price ranges
- For temples / mosques: dress code reminder (sarong + sash provided at most temples)
- For sunrise hikes (Bromo, Borobudur, Rinjani, Kelimutu, Batur): start times, layers
  needed (5-10°C at altitude vs 30°C at sea level), guide/jeep booking note
${isLocal ? '- DO NOT include visa, SIM-card, or currency-exchange information.' : `
- Include a brief "Foreign visitor essentials" callout (e-VOA reminder, SIM at arrival,
  GoPay/Grab installation, "drink only bottled water", emergency 112)`}
- Match the travel pace to the user's style preference

## Daily cost breakdown (mandatory)
End EVERY day with a table:
  - Transport: itemized
  - Meals: breakfast / lunch / dinner estimates in IDR
  - Admission: entrance fees (IDR — Indonesian residents often pay 5-10x less than
    foreigners at major sites; reflect that for local users)
  - **Day X Total: IDR X,XXX,XXX**

End the plan with a Grand Total Summary:
  - Total Transport / Meals / Admission / Accommodation
  - **Trip Grand Total: IDR X,XXX,XXX**${isLocal ? '' : ` (~USD XXX, EUR XXX)`}
  - Weather note (dry vs wet season impacts on activities)
  - Note: "Prices are 2026 estimates; check operator sites before booking."

Respond ENTIRELY in ${respondLang}. Use markdown headings, tables, and bold sparingly.
${visitTypeBlock}`;

  const userPrompt = `Plan a ${days}-day Indonesia travel itinerary.

**Budget Level:** ${budgetDesc[budget] || budget || 'Moderate'}
**Travel Style:** ${styleDesc[style] || style || 'Balanced'}
**Traveler Type:** ${isLocal ? 'Indonesian resident (domestic trip)' : 'International visitor'}

**Selected spots to include:**
${spotDescriptions}

Create a day-by-day plan that covers all these spots efficiently. Group by island,
include meals, transport (mode + IDR cost + duration), and time estimates.`;

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
      return res.status(502).json({ error: 'AI service returned empty response', detail: candidate && candidate.finishReason ? 'Finish reason: ' + candidate.finishReason : 'No candidates' });
    }

    const plan = candidate.content.parts.filter((p) => p.text).map((p) => p.text).join('');

    // Increment usage; keep only the last 7 days (small storage budget in Notion).
    try {
      usage[todayKey] = todayCount + 1;
      const trimmedUsage = {};
      Object.keys(usage).sort().slice(-7).forEach((k) => { trimmedUsage[k] = usage[k]; });
      const stateBlob = JSON.stringify({ __usage: trimmedUsage, plans: storedPlans });
      // Notion rich_text chunk cap is 2000 chars; if state ever exceeds that we
      // drop the oldest plans to make room.
      const safeBlob = stateBlob.length <= 1900 ? stateBlob :
        JSON.stringify({ __usage: trimmedUsage, plans: storedPlans.slice(-3) });
      await notion().pages.update({
        page_id: user.sub,
        properties: { Plans: { rich_text: [{ text: { content: safeBlob } }] } },
      });
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
