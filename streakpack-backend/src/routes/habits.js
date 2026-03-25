// src/routes/habits.js
// All Habits API routes.
//
// Base path: /api/habits  (mounted in server.js)
//
// ┌─────────────────────────────────────────────────────┐
// │  Habits                                             │
// │  GET    /api/habits                 List habits     │
// │  POST   /api/habits                 Create habit    │
// │  GET    /api/habits/:id             Get one habit   │
// │  PATCH  /api/habits/:id             Update habit    │
// │  DELETE /api/habits/:id             Soft-delete     │
// │                                                     │
// │  Check-ins                                          │
// │  GET    /api/habits/:id/checkins    List check-ins  │
// │  POST   /api/habits/:id/checkins    Log check-in    │
// │  DELETE /api/habits/:id/checkins/:date  Remove day  │
// │                                                     │
// │  Stats                                              │
// │  GET    /api/habits/:id/streak      Streak info     │
// │  GET    /api/habits/:id/stats       Full stats      │
// │  GET    /api/habits/summary         Today summary   │
// └─────────────────────────────────────────────────────┘

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb }      = require('../db/database');
const { recalcStreak, todayStr } = require('../db/streakHelper');
const { asyncWrap, httpError }   = require('../middleware/errorHandler');
const { validateHabitBody, validateCheckinBody } = require('../middleware/validate');

const router = express.Router();

// ── HELPERS ───────────────────────────────────────────────────────────────────

/** Return the habit or throw 404 */
function findHabit(db, id) {
  const habit = db.prepare('SELECT * FROM habits WHERE id = ? AND is_active = 1').get(id);
  if (!habit) throw httpError(404, `Habit with id "${id}" not found.`);
  return habit;
}

/** Map a DB habit row → clean API response shape */
function habitToDTO(habit, streak = null) {
  return {
    id:           habit.id,
    name:         habit.name,
    category:     habit.category,
    icon:         habit.icon,
    type:         habit.type,
    duration_min: habit.duration_min,
    proof_method: habit.proof_method,
    penalty_type: habit.penalty_type,
    created_at:   habit.created_at,
    ...(streak && {
      streak: {
        current: streak.current_streak,
        longest: streak.longest_streak,
        last_checked: streak.last_checked_date,
      }
    }),
  };
}

/** XP awarded per check-in status */
const XP_MAP = { done: 30, cheat: 15, missed: 0 };

// ── ROUTES ────────────────────────────────────────────────────────────────────

// ── GET /api/habits
// List all active habits for a user, with their current streaks.
// Query params: ?user_id=  (defaults to demo user)
router.get('/', asyncWrap(async (req, res) => {
  const db     = getDb();
  const userId = req.query.user_id || 'user-arjun';
  const today  = todayStr();

  const habits = db.prepare(`
    SELECT h.*,
           s.current_streak,
           s.longest_streak,
           s.last_checked_date,
           c.status AS today_status
    FROM   habits h
    LEFT JOIN streaks  s ON s.habit_id   = h.id
    LEFT JOIN checkins c ON c.habit_id   = h.id AND c.checked_date = ?
    WHERE  h.user_id  = ? AND h.is_active = 1
    ORDER  BY h.created_at ASC
  `).all(today, userId);

  res.json({
    success: true,
    data: habits.map(h => ({
      ...habitToDTO(h, h),
      today_status: h.today_status || null,
    })),
    meta: { total: habits.length, date: today },
  });
}));

// ── POST /api/habits
// Create a new habit.
// Body: { name, category?, icon?, type?, duration_min?, proof_method?, penalty_type? }
router.post('/', validateHabitBody, asyncWrap(async (req, res) => {
  const db     = getDb();
  const userId = req.body.user_id || 'user-arjun';

  // Derive icon from category if not provided
  const CATEGORY_ICONS = {
    Coding:'💻', Fitness:'🏃', Study:'📚', Music:'🎸',
    Art:'🎨', Dance:'💃', Wellness:'🧘', Custom:'⭐',
  };
  const category = req.body.category || 'Custom';
  const icon     = req.body.icon     || CATEGORY_ICONS[category] || '⭐';

  const habit = {
    id:           uuidv4(),
    user_id:      userId,
    name:         req.body.name.trim(),
    category,
    icon,
    type:         req.body.type         || 'individual',
    duration_min: req.body.duration_min || 30,
    proof_method: req.body.proof_method || 'none',
    penalty_type: req.body.penalty_type || 'points',
  };

  db.prepare(`
    INSERT INTO habits (id, user_id, name, category, icon, type, duration_min, proof_method, penalty_type)
    VALUES (@id, @user_id, @name, @category, @icon, @type, @duration_min, @proof_method, @penalty_type)
  `).run(habit);

  // Initialise streak row
  db.prepare(`
    INSERT INTO streaks (habit_id, current_streak, longest_streak)
    VALUES (?, 0, 0)
  `).run(habit.id);

  const created = db.prepare('SELECT * FROM habits WHERE id = ?').get(habit.id);
  res.status(201).json({ success: true, data: habitToDTO(created) });
}));

