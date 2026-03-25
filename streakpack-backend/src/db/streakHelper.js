// src/db/streakHelper.js
// Recalculates and updates the streak for a given habit after any check-in change.

const { getDb } = require('./database');

/**
 * Recalculates the current streak for a habit by walking backwards from today
 * through consecutive 'done' or 'cheat' check-ins.
 *
 * Rules:
 *  - 'done'  → counts as a completed day (streak continues)
 *  - 'cheat' → counts as a completed day (streak continues)
 *  - 'missed'/ absent → streak resets to 0
 *
 * @param {string} habitId
 * @returns {{ current_streak: number, longest_streak: number }}
 */
function recalcStreak(habitId) {
  const db = getDb();

  // Fetch all check-ins for this habit, newest first
  const rows = db.prepare(`
    SELECT checked_date, status
    FROM   checkins
    WHERE  habit_id = ?
    ORDER  BY checked_date DESC
  `).all(habitId);

  if (!rows.length) {
    upsertStreak(db, habitId, 0, 0, null);
    return { current_streak: 0, longest_streak: 0 };
  }

  // Build a Set for O(1) lookups
  const doneSet = new Set(
    rows.filter(r => r.status === 'done' || r.status === 'cheat').map(r => r.checked_date)
  );

  // Walk back from today counting consecutive days
  let current = 0;
  const today = todayStr();
  let cursor = new Date(today);

  while (true) {
    const dateStr = cursor.toISOString().split('T')[0];
    if (doneSet.has(dateStr)) {
      current++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  // Longest streak: scan all check-ins sequentially
  let longest  = 0;
  let running  = 0;
  let prevDate = null;

  for (let i = rows.length - 1; i >= 0; i--) {
    const { checked_date, status } = rows[i];
    if (status === 'done' || status === 'cheat') {
      if (prevDate) {
        const diff = dayDiff(prevDate, checked_date);
        running = diff === 1 ? running + 1 : 1;
      } else {
        running = 1;
      }
      longest  = Math.max(longest, running);
      prevDate = checked_date;
    } else {
      running  = 0;
      prevDate = null;
    }
  }

  const lastDate = rows[0].checked_date;
  upsertStreak(db, habitId, current, longest, lastDate);
  return { current_streak: current, longest_streak: longest };
}

function upsertStreak(db, habitId, current, longest, lastDate) {
  db.prepare(`
    INSERT INTO streaks (habit_id, current_streak, longest_streak, last_checked_date, updated_at)
    VALUES (@habit_id, @current, @longest, @lastDate, datetime('now'))
    ON CONFLICT(habit_id) DO UPDATE SET
      current_streak    = excluded.current_streak,
      longest_streak    = MAX(streaks.longest_streak, excluded.longest_streak),
      last_checked_date = excluded.last_checked_date,
      updated_at        = excluded.updated_at
  `).run({ habit_id: habitId, current, longest, lastDate });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function dayDiff(dateA, dateB) {
  // Returns number of calendar days from dateA → dateB
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((b - a) / 86400000);
}

module.exports = { recalcStreak, todayStr };
