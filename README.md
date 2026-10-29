# Dungeon Escape — Server

Express + TypeScript REST API for the Dungeon Escape game.

## The game model

A **run** is a campaign of **chapters** (dungeons). Each chapter has several sealed **doors**; every door needs its own **key**
(collected in that room) **and its own Banana puzzle**. The default `CHAPTER_DOORS=2,2,3,3,3` is 5 chapters, 13 doors and
**13 Banana puzzles per run**. Each run gets a server-issued `seed` (the client builds that run's layouts from it) and a
`difficulty` (`normal` | `hard`). Finishing a run pays out a score, a rank, relics, achievements and cape cosmetics; **Hard unlocks
after the first completed run**. All state changes are atomic and filter-guarded, so replays and concurrent requests cannot
double-count a door or skip one.

## Stack
- **Express 5** — HTTP server
- **MongoDB / Mongoose** — persistence (local or Atlas)
- **express-session + connect-mongo** — HTTP-only session auth
- **argon2** — password hashing
- **Banana API** — external puzzle service integration
- **Zod** — runtime validation

## Setup

```bash
cp .env.example .env
# Edit .env — add your MONGO_URI and SESSION_SECRET
pnpm install
pnpm run dev      # tsx watch — auto-restarts on change
```

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default 4000) |
| `MONGO_URI` | MongoDB connection string (local or Atlas) |
| `SESSION_SECRET` | ≥32-char random secret for session signing |
| `CLIENT_ORIGIN` | CORS allowed origin |
| `BANANA_URL` | Banana API base URL |
| `MAX_ATTEMPTS` | Wrong answers allowed per puzzle on Normal (default 3) |
| `HARD_MAX_ATTEMPTS` | Wrong answers allowed per puzzle on Hard (default 2) |
| `PUZZLE_TTL_S` | Puzzle expiry in seconds |
| `COOLDOWN_S` | Lockout duration after failed attempts |
| `MIN_COMPLETION_S` | Minimum game duration to prevent instant-complete |
| `CHAPTER_DOORS` | Doors per chapter, comma list: 1-5 chapters of 1-4 doors (default `2,2,3,3,3` = 13 doors / 13 puzzles) |
| `RESUME_WINDOW_S` | How long an unfinished run stays resumable after its last activity (default 1800) |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Health check |
| `POST` | `/api/v1/auth/register` | Register user |
| `POST` | `/api/v1/auth/login` | Login |
| `POST` | `/api/v1/auth/logout` | Logout |
| `GET` | `/api/v1/auth/me` | Get current user |
| `POST` | `/api/v1/games` | Start a run. Body `{ "difficulty"?: "normal" \| "hard" }`. Abandons the previous live run. `403 hard_locked` until one run is completed |
| `GET` | `/api/v1/games/current` | Resumable run: `200` game, or `204` if none / stale |
| `GET` | `/api/v1/games/:id` | Read own game |
| `POST` | `/api/v1/games/:id/key` | Collect a door's key. Body `{ "index": n }`. Only for the next unopened door (`409` otherwise); idempotent for keys already held |
| `POST` | `/api/v1/games/:id/puzzles` | Get the live Banana puzzle for the current door (needs its key; creates one if needed; `502` if the provider is down) |
| `GET` | `/api/v1/puzzles/:id/image` | Puzzle image, owner only, while the puzzle is active (`401`/`404`/`410`) |
| `POST` | `/api/v1/puzzles/:id/verify` | Submit answer `{ "answer": 0-9 }` → opens that door when correct |
| `POST` | `/api/v1/games/:id/advance` | Next chapter, once **every** door of this one is open (single-use) |
| `POST` | `/api/v1/games/:id/complete` | Finish the run (final chapter only, single-use): server computes score, rank and rewards |
| `GET` | `/api/v1/users/me/stats` | Totals, achievements, all capes (with `unlocked`), selected cape, `hardUnlocked`, recent runs |
| `PUT` | `/api/v1/users/me/cape` | Equip a cape `{ "cape": id }` (`403 cape_locked`, `400` unknown) |
| `GET` | `/api/v1/leaderboard` | Best run per player: `{ displayName, score, durationMs, rank, difficulty }` |

