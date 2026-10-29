# Server quick start
    cd server && cp .env.example .env   # fill SESSION_SECRET (>=32 chars)
    npm install && npm run dev          # needs MongoDB at MONGO_URI
    npm test                            # api.test.ts downloads a MongoDB binary via mongodb-memory-server
Install dependencies on a normal local disk (not a mount without symlink support).

Endpoints under /api/v1: health, auth/{register,login,logout,me}, games, games/:id/{key,puzzles,complete},
puzzles/:id/verify, users/me/stats, leaderboard.
