# Next Session — Resume from here

> This file is committed to git, so `git pull` on any PC will retrieve it.
> The companion `WORK_LOG.md` (gitignored, OneDrive-synced) has more detail.

## First commands (on the other PC)

```bash
cd "C:\Users\<you>\OneDrive\0_project\JalanMate"
git status                        # should be clean
git pull origin main              # latest from GitHub
git log --oneline -5              # confirm latest commit
```

After `git pull`, the newest commit should be the **"Add 56 regional Indonesia
spots"** commit, and these three files should exist:

- `scripts/regional-spots-data.js`        ← 56-spot source of truth
- `scripts/seed-regional-spots.js`         ← seeder + SQL generator
- `supabase/migrations/0003_regional_spots.sql`  ← generated migration

---

## What was completed this session (2026-05-26) — 56 regional spots

Added a broad set of tourist spots across **7 Indonesian regions** (8 each = 56):
Jakarta · Yogyakarta · Malang · Bandung · Medan · Manado · Bogor.

- ✅ **Data module** `scripts/regional-spots-data.js` — single source of truth.
  Each spot has coordinates, category, entry fee (IDR), best time, local tips,
  opening hours, tags, and translations for **en + id + ko + zh**.
  (Per decision: ms/ja/ar are intentionally skipped — the app's `formatSpot`
  in `api/travel-spots.js` falls back to the English translation.)
- ✅ **Seeder** `scripts/seed-regional-spots.js` — two modes:
  - `node scripts/seed-regional-spots.js --emit-sql` → regenerates the 0003 SQL
    (pure Node, no deps, no credentials).
  - `node scripts/seed-regional-spots.js` → upserts into Supabase via the
    service-role key (needs `.env.local` + `npm install`). Idempotent.
- ✅ **Migration** `supabase/migrations/0003_regional_spots.sql` — generated from
  the data module. 56 spots + 224 translation rows. Validated: every category &
  best-time value satisfies the 0001 CHECK constraints; no name collision with
  the 0002 demo spots; idempotent (`ON CONFLICT DO NOTHING`).

## ✅ DONE — DB seeded & verified (2026-05-29)

All three migrations (0001 schema · 0002 demo · 0003 regional) were run against
the shared Supabase project via the SQL Editor, and verified with a read-only
script. Counts (`node scripts/verify-seed.js`):

- **62 spots total** — ID: 59, MY: 3
- 7 regions × 8 = 56 (Jakarta/Yogyakarta/Malang/Bandung/Medan/Manado/Bogor)
  + demo Bali/Borobudur/Bromo (3 ID) + 3 demo MY
- **266 spot_translations** rows (224 from 0003 + 42 from the 6 demo spots × 7 langs)

### This PC is now wired to Supabase directly
`.env.local` was created by copying the **shared** Supabase URL +
`SERVICE_ROLE_KEY` from the co-tenant project at
`C:\Users\User\OneDrive\Agent\9_travel-planner\.env.local`
(same project: `jycobzpclxofmxpxeegu.supabase.co`). `.env.local` is gitignored
but OneDrive-synced, so the other PC inherits it too. `npm install` has been run.
From now on the seeder / verify scripts run without the dashboard:
```bash
node scripts/verify-seed.js                       # read-only sanity check
node scripts/seed-regional-spots.js               # idempotent re-seed (writes)
node scripts/seed-regional-spots.js --emit-sql    # regenerate 0003 SQL (no creds)
```

### Still TODO — smoke test in the live UI
Open the live site → Region filter should show all 7 regions with spots; switch
language to **ko** and **zh** to confirm translations render, and to **ms/ja/ar**
to confirm the English fallback works.

---

## To add MORE spots or fill in ms/ja/ar later
Edit **only** `scripts/regional-spots-data.js`, then:
```bash
node scripts/seed-regional-spots.js --emit-sql   # regenerate 0003 SQL
```
and re-run the seed (idempotent — existing rows update in place). To add ms/ja/ar,
extend each spot's `tr` object and the `TR_LANGS` array in the seeder.

## Older follow-ups (still open, lower priority)
- `images/main_preview.png` (PWA "wide" screenshot) is still legacy art.
- GA4 id is still `G-XXXXXXXXXX`.
- Add `jalanmate.vercel.app` to Google Cloud OAuth JS origins + Maps key referrers.
- Confirm Vercel env vars are set + redeploy (see git history of this file).

## Key external resources
- GitHub repo:    https://github.com/lee-monster/JalanMate
- Vercel project: https://vercel.com/hbtars/jalanmate
- Supabase:       (same dashboard as TravelKo)

## If OneDrive lost something
GitHub is the source of truth. To force-resync (⚠️ wipes uncommitted local work):
```bash
git fetch origin && git reset --hard origin/main
```
Run `git status` first to be sure nothing local is unsaved.