// ── GET /api/habits/summary
// Today's summary: how many done vs total, XP earned today.
// Query params: ?user_id=
router.get('/summary', asyncWrap(async (req, res) => {
  const db     = getDb();
  const userId = req.query.user_id || 'user-arjun';
  const today  = todayStr();

  const habits  = db.prepare("SELECT id FROM habits WHERE user_id = ? AND is_active = 1").all(userId);
  const total   = habits.length;
  const checkins = db.prepare(`
    SELECT status, SUM(xp_earned) as xp
    FROM   checkins
    WHERE  user_id = ? AND checked_date = ?
    GROUP  BY status
  `).all(userId, today);

  const doneRow  = checkins.find(r => r.status === 'done')  || { xp: 0 };
  const cheatRow = checkins.find(r => r.status === 'cheat') || { xp: 0 };
  const doneCount = db.prepare(`
    SELECT COUNT(*) as c FROM checkins
    WHERE user_id = ? AND checked_date = ? AND status IN ('done','cheat')
  `).get(userId, today).c;

  res.json({
    success: true,
    data: {
      date:        today,
      total_habits: total,
      done_count:  doneCount,
      pending_count: total - doneCount,
      completion_pct: total ? Math.round((doneCount / total) * 100) : 0,
      xp_today:    (doneRow.xp || 0) + (cheatRow.xp || 0),
    },
  });
}));

// ── GET /api/habits/:id
// Fetch a single habit with its streak.
router.get('/:id', asyncWrap(async (req, res) => {
  const db    = getDb();
  const habit = findHabit(db, req.params.id);
  const streak = db.prepare('SELECT * FROM streaks WHERE habit_id = ?').get(habit.id);
  res.json({ success: true, data: habitToDTO(habit, streak) });
}));

