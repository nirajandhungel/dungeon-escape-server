import 'dotenv/config';
import mongoose from 'mongoose';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createBananaClient } from './integrations/banana/banana.client.js';

const cfg = loadConfig();
await mongoose.connect(cfg.MONGO_URI);
createApp(cfg, createBananaClient({ baseUrl: cfg.BANANA_URL })).listen(cfg.PORT, () =>
  console.log(JSON.stringify({ level: 'info', msg: `API listening on :${cfg.PORT}` })));
