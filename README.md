# JobHawk

A self-hosted job aggregator that scrapes **LinkedIn**, **StepStone**, and **Xing** simultaneously and presents results in a clean dashboard.

---

## Features

- Scrapes all 3 platforms in parallel
- Filters by job title and location
- Sorts results by posting time (newest first)
- Remembers your LinkedIn session (no re-login every time)
- Real-time progress via Server-Sent Events

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Tailwind CSS + Vite |
| Backend | Node.js + Express + TypeScript |
| Scraping | Puppeteer + puppeteer-extra-plugin-stealth |

---

## Prerequisites

- Node.js 18+
- npm 9+
- A LinkedIn account (for authenticated scraping)

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/mrint01/JobHawk.git
cd JobHawk
```

### 2. Install dependencies

```bash
npm run install:all
```

### 3. Configure environment variables

```bash
# Server
cp server/.env.example server/.env

# Client
cp client/.env.example client/.env
```

The defaults in `server/.env` work for local development — no changes needed to start.

### 4. Run in development

```bash
npm run dev
```

This starts both the frontend (port 5173) and the backend (port 3001) concurrently.

Open [http://localhost:5173](http://localhost:5173)

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend + backend in dev mode |
| `npm run build` | Build both frontend and backend for production |
| `npm run install:all` | Install all dependencies (client + server) |

### Run individually

```bash
# Frontend only
cd client && npm run dev

# Backend only
cd server && npm run dev

# Backend in production mode (after build)
cd server && npm start
```

---

## Environment Variables

### `server/.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Port the API server listens on |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS allowed origins (comma-separated) |
| `PUPPETEER_HEADLESS` | `true` | Set to `false` to watch the browser while scraping |
| `PUPPETEER_SHOW_MOUSE` | `false` | Show a red cursor dot in visible mode |

### `client/.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | _(empty)_ | Backend URL in production. Empty = Vite proxies to localhost:3001 |

---

## LinkedIn Authentication

JobHawk requires a LinkedIn session to scrape job listings.

1. Open the app → go to **Settings**
2. Click **Connect LinkedIn**
3. A browser window opens — log in to your LinkedIn account normally
4. Close the window when done — your session is saved on the server

Your session persists until you disconnect or it expires.

---

## Project Structure

```
JobHawk/
├── client/               # React frontend
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── services/     # API calls + scrapers interface
│   │   └── context/      # React context (auth, jobs)
│   └── vite.config.ts
│
├── server/               # Express backend
│   ├── src/
│   │   ├── scrapers/     # LinkedIn, StepStone, Xing scrapers
│   │   ├── routes/       # API routes (scrape, auth, jobs)
│   │   └── utils/        # Browser, sessions, job store
│   └── tsconfig.json
│
└── package.json          # Root scripts (dev, build, install:all)
```

---

## Notes

- StepStone and Xing are scraped without authentication
- All three platforms scrape in parallel — total time is roughly as long as the slowest one
- Scraped results are stored locally in `server/data/jobs.json` (gitignored)
