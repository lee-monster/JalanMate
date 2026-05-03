# Travel-ID

> Discover Indonesia & Malaysia — for international tourists and local residents alike.

Community-driven travel guide for Indonesia and Malaysia. Bali, Yogyakarta, Komodo,
Bromo, Kuala Lumpur, Penang, Langkawi, Borneo — with halal / prayer-room info, AI
trip planning, and an interactive Google Map. Seven languages: English, Bahasa
Indonesia, Bahasa Melayu, 한국어, 中文, 日本語, العربية (RTL).

## Stack
- Vanilla HTML / CSS / JS (no framework, no build step)
- Vercel serverless functions (Node 18+)
- Supabase (Postgres + Auth + RLS) as the data + auth backend
- Google Maps + Geocoding + Places APIs
- Gemini 2.0 Flash for AI itinerary generation
- Google Identity Services button → Supabase `signInWithIdToken`

## Quick start (local)
```bash
npm install
cp .env.example .env.local      # fill in your keys
npx vercel dev                  # serves the SPA + APIs at http://localhost:3000
```

You'll need:
- A Supabase project (URL + anon key + service-role key).
- Run the migrations in `supabase/migrations/` via the Supabase SQL Editor.
- Google Maps JS + Geocoding API keys.
- Google OAuth Client ID (web type) — paste it BOTH in Vercel env AND in
  Supabase → Authentication → Providers → Google.
- A Gemini API key.

See [DEPLOY.md](./DEPLOY.md) for end-to-end deployment instructions.

## Project structure
See [CLAUDE.md](./CLAUDE.md).

## License
Private project. All rights reserved by the author.
