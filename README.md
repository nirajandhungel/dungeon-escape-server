# Dungeon Escape: server
Express + Mongoose API. Talks to the Banana puzzle API, owns accounts (session cookies), puzzle verification, scores and the leaderboard.

    cp .env.example .env     # set SESSION_SECRET (32+ chars); needs MongoDB running at MONGO_URI
    npm install
    npm run dev              # http://localhost:4000
    npm test                 # api tests download a MongoDB binary on first run

See docs/banana-integration.md. The Banana live contract is still unverified until you run the curl in that file.
