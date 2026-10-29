# Server quick start
    cd dungeon-escape-server && cp .env.example .env   # fill SESSION_SECRET (>=32 chars)
    npm install && npm run dev                         # needs MongoDB at MONGO_URI
    npm test                                           # api.test.ts downloads a MongoDB binary via mongodb-memory-server
    BANANA_LIVE=1 npx vitest run test/banana.live.test.ts   # optional: hit the real Banana API
Install dependencies on a normal local disk (not a mount without symlink support).

Endpoints under /api/v1: health, auth/{register,login,logout,me}, games, games/current, games/:id,
games/:id/{key,puzzles,advance,complete}, puzzles/:id/{image,verify}, users/me/stats, users/me/cape, leaderboard.
A run = chapters of doors; each door needs its own key and Banana puzzle (CHAPTER_DOORS, default 2,2,3,3,3 = 13 puzzles).
See ../README.md for the full table and banana-integration.md for the verified provider contract.
