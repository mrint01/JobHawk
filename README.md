# JobHawk

JobHawk is a self-hosted job search and application-tracking app.
It scrapes multiple job platforms, merges results into one dashboard, and helps users track progress from new offer to final outcome.

## What the project currently does

- Aggregates job listings from `LinkedIn`, `StepStone`, `Xing`, `Indeed`, and `Jobriver`
- Supports per-platform selection and search by job title + location
- Streams scrape progress in real time through Server-Sent Events
- Stores jobs per user and supports status transitions through an interview pipeline
- Provides analytics views (time series, platforms, cities, and admin all-users views)
- Includes login, multi-user support, and admin-only pages
- Supports LinkedIn Agent integration for session-aware LinkedIn scraping

## Main features

- **Unified dashboard**: view, filter, and manage all scraped jobs in one place
- **Interview pipeline tracking**: statuses include `new`, `applied`, `hr_interview`, `technical_interview`, `second_technical_interview`, `refused`, and `accepted`
- **Platform connection settings**:
  - `LinkedIn`, `StepStone`, `Xing`: manual or headless credential connect
  - `Indeed`, `Jobriver`: opt-in platform toggles (public listings)
- **User analytics**:
  - Job activity series over time
  - Breakdown by city and platform
  - Admin-only aggregate analytics across users

## Tech stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Recharts
- **Backend**: Node.js, Express, TypeScript, WebSocket (`ws`)
- **Scraping/automation**: Puppeteer, Playwright, Cheerio
- **Storage/auth support**: Supabase integration for user/session data

## Prerequisites

- Node.js 18+
- npm 9+
- Supabase project (URL + service role key)

## Quick start

### 1) Install dependencies

```bash
npm run install:all
```

### 2) Configure environment

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Edit `server/.env` and set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional server settings:

- `AUTH_MANUAL_CONNECT=true` for visible manual login windows
- `AUTH_MANUAL_CONNECT=false` for headless credential login flow
- `PUPPETEER_HEADLESS` and `PUPPETEER_SHOW_MOUSE` for scraper browser behavior

### 3) Run development mode

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001`

## Scripts

### Root

- `npm run dev` - run client and server concurrently
- `npm run build` - build client and server
- `npm run install:all` - install dependencies for both apps

### Client (`client/`)

- `npm run dev` - start Vite dev server
- `npm run build` - type-check and build frontend
- `npm run preview` - preview built frontend

### Server (`server/`)

- `npm run dev` - run API with `tsx watch`
- `npm run build` - compile TypeScript to `dist`
- `npm start` - run compiled server
- `npm run playwright:install` - install Playwright browsers
- `npm run playwright:deps` - install OS dependencies required by Playwright browsers
- `npm run playwright:setup` - install both OS deps and browsers

## Environment variables

### `server/.env`

- `PORT` (default `3001`)
- `ALLOWED_ORIGINS` (default `http://localhost:5173`, comma-separated)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUPPETEER_HEADLESS`
- `PUPPETEER_SHOW_MOUSE`
- `AUTH_MANUAL_CONNECT`

### `client/.env`

- `VITE_API_URL` (set this in production; keep empty in local dev to use Vite proxy)

## High-level architecture

- `client/`: app shell, dashboard, settings, analytics, admin, interview pipeline
- `server/src/routes/`:
  - `auth.ts` for platform connect/disconnect and auth mode handling
  - `scrape.ts` for platform scraping and SSE stream endpoint
  - `jobs.ts` for job CRUD/status and analytics APIs
  - `users.ts` for user-related endpoints
- `server/src/scrapers/`: platform-specific scrapers
- `server/src/utils/`: browser/session/user/job stores and LinkedIn agent hub

## Notes

- LinkedIn scraping depends on an active LinkedIn Agent/session.
- The server exposes health and debug endpoints for runtime checks.
- A Python script (`server/scripts/linkedin_agent.py`) is provided for agent-based LinkedIn session handling.

## Production note (Indeed WebKit)

If Indeed fails with `libgstreamer-1.0.so.0` / `browserType.launch` errors, your server image is missing Linux shared libraries required by Playwright WebKit.

Run this in `server/` during deploy (before starting the API):

```bash
npm run playwright:setup
```

Important:

- Use a Debian/Ubuntu-based runtime image/VM for WebKit scraping.
- If your CI/CD uses `npm ci --ignore-scripts`, `postinstall` is skipped, so you must run `npm run playwright:setup` explicitly.

### Railway (no terminal access)

For Railway + Playwright WebKit, deploy with Docker only.

1. Set **Root Directory** to `server` (deploy API only; client stays separate).
2. Builder **Dockerfile**, **Dockerfile path** `Dockerfile` (this resolves to `server/Dockerfile` when root is `server`).
3. Redeploy.

The image base is `mcr.microsoft.com/playwright:v1.59.1-jammy`, which includes the Linux shared libraries WebKit needs (`libgstreamer`, GTK, etc.).
