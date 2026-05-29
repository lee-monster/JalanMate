#!/usr/bin/env node
/**
 * Read-only verification of the seeded data (no writes).
 *   node scripts/verify-seed.js
 * Confirms auto-connection to Supabase works and the regional spots landed.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const SCHEMA = process.env.SUPABASE_SCHEMA || 'travelid';
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: SCHEMA },
});

(async () => {
  const { data: spots, error } = await supa
    .from('spots').select('region, country');
  if (error) { console.error('Query failed:', error.message); process.exit(1); }

  const id = spots.filter((s) => s.country === 'ID');
  const byRegion = {};
  for (const s of id) byRegion[s.region || '(none)'] = (byRegion[s.region || '(none)'] || 0) + 1;

  console.log(`Total spots: ${spots.length}  (ID: ${id.length}, MY: ${spots.length - id.length})`);
  console.log('\nID spots by region:');
  Object.keys(byRegion).sort().forEach((r) => console.log(`  ${r.padEnd(16)} ${byRegion[r]}`));

  const { count: trCount, error: trErr } = await supa
    .from('spot_translations').select('*', { count: 'exact', head: true });
  if (!trErr) console.log(`\nspot_translations rows: ${trCount}`);
})();
