/**
 * Server entrypoint — event-driven startup
 *
 * Uses an async IIFE so top-level await failures are caught and logged
 * with a human-readable message instead of a raw stack trace.
 *
 * INTEROPERABILITY NOTE:
 * MongoDB Atlas requires the connection string to include the cluster
 * hostname. This is read from MONGO_URI in .env (never committed to git).
 *
 * If the database is unreachable, the process exits with code 1 after
 * printing a clear diagnostic — so process managers (pm2, Docker) can
 * restart with back-off rather than looping silently.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createBananaClient } from './integrations/banana/banana.client.js';

(async () => {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    console.error(JSON.stringify({
      level: 'fatal',
      msg: 'Invalid configuration — check your .env file',
      detail: err instanceof Error ? err.message : String(err),
    }));
    process.exit(1);
  }

  try {
    await mongoose.connect(cfg.MONGO_URI, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
    });
    console.log(JSON.stringify({ level: 'info', msg: 'MongoDB connected' }));
  } catch (err) {
    console.error(JSON.stringify({
      level: 'fatal',
      msg: 'MongoDB connection failed',
      uri: cfg.MONGO_URI.replace(/:\/\/[^@]+@/, '://***@'), // mask credentials
      hint: 'Check MONGO_URI in .env — for Atlas ensure IP is whitelisted at cloud.mongodb.com',
      detail: err instanceof Error ? err.message : String(err),
    }));
    process.exit(1);
  }

  const app = createApp(cfg, createBananaClient({ baseUrl: cfg.BANANA_URL }));
  app.listen(cfg.PORT, () =>
    console.log(JSON.stringify({ level: 'info', msg: `API listening on :${cfg.PORT}`, env: cfg.NODE_ENV })));

  // Graceful shutdown — close MongoDB on SIGTERM/SIGINT (Docker, pm2, Ctrl-C)
  const shutdown = async (signal: string) => {
    console.log(JSON.stringify({ level: 'info', msg: `${signal} received — shutting down` }));
    await mongoose.disconnect();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT',  () => void shutdown('SIGINT'));
})();
