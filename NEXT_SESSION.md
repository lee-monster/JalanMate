# Next Session — Resume from here

> This file is committed to git, so `git pull` on any PC will retrieve it.
> The companion `WORK_LOG.md` (gitignored, OneDrive-synced) has more detail.

## Tomorrow's first command (on the other PC)

```bash
cd "C:\Users\User\OneDrive\0_project\JalanMate"
git status                        # should be clean
git pull origin main              # latest from GitHub
git log --oneline -5              # confirm latest commit
```

**Latest commit as of session close (2026-05-26)**:
`b7b5588 — Fix sidebar topbar overflow; default language to English`

If `git pull` says "already up to date" and the latest commit matches, you're
synced.

---

## What was completed this session (2026-05-26) — Travel-ID → JalanMate rebrand

- ✅ Renamed service **Travel-ID → JalanMate** (AI travel planner for Indonesia;
  Malaysia/Singapore long-term). New logos wired in (`logo_fit.png`,
  `logo_app_icon.png`); PWA icons regenerated; branded 1200×630 OG card.
- ✅ Removed TravelKo legacy: Korea/Naver/Notion text. Legal pages (privacy/terms)
  rebuilt for the real 7 languages (en/id/ms/ko/zh/ja/ar, Arabic RTL).
- ✅ GitHub repo → `lee-monster/JalanMate`; Vercel project → `jalanmate`; canonical
  domain `jalanmate.vercel.app` across code + docs (was bogus `travel-id.kr`).
- ✅ Brand palette from logo + ID/MY/SG flags: red `#E11D2E` (primary), navy
  `#1A3C8C` (secondary), gold `#F5B301` (accent), white. (`css/travel-app.css` `:root`)
- ✅ Removed orphaned art + TravelKo `assetlinks.json`; gitignored local working files.
- ✅ Sidebar topbar overflow fixed (logo 34px + compact language select); default
  UI language now English.

## What remains — pick up from here

> Rebrand is done & pushed. GitHub repo (`lee-monster/JalanMate`), Vercel project
> (`jalanmate`), and the `jalanmate.vercel.app` domain are all set. Below is the
> deploy/verify checklist + small follow-ups.

**On the other PC**: `git remote set-url origin https://github.com/lee-monster/JalanMate.git`, then `git pull`.

**Small follow-ups**: `images/main_preview.png` (PWA "wide" screenshot) is still old
art — replace with a real JalanMate screenshot; GA4 id is still `G-XXXXXXXXXX`; add
`jalanmate.vercel.app` to Google Cloud OAuth JS origins + Maps key referrers.

### 🔥 Step 1 — Confirm Vercel env vars + redeploy
Vercel dashboard → jalanmate project → Settings → Environment Variables.
Add the following (Production / Preview / Development all checked):

```
PUBLIC_SITE_URL              https://jalanmate.vercel.app
SUPABASE_URL                 (same as TravelKo)
SUPABASE_ANON_KEY            (same as TravelKo)
SUPABASE_SERVICE_ROLE_KEY    (same as TravelKo)
SUPABASE_SCHEMA              travelid
GOOGLE_MAPS_API_KEY          (frontend key — restrict to HTTP referrers)
GOOGLE_GEOCODING_API_KEY     (server key)
GOOGLE_CLIENT_ID             (reuse TravelKo's if same Google project)
GEMINI_API_KEY               (from aistudio.google.com)
```

### Step 2 — Redeploy
Vercel → Deployments → latest → ⋯ → Redeploy

### Step 3 — Verify (run from your PC)
```bash
curl https://jalanmate.vercel.app/api/map-config
# Expect: { "googleKey": "AIza...", "googleClientId": "...", "supabaseUrl": "https://...", "supabaseAnonKey": "...", "supabaseSchema": "travelid", "siteUrl": "..." }

curl "https://jalanmate.vercel.app/api/travel-spots?lang=en&limit=3"
# Expect: { "spots": [...3 demo spots...], "hasMore": true, ... }

curl https://jalanmate.vercel.app/sitemap.xml | head -20
# Expect: URLs starting with https://jalanmate.vercel.app/
```

### Step 4 — Browser smoke test
Open https://jalanmate.vercel.app/ — verify:
- Splash → map shows on Bali
- 6 demo spots appear (3 in ID, 3 in MY)
- Language switch works (try `ar` for RTL)
- Region filter shows ID 🇮🇩 / MY 🇲🇾 grouped
- Sign-in with Google works → name appears top-right

### (Optional) Step 5 — Migrate the remaining 30 Notion spots
```bash
npm install
cp .env.example .env.local
# Fill .env.local with NOTION_TOKEN_TRAVEL + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
node -r dotenv/config scripts/migrate-notion-to-supabase.js dotenv_config_path=.env.local
```

---

## Reference docs (in this repo)

- `CLAUDE.md`         — full architecture, schema, auth flow
- `DEPLOY.md`         — step-by-step deployment (this file is a quick excerpt)
- `README.md`         — high-level overview
- `WORK_LOG.md`       — historical work log (gitignored, OneDrive-only)

## Key external resources

- GitHub repo:        https://github.com/lee-monster/JalanMate
- Vercel project:     https://vercel.com/hbtars/jalanmate
- Supabase project:   (same as TravelKo dashboard)
- Notion parent page: https://www.notion.so/355722c54b8881548b33fa2f1417ba1d

## If OneDrive lost something

GitHub is the source of truth. Local OneDrive folder may have stale or
half-synced files. To force-resync from authoritative source:

```bash
cd "C:\Users\User\OneDrive\0_project\JalanMate"
git fetch origin
git reset --hard origin/main      # ⚠️ wipes uncommitted local changes
```

Don't run `git reset --hard` unless you're sure no uncommitted work exists
locally. `git status` first to check.
