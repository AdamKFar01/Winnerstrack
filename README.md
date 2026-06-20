# WinnersTrack

A personal productivity tracker I built for daily use. It tracks wins across five life pillars, food and body metrics, goals, finances, calendar events, reminders, and a bucket-list board. Everything runs locally — no accounts, no syncing, no server to maintain. The data stays on your machine in a single SQLite file.

---

## What it is

Full-stack desktop app: Flask REST API backend, SQLite database, vanilla JS frontend, wrapped in Electron so it runs as a native `.app` or `.exe`. The web app and the desktop app are the same code — Electron just starts Flask as a child process and points a `BrowserWindow` at `localhost:5001`.

I chose SQLite because there's one user and no concurrency. I chose vanilla JS because the UI is straightforward enough that a framework would add more ceremony than value. I chose Electron because I wanted a real desktop app without rewriting the frontend in React Native or dealing with a separate native layer.

---

## Architecture

**Backend** — Flask REST API (`app.py`). All data lives in 13 SQLite tables. Schema migrations are handled inline in `init_db()` using `ALTER TABLE` with exception suppression, so launching a new version against an existing database upgrades the schema without data loss. No migration files to run manually.

**Frontend** — Vanilla JS communicating with the Flask API via `fetch()`. No framework, no build step, no transpiler. Charts are rendered with Chart.js. The entire frontend is one HTML file, one CSS file, and one JS file (~2700 lines).

**Desktop packaging** — Electron spawns the Flask process on startup, waits for it to respond on port 5001, then opens a `BrowserWindow` pointed at it. The Flask server and all static files are bundled into the app via `electron-builder`. No changes to the web code were needed to make this work.

**Database** — Single file `wintracker.db`, excluded from git. All state is local. Back it up manually if you care about the data.

---

## Key systems

**XP & Streak Engine**
Users earn XP by logging wins across five life pillars: Physical, Work, Health, Relationships, and Mindset. Each activity is worth a configurable number of points. A "good day" requires 1000+ points *and* all three daily goals completed, which awards a 200 XP bonus on top. Missing a day costs 50 XP; two consecutive misses cost 100 XP. This is enforced by a `/api/xp/daily-check` endpoint called every time the app loads, so the streak state stays accurate even if you forget to open the app for a couple of days.

**Health & Nutrition Tracker**
Logs food by meal (breakfast, lunch, dinner, snacks) with per-item macros (calories, protein, carbs, fat). Aggregates daily totals against configurable targets. Also tracks body metrics (weight, height, body fat) with a running weight chart and weekly nutrition chart.

**Goal & Task System**
Tasks are scoped to today, weekly, or monthly, with XP rewards and priority levels. Goals support sub-conditions via a `goal_conditions` table — each goal can have a checklist of steps that you tick off independently. Separately, there are three "daily Top 3 goals" that must all be marked complete before a day can qualify as perfect.

**Finance Tracker**
Income and expense logging with category tags and a running balance. Includes a monthly overview chart broken down by category.

**Calendar & Reminders**
Calendar events attached to specific dates with importance levels. Reminders with urgency levels, configurable notice windows, and recurring support (daily, weekly, monthly, one-time).

**Yume Board**
A bucket-list and wishlist system. Items are ranked S/A/B/C and organised into custom categories. The name comes from the Japanese 夢 (dream).

---

## API

The main endpoint groups:

- `/api/wins` — log and retrieve daily wins
- `/api/tasks` — task CRUD with period and priority
- `/api/daily-goals` — the three daily completion-gated goals
- `/api/goal-conditions` — sub-steps for goals
- `/api/reminders` — reminders with recurrence and urgency
- `/api/finance` and `/api/finance/monthly` — transactions and monthly rollup
- `/api/calendar-events` and `/api/month-data` — calendar
- `/api/health-metrics`, `/api/food-log`, `/api/weight-log`, `/api/nutrition-week` — health and nutrition
- `/api/xp`, `/api/xp/log`, `/api/xp/daily-check`, `/api/xp/complete-day` — XP engine
- `/api/pillar-scores` — radar chart scores
- `/api/week-data` — weekly bar chart data
- `/api/activities` — activity presets per pillar
- `/api/recipes` — saved recipes
- `/api/yume/categories`, `/api/yume/items` — bucket-list board

---

## Setup

**Web only (no Electron):**
```bash
pip install -r requirements.txt
python3 app.py
# opens at http://localhost:5001
```

Or just:
```bash
./start.sh
```

**Desktop app (Electron):**
```bash
npm install
npm start          # dev mode
npm run build      # builds WinnersTrack.app / .exe into dist/
```

The packaged app bundles the Flask server, all Python source, and the frontend. Python 3 must be installed on the target machine — it is not bundled.

**Database:**
`wintracker.db` is created automatically on first run. It is excluded from git. To back it up, just copy the file.

---

## Data location

When running packaged via Electron, the database is stored in the OS user data directory:
- macOS: `~/Library/Application Support/winnerstrackbuilder/wintracker.db`
- Windows: `%APPDATA%\winnerstrackbuilder\wintracker.db`

When running as a plain web app, it is created next to `app.py`.
