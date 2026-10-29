import { Schema, model, type InferSchemaType } from 'mongoose';

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  displayName: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  cape: { type: String, default: 'crimson' },   // cosmetic; must be an unlocked cape id (see rewards.ts)
}, { timestamps: true });

const gameSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['IN_PROGRESS', 'DOOR_UNLOCKED', 'COMPLETED', 'ABANDONED'], default: 'IN_PROGRESS' },
  level: { type: Number, default: 0 },          // chapter index
  seed: { type: Number, required: true },       // issued by the server; the client builds this run's layouts from it
  difficulty: { type: String, enum: ['normal', 'hard'], default: 'normal' },
  keysCollected: { type: Number, default: 0 },  // in the current chapter
  doorsOpened: { type: Number, default: 0 },    // in the current chapter
  doorsOpenedTotal: { type: Number, default: 0 },
  puzzlesSolved: { type: Number, default: 0 },
  firstTryDoors: { type: Number, default: 0 },  // doors whose puzzle was solved on the first attempt
  rank: { type: String, enum: ['S', 'A', 'B', 'C'] },
  startedAt: { type: Date, default: Date.now },
  completedAt: Date,
  wrongAttempts: { type: Number, default: 0 },
  lockedUntil: Date,
  score: Number,
  durationMs: Number,
}, { timestamps: true });
gameSchema.index({ status: 1, score: -1, durationMs: 1 });

const puzzleSchema = new Schema({
  game: { type: Schema.Types.ObjectId, ref: 'Game', required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  image: { type: Buffer, required: true, select: false },     // served only by the owner-checked image route
  imageType: { type: String, required: true },
  solution: { type: Number, required: true, select: false }, // never leaves the server
  door: { type: Number, required: true },       // door index (within the chapter) this puzzle was issued for
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, required: true }, // fixed at creation from the run's difficulty
  status: { type: String, enum: ['ACTIVE', 'SOLVED', 'FAILED', 'EXPIRED'], default: 'ACTIVE' },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
// Purge stale puzzles (and their stored answers) one hour after expiry.
puzzleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
export const Game = model('Game', gameSchema);
export const Puzzle = model('Puzzle', puzzleSchema);