// ── PATCH /api/habits/:id
// Update habit fields (partial update — only send what you want to change).
router.patch('/:id', validateHabitBody, asyncWrap(async (req, res) => {
  const db    = getDb();
  const habit = findHabit(db, req.params.id);

  const allowed = ['name','category','icon','type','duration_min','proof_method','penalty_type'];
  const updates = {};
  allowed.forEach(key => {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  });

  if (Object.keys(updates).length === 0) {
    throw httpError(400, 'No valid fields provided to update.');
  }

  const setClauses = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE habits SET ${setClauses} WHERE id = @id`)
    .run({ ...updates, id: habit.id });

  const updated = db.prepare('SELECT * FROM habits WHERE id = ?').get(habit.id);
  const streak  = db.prepare('SELECT * FROM streaks WHERE habit_id = ?').get(habit.id);
  res.json({ success: true, data: habitToDTO(updated, streak) });
}));

// ── DELETE /api/habits/:id
// Soft-delete (sets is_active = 0). Preserves history.
router.delete('/:id', asyncWrap(async (req, res) => {
  const db    = getDb();
  findHabit(db, req.params.id);   // throws 404 if not found
  db.prepare('UPDATE habits SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Habit deleted successfully.' });
}));

// ══════════════════════════════════════════════════════════════════════════════
//  CHECK-INS
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/habits/:id/checkins
// List check-ins for a habit.
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=30
router.get('/:id/checkins', asyncWrap(async (req, res) => {
  const db    = getDb();
  const habit = findHabit(db, req.params.id);

  const limit  = Math.min(parseInt(req.query.limit) || 30, 365);
  const from   = req.query.from || (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; })();
  const to     = req.query.to   || todayStr();

  const rows = db.prepare(`
    SELECT id, checked_date, status, xp_earned, note, created_at
    FROM   checkins
    WHERE  habit_id = ? AND checked_date BETWEEN ? AND ?
    ORDER  BY checked_date DESC
    LIMIT  ?
  `).all(habit.id, from, to, limit);

  res.json({
    success: true,
    data: rows,
    meta: { habit_id: habit.id, from, to, total: rows.length },
  });
}));

// ── POST /api/habits/:id/checkins
// Log or update a check-in for a specific date.
// Body: { checked_date: "YYYY-MM-DD", status?: "done"|"cheat"|"missed", note?: string }
router.post('/:id/checkins', validateCheckinBody, asyncWrap(async (req, res) => {
  const db    = getDb();
  const habit = findHabit(db, req.params.id);

  const { checked_date, status = 'done', note = null } = req.body;
  const xp_earned = XP_MAP[status] ?? 30;
  const userId    = req.body.user_id || habit.user_id;

  // Upsert — if user re-submits same date, update it
  db.prepare(`
    INSERT INTO checkins (id, habit_id, user_id, checked_date, status, xp_earned, note)
    VALUES (@id, @habit_id, @user_id, @checked_date, @status, @xp_earned, @note)
    ON CONFLICT(habit_id, checked_date) DO UPDATE SET
      status     = excluded.status,
      xp_earned  = excluded.xp_earned,
      note       = excluded.note,
      created_at = datetime('now')
  `).run({ id: uuidv4(), habit_id: habit.id, user_id: userId, checked_date, status, xp_earned, note });

  // Update streak
  const streak = recalcStreak(habit.id);

  // Update user XP (add earned, remove old xp if overwriting — simplified: just add delta)
  if (status === 'done' || status === 'cheat') {
    db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(xp_earned, userId);
  }

  const checkin = db.prepare('SELECT * FROM checkins WHERE habit_id = ? AND checked_date = ?').get(habit.id, checked_date);

  res.status(201).json({
    success: true,
    data: {
      checkin: { id: checkin.id, habit_id: habit.id, checked_date, status, xp_earned, note },
      streak:  { current: streak.current_streak, longest: streak.longest_streak },
      message: status === 'done'  ? `✅ "${habit.name}" marked done! +${xp_earned} XP`
             : status === 'cheat' ? `⭐ Cheat day used for "${habit.name}". +${xp_earned} XP`
             : `❌ Missed day logged for "${habit.name}".`,
    },
  });
}));

// ── DELETE /api/habits/:id/checkins/:date
// Remove a check-in for a specific date (undo).
router.delete('/:id/checkins/:date', asyncWrap(async (req, res) => {
  const db    = getDb();
  const habit = findHabit(db, req.params.id);
  const { date } = req.params;

  const row = db.prepare('SELECT * FROM checkins WHERE habit_id = ? AND checked_date = ?').get(habit.id, date);
  if (!row) throw httpError(404, `No check-in found for date "${date}".`);

  db.prepare('DELETE FROM checkins WHERE habit_id = ? AND checked_date = ?').run(habit.id, date);

  // Reverse XP
  if (row.xp_earned > 0) {
    db.prepare('UPDATE users SET xp = MAX(0, xp - ?) WHERE id = ?').run(row.xp_earned, habit.user_id);
  }

  const streak = recalcStreak(habit.id);

  res.json({
    success: true,
    message: `Check-in for ${date} removed.`,
    streak:  { current: streak.current_streak, longest: streak.longest_streak },
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
//  STATS
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/habits/:id/streak
// Quick streak lookup.
router.get('/:id/streak', asyncWrap(async (req, res) => {
  const db    = getDb();
  const habit = findHabit(db, req.params.id);
  const streak = recalcStreak(habit.id);

  res.json({
    success: true,
    data: {
      habit_id:       habit.id,
      habit_name:     habit.name,
      current_streak: streak.current_streak,
      longest_streak: streak.longest_streak,
    },
  });
}));

// ── GET /api/habits/:id/stats
// Detailed stats: completion %, total XP, daily breakdown.
// Query: ?days=30
router.get('/:id/stats', asyncWrap(async (req, res) => {
  const db    = getDb();
  const habit = findHabit(db, req.params.id);
  const days  = Math.min(parseInt(req.query.days) || 14, 365);

  const from = (() => { const d = new Date(); d.setDate(d.getDate() - (days - 1)); return d.toISOString().split('T')[0]; })();
  const to   = todayStr();

  const checkins = db.prepare(`
    SELECT checked_date, status, xp_earned
    FROM   checkins
    WHERE  habit_id = ? AND checked_date BETWEEN ? AND ?
    ORDER  BY checked_date ASC
  `).all(habit.id, from, to);

  const totalDays   = days;
  const doneCount   = checkins.filter(c => c.status === 'done').length;
  const cheatCount  = checkins.filter(c => c.status === 'cheat').length;
  const missedCount = checkins.filter(c => c.status === 'missed').length;
  const totalXP     = checkins.reduce((sum, c) => sum + c.xp_earned, 0);
  const completionPct = Math.round(((doneCount + cheatCount) / totalDays) * 100);

  const streak = db.prepare('SELECT * FROM streaks WHERE habit_id = ?').get(habit.id);

  res.json({
    success: true,
    data: {
      habit: habitToDTO(habit, streak),
      period:   { from, to, days },
      summary: {
        total_days:      totalDays,
        done_days:       doneCount,
        cheat_days:      cheatCount,
        missed_days:     missedCount,
        pending_days:    totalDays - doneCount - cheatCount - missedCount,
        completion_pct:  completionPct,
        total_xp:        totalXP,
      },
      streak: {
        current: streak?.current_streak || 0,
        longest: streak?.longest_streak || 0,
      },
      daily: checkins,   // full day-by-day breakdown
    },
  });
}));

module.exports = router;
