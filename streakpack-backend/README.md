# StreakPack — Backend API

Node.js + Express + SQLite backend for the StreakPack social habit tracking app.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env

# 3. Start the server (auto-seeds demo data on first run)
npm run dev       # dev mode with nodemon
# or
npm start         # production mode
```

Server runs on **http://localhost:3000**

---

## Project Structure

```
streakpack-backend/
├── src/
│   ├── server.js               # Entry point — Express app setup
│   ├── db/
│   │   ├── database.js         # SQLite init, schema creation, seed data
│   │   └── streakHelper.js     # Streak recalculation logic
│   ├── middleware/
│   │   ├── errorHandler.js     # Central error handler + asyncWrap + httpError
│   │   └── validate.js         # Request body validation
│   └── routes/
│       └── habits.js           # All habit + check-in + stats routes
├── .env.example
├── package.json
└── README.md
```

---

## Database Schema

```
users       — id, username, display_name, xp, level
habits      — id, user_id, name, category, icon, type, duration_min, proof_method, penalty_type
checkins    — id, habit_id, user_id, checked_date (YYYY-MM-DD), status, xp_earned, note
streaks     — habit_id, current_streak, longest_streak, last_checked_date
```

---

## API Reference

All responses follow this shape:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "message": "..." } }
```

---

### Habits

#### `GET /api/habits`
List all active habits for a user with current streak.

**Query params:** `?user_id=user-arjun` (defaults to demo user)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "habit-dsa",
      "name": "DSA Practice",
      "category": "Coding",
      "icon": "💻",
      "type": "competitive",
      "duration_min": 60,
      "proof_method": "screenshot",
      "penalty_type": "points",
      "streak": { "current": 14, "longest": 14, "last_checked": "2025-01-14" },
      "today_status": "done"
    }
  ],
  "meta": { "total": 6, "date": "2025-01-14" }
}
```

---

#### `POST /api/habits`
Create a new habit.

**Body:**
```json
{
  "name": "Guitar Practice",
  "category": "Music",
  "type": "individual",
  "duration_min": 20,
  "proof_method": "none",
  "penalty_type": "points"
}
```

| Field         | Type    | Required | Values |
|---------------|---------|----------|--------|
| name          | string  | ✅ yes   | any    |
| category      | string  | no       | Coding, Fitness, Study, Music, Art, Dance, Wellness, Custom |
| icon          | string  | no       | emoji (auto-set from category if omitted) |
| type          | string  | no       | `competitive`, `individual` |
| duration_min  | integer | no       | 1–1440 |
| proof_method  | string  | no       | `none`, `screenshot`, `gps`, `photo`, `timer`, `manual` |
| penalty_type  | string  | no       | `points`, `charity` |

---

#### `GET /api/habits/:id`
Get a single habit with streak.

---

#### `PATCH /api/habits/:id`
Update habit fields (partial — only send what changes).

**Body:** same fields as POST, all optional.

---

#### `DELETE /api/habits/:id`
Soft-delete a habit (sets `is_active = 0`). History is preserved.

---

### Check-ins

#### `GET /api/habits/:id/checkins`
List check-ins for a habit.

**Query params:**
- `?from=YYYY-MM-DD` — default: 30 days ago
- `?to=YYYY-MM-DD`   — default: today
- `?limit=30`        — max 365

---

#### `POST /api/habits/:id/checkins`
Log a check-in. Re-posting the same date updates it (upsert).

**Body:**
```json
{
  "checked_date": "2025-01-14",
  "status": "done",
  "note": "Solved 2 LeetCode mediums"
}
```

| Field        | Type   | Required | Values |
|--------------|--------|----------|--------|
| checked_date | string | ✅ yes   | YYYY-MM-DD (not future) |
| status       | string | no       | `done` (default), `cheat`, `missed` |
| note         | string | no       | any text |

**XP awarded:** `done` → +30 XP, `cheat` → +15 XP, `missed` → 0 XP

**Response:**
```json
{
  "success": true,
  "data": {
    "checkin": { "habit_id": "habit-dsa", "checked_date": "2025-01-14", "status": "done", "xp_earned": 30 },
    "streak":  { "current": 14, "longest": 14 },
    "message": "✅ \"DSA Practice\" marked done! +30 XP"
  }
}
```

---

#### `DELETE /api/habits/:id/checkins/:date`
Remove a check-in for a date (undo). Reverses XP.

**Example:** `DELETE /api/habits/habit-dsa/checkins/2025-01-14`

---

### Stats

#### `GET /api/habits/:id/streak`
Quick streak info.

```json
{
  "data": { "current_streak": 14, "longest_streak": 14 }
}
```

---

#### `GET /api/habits/:id/stats`
Full stats for a habit over N days.

**Query:** `?days=14` (default 14, max 365)

```json
{
  "data": {
    "summary": {
      "total_days": 14,
      "done_days": 13,
      "cheat_days": 1,
      "missed_days": 0,
      "completion_pct": 100,
      "total_xp": 405
    },
    "streak": { "current": 14, "longest": 14 },
    "daily": [ { "checked_date": "2025-01-01", "status": "done", "xp_earned": 30 } ]
  }
}
```

---

#### `GET /api/habits/summary`
Today's dashboard summary for a user.

```json
{
  "data": {
    "date": "2025-01-14",
    "total_habits": 6,
    "done_count": 3,
    "pending_count": 3,
    "completion_pct": 50,
    "xp_today": 90
  }
}
```

---

## Example curl Requests

```bash
# List all habits
curl http://localhost:3000/api/habits

# Create a habit
curl -X POST http://localhost:3000/api/habits \
  -H "Content-Type: application/json" \
  -d '{"name":"Cold Shower","category":"Wellness","duration_min":5}'

# Log today as done
curl -X POST http://localhost:3000/api/habits/habit-dsa/checkins \
  -H "Content-Type: application/json" \
  -d '{"checked_date":"2025-01-14","status":"done","note":"3 problems solved"}'

# Check streak
curl http://localhost:3000/api/habits/habit-dsa/streak

# Get 30-day stats
curl "http://localhost:3000/api/habits/habit-dsa/stats?days=30"

# Today's dashboard summary
curl http://localhost:3000/api/habits/summary

# Delete a habit
curl -X DELETE http://localhost:3000/api/habits/habit-dsa
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| 400  | Bad request — missing/invalid field |
| 404  | Habit or check-in not found |
| 500  | Internal server error |
