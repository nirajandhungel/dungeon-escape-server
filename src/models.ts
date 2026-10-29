import { Schema, model, type InferSchemaType } from 'mongoose';

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  displayName: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
}, { timestamps: true });

const gameSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['IN_PROGRESS', 'DOOR_UNLOCKED', 'COMPLETED'], default: 'IN_PROGRESS' },
  keyCollectedAt: Date,
  startedAt: { type: Date, default: Date.now },
  completedAt: Date,
  wrongAttempts: { type: Number, default: 0 },
  lockedUntil: Date,
  score: Number,
  durationMs: Number,
});
gameSchema.index({ status: 1, score: -1, durationMs: 1 });

const puzzleSchema = new Schema({
  game: { type: Schema.Types.ObjectId, ref: 'Game', required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  imageUrl: { type: String, required: true },
  solution: { type: Number, required: true, select: false }, // never leaves the server
  attempts: { type: Number, default: 0 },
  status: { type: String, enum: ['ACTIVE', 'SOLVED', 'FAILED', 'EXPIRED'], default: 'ACTIVE' },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
export const Game = model('Game', gameSchema);
export const Puzzle = model('Puzzle', puzzleSchema);
