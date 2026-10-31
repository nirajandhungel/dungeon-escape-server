# 🎓 Dungeon Escape — CIS046-3 Viva Preparation Guide

> **Unit:** CIS046-3 Software For Enterprise  
> **Assignment:** 1 — Video/Viva (60 %)  
> **Deadline:** 04 December 2026 | Feedback: 24 December 2026  
> **Stack:** TypeScript (Node.js / Express back-end · React / Vite front-end) · MongoDB · Banana API

---

## Table of Contents

1. [Project Overview & Architecture](#1-project-overview--architecture)
2. [Theme 1 — Version Control & Code Organisation](#2-theme-1--version-control--code-organisation)
3. [Theme 2 — Event-Driven Programming](#3-theme-2--event-driven-programming)
4. [Theme 3 — Interoperability & Distributed Architecture](#4-theme-3--interoperability--distributed-architecture)
5. [Theme 4 — Virtual Identity & Security](#5-theme-4--virtual-identity--security)
6. [Testing Evidence](#6-testing-evidence)
7. [Quick Reference — Files at a Glance](#7-quick-reference--files-at-a-glance)
8. [Viva Q&A Cheat Sheet](#8-viva-qa-cheat-sheet)

---

## 1. Project Overview & Architecture

**Dungeon Escape** is a full-stack web game built around the [Banana API](https://marcconrad.com/uob/banana/doc.php).  
The player navigates a 3-D dungeon, collects golden keys, and must solve a Banana puzzle (identify a digit hidden in an image) to break each door's seal.

```
Browser (React / Vite)              Server (Express / Node)              External
─────────────────────               ────────────────────────              ─────────
  pages/                            src/
    Home.tsx                          index.ts           <- entry
    Auth.tsx                          app.ts             <- Express factory
    Play.tsx  ---HTTP JSON--->          config/index.ts   <- validated env
    Dashboard.tsx                       models/index.ts   <- Mongoose schemas
  game/                               middleware/
    engine.ts   <- rules                requireAuth.ts
    levels.ts   <- layouts              errorHandler.ts
    input.ts    <- keyboard           controllers/
  services/                             auth.controller.ts
    api.service.ts  <- fetch             games.controller.ts
    events.service.ts <- bus             leaderboard.controller.ts
    audio.service.ts  <- SFX          routes/
  contexts/                             auth.routes.ts
    AuthContext.tsx                      games.routes.ts
  store/                                index.ts          <- /api/v1
    settings.store.ts                 services/
  hooks/                                rewards.service.ts
    useServerHealth.ts                integrations/
  components/  (HUD, Modal…)           banana/
  scene/       (Three.js)               banana.client.ts  --HTTPS--> Banana API
                                        banana.schemas.ts
```

### Repository root layout

```
dungeon-escape/
├── client/                       <- React / Vite front-end
│   └── src/
│       ├── main.tsx                 React entry point
│       ├── App.tsx                  Routes, navigation shell
│       ├── styles.css               Global CSS
│       │
│       ├── services/                Network + event services
│       │   ├── api.service.ts       All fetch() calls — single HTTP boundary
│       │   ├── events.service.ts    Typed Pub/Sub bus (TypedEmitter)
│       │   └── audio.service.ts     Web Audio synthesiser
│       │
│       ├── contexts/                React contexts
│       │   └── AuthContext.tsx      Session state, user identity, server health
│       │
│       ├── store/                   Global application state
│       │   └── settings.store.ts    Sound, graphics, reduced-motion preferences
│       │
│       ├── hooks/                   Reusable React hooks
│       │   └── useServerHealth.ts   Server liveness polling
│       │
│       ├── game/                    Rendering-free game engine + tests
│       │   ├── engine.ts            GameEngine class, Phase FSM, collision, HP
│       │   ├── engine.test.ts       Unit tests — no browser needed
│       │   ├── levels.ts            Deterministic dungeon generation
│       │   ├── levels.test.ts       Seed-reproducibility tests
│       │   ├── input.ts             Keyboard + virtual D-pad
│       │   └── rng.ts               Seeded PRNG
│       │
│       ├── pages/                   Route-level screens
│       │   ├── Home.tsx
│       │   ├── Auth.tsx
│       │   ├── Play.tsx             Main game screen — event consumer
│       │   └── Dashboard.tsx        Stats, achievements, capes
│       │
│       ├── components/              Reusable UI widgets
│       │   ├── BananaChallengeModal.tsx
│       │   ├── HUD.tsx
│       │   ├── Dialog.tsx
│       │   ├── Feedback.tsx
│       │   ├── SettingsPanel.tsx
│       │   ├── TouchControls.tsx
│       │   ├── CapePicker.tsx
│       │   ├── ServerOfflineBanner.tsx
│       │   └── icons.tsx
│       │
│       └── scene/                   Three.js / R3F 3-D rendering
│           ├── GameScene.tsx
│           ├── Actors.tsx
│           ├── Environment.tsx
│           ├── Effects.tsx
│           ├── MenuBackdrop.tsx
│           ├── assets.ts
│           ├── context.ts
│           └── support.ts
│
├── server/                       <- Express / Node back-end
│   ├── src/
│   │   ├── index.ts                Entry point (connect DB, listen)
│   │   ├── app.ts                  Express factory (middleware, routes, error handler)
│   │   ├── errors.ts               HttpError class
│   │   │
│   │   ├── config/
│   │   │   └── index.ts            Zod-validated environment variables
│   │   │
│   │   ├── models/
│   │   │   └── index.ts            Mongoose schemas: User, Game, Puzzle
│   │   │
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts      Session guard — rejects unauthenticated requests
│   │   │   └── errorHandler.ts     Converts HttpError / ZodError to JSON responses
│   │   │
│   │   ├── controllers/
│   │   │   ├── auth.controller.ts        register, login, logout, me
│   │   │   ├── games.controller.ts       full game lifecycle (buildGameHandlers factory)
│   │   │   └── leaderboard.controller.ts leaderboard aggregate query
│   │   │
│   │   ├── routes/
│   │   │   ├── auth.routes.ts      POST /register  POST /login  GET /me
│   │   │   ├── games.routes.ts     /games  /puzzles  /users
│   │   │   └── index.ts            Mounts all routers under /api/v1
│   │   │
│   │   ├── services/
│   │   │   └── rewards.service.ts  scoreRun, ACHIEVEMENTS, CAPES, playerTotals
│   │   │
│   │   └── integrations/
│   │       └── banana/
│   │           ├── banana.client.ts   Fetches & validates Banana puzzles
│   │           └── banana.schemas.ts  Zod contract for external API
│   │
│   └── test/
│       ├── api.test.ts              Vitest + Supertest integration tests
│       ├── banana.client.test.ts    Banana client unit tests
│       ├── banana.live.test.ts      Optional live network test (skipped by default)
│       └── rewards.test.ts          Pure scoring and achievement tests
│
└── VIVA_GUIDE.md                 <- this file
```

---

## 2. Theme 1 — Version Control & Code Organisation

### 2.1 What to say

> "I structured the project as a **monorepo** with two independent packages — `client` (React/Vite) and `server` (Express). Each uses a proper MVC-inspired layered structure. I used Git throughout, with feature branches and tagged releases."

### 2.2 Server-side layers

| Layer | Folder | Responsibility |
|-------|--------|---------------|
| **Entry** | `src/index.ts` | Connects MongoDB, creates app, starts HTTP server, graceful shutdown |
| **App factory** | `src/app.ts` | Express middleware chain, route mounting, error handler |
| **Configuration** | `src/config/index.ts` | Zod-validated env vars — one place for all settings |
| **Models** | `src/models/index.ts` | Mongoose schemas for User, Game, Puzzle |
| **Middleware** | `src/middleware/` | `requireAuth` session guard · `errorHandler` JSON error responses |
| **Controllers** | `src/controllers/` | Request handlers — auth, game lifecycle, leaderboard |
| **Routes** | `src/routes/` | Express Routers — wire URLs to controllers |
| **Services** | `src/services/rewards.service.ts` | Pure business logic — scoring, achievements |
| **Integrations** | `src/integrations/banana/` | External Banana API client (isolated from the rest) |
| **Errors** | `src/errors.ts` | Shared `HttpError` class |

### 2.3 Client-side layers

| Layer | Folder | Responsibility |
|-------|--------|---------------|
| **Pages** | `pages/` | Route-level screens (Home, Auth, Play, Dashboard) |
| **Components** | `components/` | Reusable UI widgets (HUD, Modal, icons…) |
| **Services** | `services/` | Network (api.service), events (events.service), audio (audio.service) |
| **Contexts** | `contexts/` | `AuthContext` — session state and user identity |
| **Store** | `store/` | `settings.store` — localStorage-backed user preferences |
| **Hooks** | `hooks/` | `useServerHealth` — server liveness polling |
| **Game** | `game/` | Rendering-free engine + tests (no browser APIs) |
| **Scene** | `scene/` | Three.js / React-Three-Fiber 3-D rendering |

### 2.4 Separation of Concerns — key examples

**Back-end: `server/src/controllers/games.controller.ts`**
```typescript
// The publicPuzzle projection is the ONLY place that decides
// what reaches the browser. Neither the solution nor the image bytes
// ever appear in the JSON response.
const publicPuzzle = (p) => ({
  id: p.id, imageUrl: `/api/v1/puzzles/${p.id}/image`,
  expiresAt: p.expiresAt,
  attemptsRemaining: Math.max(0, p.maxAttempts - p.attempts),
  maxAttempts: p.maxAttempts,
});
```

**Front-end: `client/src/services/api.service.ts`**
```typescript
// No component calls fetch() directly.
// A contract change is one file, one fix.
// credentials:'include' sends the HttpOnly session cookie —
// the browser never stores an explicit token.
```

### 2.5 Single Responsibility

- `services/rewards.service.ts` — **no I/O** — pure functions, tested in isolation.
- `game/engine.ts` — **no WebGL, no React** — pure TypeScript, unit-tested in `engine.test.ts`.
- `integrations/banana/banana.client.ts` — exactly one job: fetch and validate one puzzle. Its `PuzzleProvider` interface lets tests inject a mock.

### 2.6 Git workflow to mention

```bash
git checkout -b feature/virtual-identity
git checkout -b feature/interoperability
git checkout -b feature/event-driven-audio

git commit -m "feat: add Argon2 hashing and session regeneration"
git commit -m "feat: implement typed Pub/Sub event bus"
git commit -m "feat: Banana API client with timeout, magic-byte sniff and Zod schema"
git commit -m "refactor: split flat files into controllers/routes/services/middleware"

git tag -a v1.0 -m "Core game release — all four themes implemented"
```

---

## 3. Theme 2 — Event-Driven Programming

### 3.1 What to say

> "The client is built around a **typed Pub/Sub event bus** in `services/events.service.ts`. The game engine is the main publisher — it emits events when gameplay rules fire. The React UI, the audio system, and the server-sync logic are all independent subscribers. No publisher knows who is listening."

### 3.2 The event bus — `client/src/services/events.service.ts`

```typescript
export interface GameEvents {
  'key:collected':      number;        // key index
  'player:step':        undefined;
  'player:damaged':     number;        // HP remaining
  'interact:available': number | null;
  'door:locked':        undefined;
  'door:touched':       number;        // triggers Banana challenge modal
  'door:unlocked':      number;
  'puzzle:solved':      undefined;
  'puzzle:dismissed':   undefined;
  'game:paused':        undefined;
  'game:resumed':       undefined;
  'level:cleared':      number;
  'game:won':           undefined;
  'game:dead':          undefined;
}
```

`TypedEmitter<E>` (lines 40–54) implements Pub/Sub:
- **`on(event, fn)`** — subscribes, returns an **unsubscribe function** (no memory leaks).
- **`emit(event, payload)`** — notifies all current subscribers.

### 3.3 Publishers

| Publisher | File | Events emitted |
|-----------|------|----------------|
| `GameEngine` | `game/engine.ts` | All gameplay events |
| `Play.tsx` | `pages/Play.tsx` | `puzzle:solved` / `puzzle:dismissed` after server confirms |

**Engine emitting `door:touched`** (engine.ts, `interact()` method):
```typescript
this.emit('door:touched', doorIndex);
this.phase = 'CHALLENGE';
```

### 3.4 Subscribers

#### A — React UI (`pages/Play.tsx` lines 168–212)

```typescript
const off = [
  bus.on('key:collected', (i) => {
    flash('You took a golden key');
    keySync.current.set(i, api.collectKey(id, i)...); // -> POST /games/:id/key
  }),
  bus.on('door:touched', (door) => { setChallenge(door); }),   // opens BananaChallengeModal
  bus.on('door:unlocked', (door) => { setChallenge(null); }),  // closes modal
  bus.on('level:cleared', (lvl) => { setScreen('cleared'); void advance(); }),
  bus.on('game:won',  () => { void api.complete(id).then(setWon); }),
  bus.on('game:dead', () => setScreen('dead')),
];
return () => off.forEach(f => f());  // cleanup on unmount
```

#### B — Audio system (`services/audio.service.ts`)

```typescript
export function attachAudio(bus: GameBus): () => void {
  const off = [
    bus.on('player:step',    sfx.step),
    bus.on('key:collected',  sfx.key),
    bus.on('player:damaged', (hp) => hp > 0 ? sfx.hurt() : undefined),
    bus.on('door:locked',    sfx.bump),
    bus.on('door:unlocked',  sfx.open),
    bus.on('level:cleared',  sfx.cleared),
    bus.on('game:dead',      sfx.dead),
  ];
  return () => off.forEach(f => f());
}
```

`audio.service.ts` uses the **Web Audio API** (`AudioContext`, `OscillatorNode`, `GainNode`). All sounds are synthesised in code — no audio files are loaded.

### 3.5 Keyboard input — `game/input.ts`

```typescript
window.addEventListener('keydown', down);   // fills a Set of held keys
window.addEventListener('keyup',   up);
window.addEventListener('blur',    clear);  // hero never gets stuck
document.addEventListener('visibilitychange', vis); // alt-tab = stop moving
```

- WASD / Arrow keys → movement vector polled each frame.
- `E / Enter / Space` → `engine.interact()` → emits `door:touched`.
- **Text-field safety**: events from `input`, `textarea`, `select` are ignored — typing the Banana answer never moves the hero.

### 3.6 Auto-pause on tab-hide (`pages/Play.tsx`)

```typescript
const onHide = () => {
  if (document.hidden && engineRef.current?.phase === 'PLAYING')
    engineRef.current.togglePause();
};
document.addEventListener('visibilitychange', onHide);
```

### 3.7 AbortController (`components/BananaChallengeModal.tsx` lines 54–60)

```typescript
const fetchPuzzle = useCallback(async () => {
  inflight.current?.abort();              // cancel any stale in-flight request
  const ctl = new AbortController();
  inflight.current = ctl;
  // ... api.requestPuzzle(gameId, ctl.signal)
```

### 3.8 Why Pub/Sub?

> "If completing a puzzle had to directly call score-update, modal-close, and sound-effect, those concerns would be tightly coupled. With Pub/Sub the engine just emits `door:unlocked`; the UI, audio, and server-sync each subscribe independently. Adding a particle burst later requires zero changes to the engine."

---

## 4. Theme 3 — Interoperability & Distributed Architecture

### 4.1 What to say

> "The game demonstrates **two-way API participation**: it **consumes** the external Banana API and it **provides** its own REST/JSON API to any third-party client."

### 4.2 Consuming the Banana API

#### Where the call is made — `server/src/integrations/banana/banana.client.ts`

```typescript
const url = `${baseUrl}?out=json&base64=yes`;
res = await fetchImpl(url, {
  signal: AbortSignal.timeout(timeoutMs),  // 5-second timeout
  headers: { accept: 'application/json' },
});
```

**Why `base64=yes`?**  
Without it, the `question` field is a URL ending in `n<DIGIT>` — the last digit *is* the answer. Passing it to the browser leaks the solution. With `base64=yes` the server gets raw image bytes, stores them in MongoDB, and serves through an owner-checked route.

#### Validation — `banana.schemas.ts`

```typescript
export const bananaResponseSchema = z.object({
  question: z.string().min(1),           // base64 image
  solution: z.coerce.number().int().min(0).max(9),
});
```

#### Image safety — `banana.client.ts`

```typescript
// Magic-byte sniffing — never trust the declared Content-Type
function sniff(b: Buffer): string | null {
  if (b.subarray(0,8).equals(PNG_MAGIC))  return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8)     return 'image/jpeg';
  if (b.subarray(0,4).toString() === 'GIF8') return 'image/gif';
  return null;
}
// MAX_IMAGE_BYTES = 2 MB
if (image.length > MAX_IMAGE_BYTES) throw new UpstreamError('Banana image too large');
```

#### End-to-end puzzle flow

```
Browser                      Server (Express)              Banana API
  |                               |                            |
  | POST /games/:id/puzzles       |                            |
  |------------------------------>|                            |
  |                               | GET api.php?out=json&base64=yes
  |                               |----------------------------->|
  |                               |<-- { question, solution } ---|
  |                               | store image+solution in MongoDB
  |                               | return { id, imageUrl, expiresAt, attemptsRemaining }
  |<------------------------------|
  |                               |
  | GET /puzzles/:id/image        |
  |------------------------------>| owner-check: session userId == puzzle.user
  |<--- image bytes (private) ----|
  |                               |
  | POST /puzzles/:id/verify      |
  | { answer: 4 }                 |
  |------------------------------>| compare with stored solution — digit NEVER leaves server
  |<--- { correct: true } --------|
```

#### Error handling — `controllers/games.controller.ts`

```typescript
try {
  upstream = await provider.fetchPuzzle();
} catch (err) {
  if (err instanceof UpstreamError)
    throw new HttpError(502, 'puzzle_service_unavailable', 'Puzzle service unavailable, try again');
  throw err;
}
```

The `PuzzleProvider` interface is injected at startup (`index.ts`):
```typescript
const app = createApp(cfg, createBananaClient({ baseUrl: cfg.BANANA_URL }));
```
Tests inject a mock — the application code never changes.

### 4.3 Providing a REST/JSON API — `routes/index.ts`

All endpoints live under `/api/v1`:

| Method | Path | Controller | Description |
|--------|------|-----------|-------------|
| GET | `/api/v1/health` | routes/index.ts | Liveness check |
| POST | `/api/v1/auth/register` | auth.controller | Create account |
| POST | `/api/v1/auth/login` | auth.controller | Authenticate |
| POST | `/api/v1/auth/logout` | auth.controller | Destroy session |
| GET | `/api/v1/auth/me` | auth.controller | Current identity |
| POST | `/api/v1/games` | games.controller | Start a new run |
| GET | `/api/v1/games/current` | games.controller | Resume last run |
| GET | `/api/v1/games/:id` | games.controller | Fetch run state |
| POST | `/api/v1/games/:id/key` | games.controller | Collect a key |
| POST | `/api/v1/games/:id/puzzles` | games.controller | Request a puzzle |
| GET | `/api/v1/puzzles/:id/image` | games.controller | Serve puzzle image |
| POST | `/api/v1/puzzles/:id/verify` | games.controller | Submit answer |
| POST | `/api/v1/games/:id/advance` | games.controller | Next chapter |
| POST | `/api/v1/games/:id/complete` | games.controller | Complete campaign |
| GET | `/api/v1/users/me/stats` | games.controller | Player statistics |
| PUT | `/api/v1/users/me/cape` | games.controller | Equip cape |
| GET | `/api/v1/leaderboard` | leaderboard.controller | Public rankings (JSON) |

**A mobile app or third-party site can consume `GET /api/v1/leaderboard` without touching the front-end at all** — this is interoperability.

### 4.4 Client HTTP layer — `services/api.service.ts`

```typescript
async function request<T>(method, path, body?, signal?): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',  // sends HttpOnly session cookie
    signal,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error, data.message);
  return data as T;
}
```

### 4.5 Configuration — `config/index.ts`

```typescript
BANANA_URL:   z.string().url().default('https://marcconrad.com/uob/banana/api.php'),
MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
PUZZLE_TTL_S: z.coerce.number().int().positive().default(300),
COOLDOWN_S:   z.coerce.number().int().nonnegative().default(30),
```

All external service URLs and limits are Zod-validated at startup — misconfiguration causes an immediate, human-readable exit.

### 4.6 REST vs SOAP

> "I chose REST + JSON because TypeScript/JavaScript parses JSON natively. SOAP uses XML and requires a WSDL contract — it is more formal and suited to large enterprise systems with strict inter-organisation contracts. For this project REST is lighter and works natively in the browser."

---

## 5. Theme 4 — Virtual Identity & Security

### 5.1 What to say

> "A player's virtual identity is their account (email + display name), their Argon2 password hash, their server-side session in MongoDB, and their persistent game stats. The server enforces every permission check — the browser only sees what it is allowed to see."

### 5.2 Password hashing — `controllers/auth.controller.ts`

```typescript
import argon2 from 'argon2';

// Registration:
passwordHash: await argon2.hash(input.password)
// Argon2id by default: memory-hard, GPU-resistant — better than bcrypt.

// Login:
const ok = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, input.password);
// DUMMY_HASH ensures timing is constant even when the email is unknown.
// Response time reveals nothing about which emails are registered.
```

### 5.3 Session management — `middleware/requireAuth.ts` + `app.ts`

```typescript
// Cookie configured in app.ts:
cookie: {
  httpOnly: true,   // JavaScript cannot read it
  secure: prod,     // HTTPS-only in production
  sameSite: 'lax',  // CSRF defence in depth
  maxAge: 2 * 60 * 60 * 1000,  // 2-hour idle timeout
}

// Session REGENERATION on login (auth.controller.ts) — defeats session fixation:
req.session.regenerate((err) => {
  req.session.userId = userId;
  req.session.createdAt = Date.now();
});

// Absolute lifetime guard (requireAuth.ts):
if (!userId || !createdAt || Date.now() - createdAt > 24 * 60 * 60 * 1000)
  return req.session.destroy(() => next(new HttpError(401, ...)));
```

Sessions are stored in MongoDB via `connect-mongo` — they survive server restarts.

### 5.4 CSRF defence — `app.ts`

```typescript
app.use((req, _res, next) => {
  const origin = req.get('origin');
  if (req.method !== 'GET' && origin && origin !== cfg.CLIENT_ORIGIN)
    return next(new HttpError(403, 'bad_origin', 'Origin not allowed'));
  next();
});
```

Three layers:
1. `SameSite: 'lax'` — browser doesn't send cookie on cross-site POST.
2. JSON-only bodies — rejects HTML form submissions from foreign origins.
3. Origin header check on every state-changing request.

### 5.5 Authorisation — `controllers/games.controller.ts`

```typescript
// Owner query: a different userId yields 404, not 403 (no existence leak)
const ownedGame = async (id, userId) => {
  const game = await Game.findOne({ _id: oid(id), user: userId });
  if (!game) throw new HttpError(404, 'not_found', 'Game not found');
  return game;
};
```

```typescript
// requireAuth (middleware/requireAuth.ts) guards all /games and /puzzles routes:
export const requireAuth: RequestHandler = (req, _res, next) => {
  const { userId, createdAt } = req.session;
  if (!userId || !createdAt || Date.now() - createdAt > ABSOLUTE_SESSION_MS)
    return req.session.destroy(() => next(new HttpError(401, ...)));
  next();
};
```

### 5.6 Input validation — Zod throughout

```typescript
// Registration (auth.controller.ts):
const registration = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(128),
  displayName: z.string().trim().min(2).max(32),
});

// Answer submission (games.controller.ts):
const { answer } = z.object({ answer: z.number().int().min(0).max(9) })
  .strict()  // rejects extra fields — no parameter pollution
  .parse(req.body);
```

ZodErrors → `400 Bad Request` via `middleware/errorHandler.ts`.

### 5.7 Rate limiting — `controllers/auth.controller.ts`

```typescript
export function buildLoginLimiter(cfg: Config) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: cfg.NODE_ENV === 'test' ? 1000 : 10,  // 10 attempts / 15 min in prod
    standardHeaders: true, legacyHeaders: false,
  });
}
```

### 5.8 What the browser never sees

- `passwordHash` — `select: false` in `models/index.ts`
- `solution` — `select: false` in `models/index.ts`
- `publicGame` and `publicPuzzle` projections in `games.controller.ts` are explicit allow-lists

```typescript
// models/index.ts:
passwordHash: { type: String, required: true, select: false },
solution:     { type: Number, required: true, select: false },
```

### 5.9 Helmet security headers — `app.ts`

```typescript
app.use(helmet());
// Sets: Content-Security-Policy, X-Content-Type-Options, X-Frame-Options,
//       Strict-Transport-Security, Referrer-Policy, etc.
```

### 5.10 Sessions vs JWT vs OAuth

> "**Server-side sessions** suit this app: they are instantly revocable, the server trusts its own store, and the browser holds only an opaque cookie ID. **JWTs** are stateless — good for microservices or mobile clients where servers can't share session state, but revocation before expiry needs a blacklist. **OAuth/OpenID Connect** delegates credential management to Google/GitHub — useful when you don't want to handle passwords at all."

---

## 6. Testing Evidence

### 6.1 Server integration tests — `server/test/api.test.ts`

```bash
cd server && pnpm test
```

| Test area | What is verified |
|-----------|-----------------|
| Auth | Registration, login, wrong-password rejected, rate-limit |
| Session | `requireAuth` blocks unauthenticated requests (401) |
| CSRF | Cross-origin POST returns 403 |
| Puzzle lifecycle | Key → puzzle → correct answer → door opens |
| Attempt limit | 3 wrong answers triggers cooldown |
| Upstream failure | `UpstreamError` in provider → HTTP 502 |
| Idempotency | Re-requesting a live puzzle returns the same one |
| Ownership | Player A cannot access Player B's game (404, not 403) |
| Scoring | `scoreRun()` computed server-side at completion |
| Leaderboard | JSON array with expected fields |

**Mock provider** (injected via `createApp` — no network calls in tests):
```typescript
const provider: PuzzleProvider = {
  fetchPuzzle: async () => {
    if (upstreamFailures-- > 0) throw new UpstreamError('down');
    return { image: PNG, contentType: 'image/png', solution: SOLUTION };
  },
};
```

### 6.2 Banana client unit test — `test/banana.client.test.ts`

- Valid response → image + solution returned.
- Non-JSON body → `UpstreamError`.
- HTTP 500 → `UpstreamError`.
- Timeout → `UpstreamError`.
- Magic-byte rejection, oversized image.

### 6.3 Game engine unit tests — `client/src/game/engine.test.ts`

- Movement, collision, HP, key/door state machine.
- Pure TypeScript — no browser, no WebGL, no network.

### 6.4 Level generation tests — `client/src/game/levels.test.ts`

- Same seed always produces the same dungeon.
- All rooms connected, correct number of keys/doors/spawn-points.

### 6.5 Rewards unit tests — `server/test/rewards.test.ts`

- `scoreRun()` time/mistake/first-try formula verified.
- Achievement thresholds verified.
- Cape unlock predicates verified.

---

## 7. Quick Reference — Files at a Glance

```
server/src/
  index.ts                     entry, MongoDB connect, graceful shutdown
  app.ts                       Express factory, helmet, CORS, session, CSRF, routes
  errors.ts                    HttpError class
  config/
    index.ts                   Zod env schema — BANANA_URL, limits, session config
  models/
    index.ts                   User / Game / Puzzle Mongoose schemas (select:false)
  middleware/
    requireAuth.ts             Session guard, ABSOLUTE_SESSION_MS, session.destroy()
    errorHandler.ts            ZodError -> 400, HttpError -> status, unknown -> 500
  controllers/
    auth.controller.ts         Argon2 hash, DUMMY_HASH, session.regenerate(), rateLimit
    games.controller.ts        buildGameHandlers factory, publicGame/publicPuzzle, ownedGame
    leaderboard.controller.ts  MongoDB aggregate, pagination
  routes/
    auth.routes.ts             POST /register  POST /login  POST /logout  GET /me
    games.routes.ts            /games  /puzzles  /users
    index.ts                   /api/v1 barrel — health, leaderboard, auth, games
  services/
    rewards.service.ts         scoreRun(), ACHIEVEMENTS[], CAPES[], playerTotals()
  integrations/banana/
    banana.client.ts           fetch, AbortSignal.timeout, magic-byte sniff, UpstreamError
    banana.schemas.ts          bananaResponseSchema (Zod), ProviderPuzzle

client/src/
  main.tsx                     React root, Providers
  App.tsx                      BrowserRouter, routes, Nav, Shell, Protected
  styles.css                   Global CSS
  services/
    api.service.ts             request<T>(), all API calls, ApiError, domain DTOs
    events.service.ts          GameEvents interface, TypedEmitter, GameBus type
    audio.service.ts           attachAudio(bus), sfx.*, Web Audio synthesis
  contexts/
    AuthContext.tsx             AuthContext, AuthProvider, useAuth(), server health
  store/
    settings.store.ts          getSettings(), updateSettings(), useSettings(), useReducedMotion()
  hooks/
    useServerHealth.ts         server liveness polling
  game/
    engine.ts                  GameEngine, Phase FSM, collision, HP, event emitter
    engine.test.ts             unit tests — no browser
    levels.ts                  generateLevel(seed, level, doors), CHAPTERS[]
    levels.test.ts             deterministic / connectivity tests
    input.ts                   InputController, keydown/keyup, text-field safety
    rng.ts                     seeded PRNG
  pages/
    Home.tsx                   landing, leaderboard widget
    Auth.tsx                   register / login forms
    Play.tsx                   game screen, event bus subscriptions, timer, modal trigger
    Dashboard.tsx              stats, achievements, cape picker
  components/
    BananaChallengeModal.tsx   puzzle request, AbortController, countdown, verify
    HUD.tsx                    HP, key/door indicators, timer
    Dialog.tsx                 accessible modal wrapper
    Feedback.tsx               loading/error screens
    SettingsPanel.tsx          volume/sound/graphics toggle
    TouchControls.tsx          virtual D-pad for mobile
    CapePicker.tsx             cosmetic selector
    ServerOfflineBanner.tsx    degraded-mode indicator
    icons.tsx                  inline SVG
  scene/
    GameScene.tsx, Actors.tsx, Environment.tsx, Effects.tsx
    MenuBackdrop.tsx, assets.ts, context.ts, support.ts

server/test/
  api.test.ts                  Vitest + Supertest, in-memory MongoDB, mock provider
  banana.client.test.ts        isolated HTTP client tests
  banana.live.test.ts          optional live test (skipped by default)
  rewards.test.ts              pure scoreRun/achievements/capes tests
```

---

## 8. Viva Q&A Cheat Sheet

| Question | Short answer + where to point |
|----------|-------------------------------|
| **Where does the Banana API get called?** | `server/src/integrations/banana/banana.client.ts`. The browser never contacts the external API. |
| **Why does the browser never see the solution?** | `solution` is `select:false` in `models/index.ts`; `publicPuzzle` in `games.controller.ts` never includes it. |
| **How are passwords stored?** | Argon2id hash — `controllers/auth.controller.ts`. Never plain-text, never reversible. |
| **What prevents session fixation?** | `req.session.regenerate()` called immediately after login — `auth.controller.ts`. |
| **How is CSRF prevented?** | Three layers: `SameSite:lax` cookie + JSON-only bodies + origin header check in `app.ts`. |
| **What is the event bus?** | `TypedEmitter` in `services/events.service.ts` — custom typed Pub/Sub. Engine emits; UI/audio/server-sync subscribe independently. |
| **How does audio work?** | Web Audio API in `services/audio.service.ts` — synthesised tones, no audio files. Subscribed to the event bus. |
| **What happens when Banana API is down?** | `UpstreamError` from `banana.client.ts` → caught in `games.controller.ts` → HTTP 502. Client shows retry. |
| **Why TypeScript, not PHP?** | Shared types between client and server, compile-time safety, Node.js ecosystem. PHP is the example language — any mainstream language is allowed. |
| **How is the leaderboard an API?** | `GET /api/v1/leaderboard` returns a JSON array. Any third-party app can consume it. |
| **What is the PuzzleProvider interface for?** | Dependency injection — tests inject a mock without touching application code. |
| **What does `select:false` do in Mongoose?** | Excludes the field from all query results by default — last line of defence if a developer forgets to filter. |
| **How does scoring work?** | `scoreRun()` in `services/rewards.service.ts` — computed server-side at completion, never accepted from the client. |
| **What are achievements?** | Pure predicates in `rewards.service.ts` computed from the player's lifetime `Totals` — nothing extra stored in the DB. |
| **What is the game seed for?** | Issued by the server at run-start. The client uses it to deterministically generate dungeon layouts — resuming always rebuilds the exact same dungeon. |
| **Why a monorepo?** | Shared TypeScript config, single `pnpm` workspace install, easy cross-package type sharing without publishing to npm. |
| **Why controllers/routes split?** | Routes handle URL-to-handler mapping; controllers hold business logic. This separation makes testing controllers without an HTTP layer straightforward. |

---

> **Good luck tomorrow!** 🎮  
> *Demo tip: start a live run, solve a Banana puzzle, then open the Network tab and show the `/puzzles/:id/image` and `/verify` requests — that's interoperability + security in one 30-second demo.*
