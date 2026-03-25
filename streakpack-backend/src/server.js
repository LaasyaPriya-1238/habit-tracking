// src/server.js
// StreakPack — API Server entry point

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const { initSchema, seedData } = require('./db/database');
const { errorHandler }         = require('./middleware/errorHandler');
const habitsRouter             = require('./routes/habits');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS — must be FIRST ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── DATABASE ──────────────────────────────────────────────────────────────────
initSchema();
seedData();

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name:    'StreakPack API',
    version: '1.0.0',
    status:  'running',
    docs:    'See README.md for full endpoint reference.',
    endpoints: {
      habits:   '/api/habits',
      summary:  '/api/habits/summary',
      checkins: '/api/habits/:id/checkins',
      streak:   '/api/habits/:id/streak',
      stats:    '/api/habits/:id/stats',
    },
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.use('/api/habits', habitsRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { message: 'Route not found.' } });
});

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 StreakPack API running on http://localhost:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Database    : ${process.env.DB_PATH  || './streakpack.db'}\n`);
});

module.exports = app;