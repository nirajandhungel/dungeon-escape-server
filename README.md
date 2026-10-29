# Dungeon Escape — Server

Express + TypeScript REST API for the Dungeon Escape game.

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
| `MAX_ATTEMPTS` | Max wrong puzzle attempts per puzzle |
| `PUZZLE_TTL_S` | Puzzle expiry in seconds |
| `COOLDOWN_S` | Lockout duration after failed attempts |
| `MIN_COMPLETION_S` | Minimum game duration to prevent instant-complete |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Health check |
| `POST` | `/api/v1/auth/register` | Register user |
| `POST` | `/api/v1/auth/login` | Login |
| `POST` | `/api/v1/auth/logout` | Logout |
| `GET` | `/api/v1/auth/me` | Get current user |
| `POST` | `/api/v1/games` | Start new game |
| `POST` | `/api/v1/games/:id/key` | Collect key |
| `POST` | `/api/v1/games/:id/puzzles` | Fetch Banana API puzzle |
| `POST` | `/api/v1/puzzles/:id/verify` | Submit answer |
| `POST` | `/api/v1/games/:id/complete` | Complete game |
| `GET` | `/api/v1/leaderboard` | Global leaderboard |
| `GET` | `/api/v1/puzzle-image` | Image proxy (mixed-content fix) |

## Banana API Integration

Puzzles are fetched **server-side** from `https://marcconrad.com/uob/banana/api.php`.
The solution is stored in MongoDB and **never sent to the client**.
Player answers are verified server-side only.

## Tests

```bash
pnpm test   # vitest — uses in-memory MongoDB
```