### Response shapes

```jsonc
// game (publicGame)
{ "id", "status": "IN_PROGRESS|DOOR_UNLOCKED|COMPLETED|ABANDONED", "level", "levelCount", "doorsInLevel",
  "keysCollected", "doorsOpened", "doorsTotal", "doorsOpenedTotal", "seed", "difficulty", "startedAt",
  "wrongAttempts", "lockedUntil": null, "score": null, "rank": null, "relics" }
// DOOR_UNLOCKED = every door of the current chapter is open.  relics = chapters cleared (levelCount once completed)

// POST /puzzles/:id/verify
{ "correct": true, "doorsOpened": 1, "doorsInLevel": 2, "chapterUnlocked": false }   |   { "correct": false, "attemptsRemaining": 1 }

// POST /games/:id/complete
{ ...game, "durationMs", "rewards": { "score", "rank", "relics",
    "newAchievements": [{ "id", "title", "description" }], "newCapes": [{ "id", "name", "color" }] } }

// GET /users/me/stats
{ "completed", "runs", "totalScore", "bestScore", "bestTimeMs", "puzzlesSolved", "relicsTotal", "levelsCleared",
  "achievements": [{ "id", "title", "description" }], "capes": [{ "id", "name", "color", "unlocked" }],
  "cape": "crimson", "hardUnlocked": false, "recent": [ game, ... ] }
```

## Scoring, rank and rewards (computed only on the server)

`base = max(500, 8000 − 3·seconds − 120·wrongAttempts)` · `bonus = 150 · firstTryDoors` · `score = round((base + bonus) × (hard ? 1.5 : 1))`

| Rank | Needs (score before the Hard multiplier) |
|---|---|
| S | ≥ 8000 |
| A | ≥ 6000 |
| B | ≥ 4000 |
| C | below 4000 |

Normal allows `MAX_ATTEMPTS` (3) wrong answers per puzzle, Hard `HARD_MAX_ATTEMPTS` (2); the last wrong answer locks the door
puzzle for `COOLDOWN_S`. Relics = chapters cleared.

| Achievement | Earned by |
|---|---|
| `first-escape` | complete 1 run |
| `flawless` | complete a run with 0 wrong answers |
| `speed-runner` | complete a run in under 12 minutes |
| `oracle-friend` | solve 25 Banana puzzles across all runs |
| `veteran` | complete 3 runs |
| `hard-won` | complete a run on Hard |
| `relic-hunter` | collect 10 relics across all runs |
| `rank-s` | finish a run with rank S |

| Cape | Colour | Unlocked by |
|---|---|---|
| `crimson` Crimson | `#8a2a2a` | always |
| `gold` Gilded | `#d6a84f` | `first-escape` |
| `emerald` Emerald | `#2f9e6e` | `flawless` |
| `azure` Azure | `#3a6fd8` | `veteran` |
| `violet` Violet | `#7a4fd6` | `hard-won` |
| `ember` Ember | `#e0702a` | `relic-hunter` |
| `ivory` Ivory | `#e8e2d0` | `rank-s` |
| `obsidian` Obsidian | `#23252e` | `oracle-friend` |

Achievements and capes are derived from the player's runs on demand (no extra collection); `complete` reports only those
unlocked by that completion.

## Banana API Integration

Puzzles are fetched **server-side** from `https://marcconrad.com/uob/banana/api.php?out=json&base64=yes`.
The solution and the image bytes are stored in MongoDB (`select: false`); the solution is **never sent to the client**, and the
image is served only to its owner through `GET /api/v1/puzzles/:id/image`. We use `base64=yes` because with `base64=no` the image
filename encodes the answer (see `docs/banana-integration.md`). Player answers are verified server-side only. Every door of a run issues its own puzzle (`Puzzle.door`) with its own attempt budget.

## Tests

```bash
npm test                                                   # vitest: API (campaign, doors, rewards, capes), Banana client, pure reward rules; in-memory MongoDB, provider stubbed
BANANA_LIVE=1 npx vitest run test/banana.live.test.ts      # opt-in: real Banana API
```
