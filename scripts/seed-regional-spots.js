#!/usr/bin/env node
/**
 * Seed the 56 regional spots (scripts/regional-spots-data.js) into Supabase.
 *
 * Two modes:
 *   node scripts/seed-regional-spots.js --emit-sql
 *       → writes supabase/migrations/0003_regional_spots.sql
 *         (pure Node, no deps, no credentials needed)
 *
 *   node scripts/seed-regional-spots.js
 *       → upserts spots + translations into Supabase via the service-role key.
 *         Requires .env.local with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *         Run `npm install` first (needs @supabase/supabase-js + dotenv).
 *
 * Idempotent: spots are matched case-insensitively on name; translations are
 * upserted on (spot_id, lang). Re-running updates existing rows in place.
 */
const fs = require('fs');
const path = require('path');
const { SPOTS } = require('./regional-spots-data');

const TR_LANGS = ['id', 'ko', 'zh']; // en handled separately (name = canonical)

// ── SQL emitters ────────────────────────────────────────────
function sqlStr(s) {
  if (s === null || s === undefined) return 'null';
  return "'" + String(s).replace(/'/g, "''") + "'";
}
function sqlArr(arr) {
  if (!arr || !arr.length) return "'{}'";
  return 'array[' + arr.map(sqlStr).join(', ') + ']';
}
const sqlBool = (b) => (b ? 'true' : 'false');
const sqlNum = (n) => (n === null || n === undefined ? 'null' : String(n));

function buildSql() {
  const spotRows = SPOTS.map((s) =>
    `    (${sqlStr(s.name)}, ${sqlStr(s.category)}, ${sqlStr(s.region)}, 'ID', ${sqlNum(s.lat)}, ${sqlNum(s.lng)},\n` +
    `     ${sqlStr(s.address)},\n` +
    `     ${sqlBool(s.halal)}, ${sqlBool(s.prayer)}, ${sqlNum(s.fee)}, ${sqlStr(s.best)},\n` +
    `     ${sqlStr(s.tips)},\n` +
    `     ${sqlStr(s.hours)},\n` +
    `     ${sqlArr(s.tags)}, ${sqlBool(s.featured)}, true)`
  ).join(',\n\n');

  const trRows = [];
  for (const s of SPOTS) {
    trRows.push(`  (${sqlStr(s.name)}, 'en', ${sqlStr(s.name)}, ${sqlStr(s.tr.en)})`);
    for (const lang of TR_LANGS) {
      const t = s.tr[lang];
      if (!t) continue;
      trRows.push(`  (${sqlStr(s.name)}, '${lang}', ${sqlStr(t[0])}, ${sqlStr(t[1])})`);
    }
  }

  return `-- 0003_regional_spots.sql — 56 spots across 7 Indonesian regions
-- Jakarta · Yogyakarta · Malang · Bandung · Medan · Manado · Bogor (8 each).
--
-- GENERATED FILE — edit scripts/regional-spots-data.js then re-run:
--   node scripts/seed-regional-spots.js --emit-sql
--
-- Translations authored for en + id + ko + zh; ms/ja/ar fall back to en in the
-- app (see api/travel-spots.js formatSpot). Idempotent: ON CONFLICT DO NOTHING.

with new_spots as (
  insert into travelid.spots (
    name, category, region, country, latitude, longitude, address,
    halal, prayer_room, entry_fee, best_time_to_visit, local_tips,
    opening_hours, tags, featured, published
  ) values
${spotRows}
  on conflict ((lower(name))) do nothing
  returning id, name
)
insert into travelid.spot_translations (spot_id, lang, name, description)
select id, t.lang, t.name, t.description
from new_spots
join lateral (values
${trRows.join(',\n')}
) as t(spot_name, lang, name, description) on t.spot_name = new_spots.name
on conflict (spot_id, lang) do nothing;
`;
}

// ── Supabase seeding ────────────────────────────────────────
async function seed() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
  const { createClient } = require('@supabase/supabase-js');

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SCHEMA = process.env.SUPABASE_SCHEMA || 'travelid';
  if (!SUPA_URL || !SUPA_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (set them in .env.local).');
    process.exit(1);
  }

  const supa = createClient(SUPA_URL, SUPA_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: SCHEMA },
  });

  let inserted = 0, updated = 0, trCount = 0;

  for (const s of SPOTS) {
    const spotRow = {
      name: s.name, category: s.category, region: s.region, country: 'ID',
      latitude: s.lat, longitude: s.lng, address: s.address,
      halal: s.halal, prayer_room: s.prayer, entry_fee: s.fee,
      best_time_to_visit: s.best, local_tips: s.tips, opening_hours: s.hours,
      tags: s.tags, featured: s.featured, published: true,
    };

    // Match case-insensitively on name (no % / _ in our names → exact match).
    const { data: existing } = await supa
      .from('spots').select('id').ilike('name', s.name).maybeSingle();

    let spotId;
    if (existing) {
      spotId = existing.id;
      const { error } = await supa.from('spots').update(spotRow).eq('id', spotId);
      if (error) { console.error('UPDATE failed:', s.name, '—', error.message); continue; }
      updated++;
      console.log('  ↻ Updated:', s.name);
    } else {
      const { data, error } = await supa.from('spots').insert(spotRow).select('id').single();
      if (error) { console.error('INSERT failed:', s.name, '—', error.message); continue; }
      spotId = data.id; inserted++;
      console.log('  + Inserted:', s.name);
    }

    const trRows = [{ spot_id: spotId, lang: 'en', name: s.name, description: s.tr.en }];
    for (const lang of TR_LANGS) {
      const t = s.tr[lang];
      if (t) trRows.push({ spot_id: spotId, lang, name: t[0], description: t[1] });
    }
    const { error: trErr } = await supa
      .from('spot_translations').upsert(trRows, { onConflict: 'spot_id,lang' });
    if (trErr) console.error('  translations failed:', s.name, '—', trErr.message);
    else trCount += trRows.length;
  }

  console.log(`\nDone. Spots inserted: ${inserted}, updated: ${updated}. Translations upserted: ${trCount}.`);
}

// ── main ────────────────────────────────────────────────────
if (process.argv.includes('--emit-sql')) {
  const out = path.join(__dirname, '..', 'supabase', 'migrations', '0003_regional_spots.sql');
  fs.writeFileSync(out, buildSql(), 'utf8');
  console.log(`Wrote ${out} (${SPOTS.length} spots).`);
} else {
  seed().catch((err) => { console.error(err); process.exit(1); });
}
