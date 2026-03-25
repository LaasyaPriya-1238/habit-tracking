// src/db/database.js
// Initializes the SQLite database, creates all tables, and seeds demo data.

const Database = require('better-sqlite3');
const path     = require('path');
require('dotenv').config();

const DB_PATH = path.resolve(process.env.DB_PATH || './streakpack.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');   // faster concurrent reads
    db.pragma('foreign_keys = ON');    // enforce FK constraints
  }
  return db;
}

// ── SCHEMA ────────────────────────────────────────────────────────────────────
function initSchema() {
  const db = getDb();

  db.exec(`
    -- Users (minimal — no auth in this scope)
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_initials TEXT NOT NULL DEFAULT 'U',
      xp          INTEGER NOT NULL DEFAULT 0,
      level       INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Habits
    CREATE TABLE IF NOT EXISTS habits (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'Custom',
      icon        TEXT NOT NULL DEFAULT '⭐',
      type        TEXT NOT NULL CHECK(type IN ('competitive','individual')) DEFAULT 'individual',
      duration_min INTEGER NOT NULL DEFAULT 30,
      proof_method TEXT NOT NULL DEFAULT 'none',
      penalty_type TEXT NOT NULL DEFAULT 'points' CHECK(penalty_type IN ('points','charity')),
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Daily check-ins (one row per habit per calendar day)
    CREATE TABLE IF NOT EXISTS checkins (
      id          TEXT PRIMARY KEY,
      habit_id    TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      checked_date TEXT NOT NULL,          -- YYYY-MM-DD
      status      TEXT NOT NULL CHECK(status IN ('done','cheat','missed')) DEFAULT 'done',
      xp_earned   INTEGER NOT NULL DEFAULT 0,
      note        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(habit_id, checked_date)       -- one check-in per habit per day
    );

    -- Streak cache (updated whenever a check-in is created/updated)
    CREATE TABLE IF NOT EXISTS streaks (
      habit_id         TEXT PRIMARY KEY REFERENCES habits(id) ON DELETE CASCADE,
      current_streak   INTEGER NOT NULL DEFAULT 0,
      longest_streak   INTEGER NOT NULL DEFAULT 0,
      last_checked_date TEXT,
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ── SEED DATA ─────────────────────────────────────────────────────────────────
function seedData() {
  const db = getDb();

  const alreadySeeded = db.prepare("SELECT COUNT(*) as c FROM users").get().c > 0;
  if (alreadySeeded) return;

  const insertUser = db.prepare(`
    INSERT INTO users (id, username, display_name, avatar_initials, xp, level)
    VALUES (@id, @username, @display_name, @avatar_initials, @xp, @level)
  `);

  const insertHabit = db.prepare(`
    INSERT INTO habits (id, user_id, name, category, icon, type, duration_min, proof_method, penalty_type)
    VALUES (@id, @user_id, @name, @category, @icon, @type, @duration_min, @proof_method, @penalty_type)
  `);

  const insertStreak = db.prepare(`
    INSERT INTO streaks (habit_id, current_streak, longest_streak, last_checked_date)
    VALUES (@habit_id, @current_streak, @longest_streak, @last_checked_date)
  `);

  const insertCheckin = db.prepare(`
    INSERT OR IGNORE INTO checkins (id, habit_id, user_id, checked_date, status, xp_earned)
    VALUES (@id, @habit_id, @user_id, @checked_date, @status, @xp_earned)
  `);

  const seedAll = db.transaction(() => {
    // Demo user: Arjun
    insertUser.run({ id: 'user-arjun', username: 'arjun_k', display_name: 'Arjun K', avatar_initials: 'AK', xp: 2760, level: 4 });

    // Demo habits
    const habits = [
      { id:'habit-dsa',      user_id:'user-arjun', name:'DSA Practice',         category:'Coding',   icon:'💻', type:'competitive', duration_min:60,  proof_method:'screenshot', penalty_type:'points'  },
      { id:'habit-run',      user_id:'user-arjun', name:'Morning Run',           category:'Fitness',  icon:'🏃', type:'competitive', duration_min:30,  proof_method:'gps',        penalty_type:'charity' },
      { id:'habit-read',     user_id:'user-arjun', name:'Read 30 Pages',         category:'Study',    icon:'📚', type:'competitive', duration_min:30,  proof_method:'photo',      penalty_type:'points'  },
      { id:'habit-guitar',   user_id:'user-arjun', name:'Guitar Practice',       category:'Music',    icon:'🎸', type:'individual',  duration_min:20,  proof_method:'none',       penalty_type:'points'  },
      { id:'habit-sketch',   user_id:'user-arjun', name:'Sketch / Illustration', category:'Art',      icon:'🎨', type:'individual',  duration_min:15,  proof_method:'none',       penalty_type:'points'  },
      { id:'habit-meditate', user_id:'user-arjun', name:'Meditation',            category:'Wellness', icon:'🧘', type:'individual',  duration_min:10,  proof_method:'timer',      penalty_type:'points'  },
    ];
    habits.forEach(h => insertHabit.run(h));

    // Seed 14 days of check-ins for DSA / Run / Read (streak habits)
    const today = new Date();
    for (let d = 13; d >= 0; d--) {
      const date = new Date(today);
      date.setDate(today.getDate() - d);
      const dateStr = date.toISOString().split('T')[0];
      const idx = 13 - d; // 0..13

      [
        { habitId: 'habit-dsa',    status: idx === 10 ? 'cheat' : 'done', xp: idx === 10 ? 15 : 30 },
        { habitId: 'habit-run',    status: 'done', xp: 30 },
        { habitId: 'habit-read',   status: idx === 12 ? 'done' : 'done', xp: 28 },
      ].forEach(({ habitId, status, xp }) => {
        insertCheckin.run({ id: `${habitId}-${dateStr}`, habit_id: habitId, user_id: 'user-arjun', checked_date: dateStr, status, xp_earned: xp });
      });
    }

    // Seed partial streaks for guitar/sketch/meditation
    const partialStreaks = [
      { habitId: 'habit-guitar',   days: 9 },
      { habitId: 'habit-sketch',   days: 6 },
      { habitId: 'habit-meditate', days: 3 },
    ];
    partialStreaks.forEach(({ habitId, days }) => {
      for (let d = days - 1; d >= 0; d--) {
        const date = new Date(today);
        date.setDate(today.getDate() - d);
        const dateStr = date.toISOString().split('T')[0];
        insertCheckin.run({ id: `${habitId}-${dateStr}`, habit_id: habitId, user_id: 'user-arjun', checked_date: dateStr, status: 'done', xp_earned: 20 });
      }
    });

    // Streaks cache
    [
      { habit_id:'habit-dsa',      current_streak:14, longest_streak:14, last_checked_date: today.toISOString().split('T')[0] },
      { habit_id:'habit-run',      current_streak:14, longest_streak:14, last_checked_date: today.toISOString().split('T')[0] },
      { habit_id:'habit-read',     current_streak:14, longest_streak:14, last_checked_date: today.toISOString().split('T')[0] },
      { habit_id:'habit-guitar',   current_streak:9,  longest_streak:9,  last_checked_date: today.toISOString().split('T')[0] },
      { habit_id:'habit-sketch',   current_streak:6,  longest_streak:6,  last_checked_date: today.toISOString().split('T')[0] },
      { habit_id:'habit-meditate', current_streak:3,  longest_streak:5,  last_checked_date: today.toISOString().split('T')[0] },
    ].forEach(s => insertStreak.run(s));
  });

  seedAll();
  console.log('✅ Database seeded with demo data.');
}

module.exports = { getDb, initSchema, seedData };
