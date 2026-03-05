# INGEST.IO

AI-powered link intelligence platform. Paste any URL, get structured knowledge with relevance tracking.

## Stack

- **Frontend**: Next.js 14 + React + TypeScript + Tailwind
- **Backend**: Next.js API Routes
- **Database**: Supabase (Postgres + Auth + Realtime)
- **AI**: Claude API with web search
- **Hosting**: Vercel

## Setup

### 1. Clone and install

```bash
git clone https://github.com/createwithsequence-byte/INGEST.git
cd INGEST
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Fill in:
- `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — your Supabase anon key
- `ANTHROPIC_API_KEY` — your Claude API key

### 3. Set up database

1. Go to your Supabase dashboard → SQL Editor
2. Run the contents of `supabase/migration.sql`
3. Enable Email auth in Authentication → Providers

### 4. Run locally

```bash
npm run dev
```

### 5. Deploy to Vercel

```bash
vercel
```

Add environment variables in Vercel dashboard → Settings → Environment Variables.

## Architecture

```
src/
  app/
    page.tsx          — Main entry (client-rendered)
    layout.tsx        — Root layout with metadata
    globals.css       — Tailwind + custom styles
    api/
      ingest/route.ts — Server-side URL analysis (Claude + web search)
      chat/route.ts   — AI chat per card
  components/
    IngestApp.tsx     — Full app (canvas, list, board, drawer, auth)
  lib/
    supabase.ts       — Supabase client + types
supabase/
  migration.sql       — Database schema
```

## Features

- 🔗 Paste any URL → AI-analyzed intelligence card
- 🌐 Web search powered ingestion for real content
- 🎯 Relevance scoring with staleness detection
- 📋 Canvas, List, and Board views
- 🔗 Shift+Click to create card connections
- 📂 Draggable, renameable categories
- ✦ AI chat per card with web search
- 📋 Paste content for deeper analysis
- 👁 Hide/show cards from canvas
- 🗑 Two-step clear canvas
- 🔐 Email/password authentication
