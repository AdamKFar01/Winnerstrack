from flask import Flask, render_template, request, jsonify
from datetime import datetime, timedelta
import sqlite3
import json
import os
import urllib.request
import urllib.error

app = Flask(__name__)

# Load key/value pairs from a local .env file into the environment (if present).
# Keeps secrets like GROQ_API_KEY out of the code and out of git.
def load_dotenv():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            # Real environment variables take precedence over the file.
            os.environ.setdefault(key, value)

load_dotenv()

DB_PATH = os.environ.get(
    'WINNERSTRACKBUILDER_DB',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wintracker.db')
)

# Database setup
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Wins table
    c.execute('''CREATE TABLE IF NOT EXISTS wins
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  category TEXT NOT NULL,
                  activity TEXT NOT NULL,
                  description TEXT,
                  points INTEGER NOT NULL,
                  duration INTEGER,
                  date TEXT NOT NULL,
                  timestamp TEXT NOT NULL)''')
    
    # Tasks table
    c.execute('''CREATE TABLE IF NOT EXISTS tasks
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  task TEXT NOT NULL,
                  task_type TEXT DEFAULT 'task',
                  period TEXT DEFAULT 'today',
                  completed INTEGER DEFAULT 0,
                  due_date TEXT,
                  created_at TEXT NOT NULL,
                  moved_to_old INTEGER DEFAULT 0)''')
    
    # Reminders table
    c.execute('''CREATE TABLE IF NOT EXISTS reminders
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  reminder TEXT NOT NULL,
                  reminder_type TEXT DEFAULT 'daily',
                  time TEXT,
                  date TEXT,
                  repeat TEXT,
                  active INTEGER DEFAULT 1,
                  created_at TEXT NOT NULL,
                  recurring INTEGER DEFAULT 0,
                  urgency TEXT DEFAULT 'low',
                  notice_hours INTEGER DEFAULT 0)''')

    # Add columns if they don't exist (for existing databases)
    for col, definition in [
        ('recurring', 'INTEGER DEFAULT 0'),
        ('urgency', "TEXT DEFAULT 'low'"),
        ('notice_hours', 'INTEGER DEFAULT 0'),
    ]:
        try:
            c.execute(f"ALTER TABLE reminders ADD COLUMN {col} {definition}")
            conn.commit()
        except Exception:
            pass
    
    # Finance table
    c.execute('''CREATE TABLE IF NOT EXISTS finance
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  type TEXT NOT NULL,
                  amount REAL NOT NULL,
                  category TEXT,
                  description TEXT,
                  date TEXT NOT NULL)''')
    # Custom finance categories (e.g. Betting) beyond built-in Savings/Crypto
    c.execute('''CREATE TABLE IF NOT EXISTS finance_accounts
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL UNIQUE,
                  created_at TEXT NOT NULL)''')
    # Per-category wording for the two transaction directions (e.g. "Win"/"Loss" for Betting)
    for col in ('deposit_label', 'withdrawal_label'):
        try:
            c.execute(f"ALTER TABLE finance_accounts ADD COLUMN {col} TEXT")
        except Exception:
            pass

    # Display-name overrides for the fixed Crypto card (Savings/Total Balance stay fixed)
    c.execute('''CREATE TABLE IF NOT EXISTS finance_settings
                 (id INTEGER PRIMARY KEY,
                  crypto_label TEXT DEFAULT 'Crypto')''')
    c.execute('INSERT OR IGNORE INTO finance_settings (id) VALUES (1)')
    # Comma-separated card keys ('savings', 'crypto', 'account:<id>') in display order
    try:
        c.execute("ALTER TABLE finance_settings ADD COLUMN card_order TEXT DEFAULT ''")
    except Exception:
        pass

    # Freeform "what's inside" lines per category, keyed 'crypto' or 'account:<id>'
    c.execute('''CREATE TABLE IF NOT EXISTS finance_holdings
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  account_key TEXT NOT NULL,
                  item TEXT NOT NULL,
                  position INTEGER DEFAULT 0)''')
    try:
        c.execute("ALTER TABLE finance ADD COLUMN account_id INTEGER")
    except Exception:
        pass
    
    # Activities table
    c.execute('''CREATE TABLE IF NOT EXISTS activities
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  category TEXT NOT NULL,
                  name TEXT NOT NULL,
                  points INTEGER NOT NULL)''')

    # Custom activity categories (built-in pillars live in the frontend)
    c.execute('''CREATE TABLE IF NOT EXISTS custom_categories
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL UNIQUE,
                  created_at TEXT NOT NULL)''')

    # Custom finance transaction categories (built-ins live in the frontend)
    c.execute('''CREATE TABLE IF NOT EXISTS finance_categories
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL UNIQUE,
                  created_at TEXT NOT NULL)''')
    
    # Calendar events table (separate from activities)
    c.execute('''CREATE TABLE IF NOT EXISTS calendar_events
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  title TEXT NOT NULL,
                  date TEXT NOT NULL,
                  start_time TEXT,
                  end_time TEXT,
                  category TEXT NOT NULL,
                  importance TEXT DEFAULT 'normal',
                  description TEXT,
                  created_at TEXT NOT NULL)''')
    try:
        c.execute("ALTER TABLE calendar_events ADD COLUMN completed INTEGER DEFAULT 0")
    except Exception:
        pass

    # Plan events: an independent calendar's events, same shape as calendar_events.
    # Kept as its own table (rather than a flag on calendar_events) so the two
    # calendars stay fully separate — deleting one never touches the other.
    c.execute('''CREATE TABLE IF NOT EXISTS plan_events
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  title TEXT NOT NULL,
                  date TEXT NOT NULL,
                  start_time TEXT,
                  end_time TEXT,
                  category TEXT NOT NULL,
                  importance TEXT DEFAULT 'normal',
                  description TEXT,
                  completed INTEGER DEFAULT 0,
                  created_at TEXT NOT NULL)''')
    # date stays NOT NULL for compatibility — an empty string means "no date set" (a
    # plan not tied to any day). plan_type distinguishes a normal single-date plan
    # from a 'period' plan, which uses start_date/end_date instead of date.
    for col, definition in [
        ('plan_type', "TEXT DEFAULT 'single'"),
        ('start_date', 'TEXT'),
        ('end_date', 'TEXT'),
    ]:
        try:
            c.execute(f"ALTER TABLE plan_events ADD COLUMN {col} {definition}")
        except Exception:
            pass

    # Pillar scores table (one persistent row per user)
    c.execute('''CREATE TABLE IF NOT EXISTS pillar_scores
                 (id INTEGER PRIMARY KEY,
                  physical REAL DEFAULT 0,
                  work REAL DEFAULT 0,
                  health REAL DEFAULT 0,
                  relationships REAL DEFAULT 0,
                  mindset REAL DEFAULT 0)''')
    c.execute('INSERT OR IGNORE INTO pillar_scores (id) VALUES (1)')

    # Health metrics table (one persistent row)
    c.execute('''CREATE TABLE IF NOT EXISTS health_metrics
                 (id INTEGER PRIMARY KEY,
                  weight_kg REAL DEFAULT 0,
                  height_cm REAL DEFAULT 0,
                  age INTEGER DEFAULT 0,
                  sex TEXT DEFAULT 'male',
                  exercise_intensity TEXT DEFAULT 'sedentary',
                  calorie_target INTEGER DEFAULT 0,
                  protein_target INTEGER DEFAULT 0,
                  carb_target INTEGER DEFAULT 0,
                  fat_target INTEGER DEFAULT 0)''')
    c.execute('INSERT OR IGNORE INTO health_metrics (id) VALUES (1)')
    try:
        c.execute("ALTER TABLE health_metrics ADD COLUMN weight_target REAL DEFAULT 0")
    except Exception:
        pass
    try:
        c.execute("ALTER TABLE health_metrics ADD COLUMN calorie_deficit INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        c.execute("ALTER TABLE health_metrics ADD COLUMN calorie_mode TEXT DEFAULT 'average'")
    except Exception:
        pass

    # Food log table
    c.execute('''CREATE TABLE IF NOT EXISTS food_log
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  date TEXT NOT NULL,
                  meal TEXT NOT NULL,
                  food_name TEXT NOT NULL,
                  calories INTEGER DEFAULT 0,
                  protein_g REAL DEFAULT 0,
                  carbs_g REAL DEFAULT 0,
                  fat_g REAL DEFAULT 0,
                  created_at TEXT NOT NULL)''')

    # Activity log table
    c.execute('''CREATE TABLE IF NOT EXISTS activity_log
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  date TEXT NOT NULL,
                  activity_type TEXT NOT NULL,
                  duration_mins INTEGER DEFAULT 0,
                  intensity TEXT DEFAULT 'moderate',
                  calories_burned INTEGER DEFAULT 0,
                  created_at TEXT NOT NULL)''')

    # Daily goals table
    c.execute('''CREATE TABLE IF NOT EXISTS daily_goals
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  date TEXT NOT NULL UNIQUE,
                  goal_1_text TEXT DEFAULT '',
                  goal_1_complete INTEGER DEFAULT 0,
                  goal_2_text TEXT DEFAULT '',
                  goal_2_complete INTEGER DEFAULT 0,
                  goal_3_text TEXT DEFAULT '',
                  goal_3_complete INTEGER DEFAULT 0)''')

    # Flexible daily goal items (1 to 10 per day); replaces the fixed 3-column daily_goals
    c.execute('''CREATE TABLE IF NOT EXISTS daily_goal_items
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  date TEXT NOT NULL,
                  position INTEGER NOT NULL,
                  text TEXT DEFAULT '',
                  completed INTEGER DEFAULT 0)''')
    # One-time migration of existing daily_goals rows
    c.execute('SELECT COUNT(*) FROM daily_goal_items')
    if c.fetchone()[0] == 0:
        c.execute('''SELECT date, goal_1_text, goal_1_complete, goal_2_text, goal_2_complete,
                            goal_3_text, goal_3_complete FROM daily_goals''')
        for r in c.fetchall():
            for i in range(3):
                text = (r[1 + i * 2] or '').strip()
                if text:
                    c.execute('''INSERT INTO daily_goal_items (date, position, text, completed)
                                 VALUES (?, ?, ?, ?)''', (r[0], i, text, r[2 + i * 2] or 0))

    # Weight log table (one entry per date)
    c.execute('''CREATE TABLE IF NOT EXISTS weight_log
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  date TEXT NOT NULL UNIQUE,
                  weight_kg REAL NOT NULL,
                  created_at TEXT NOT NULL)''')

    # XP log table
    c.execute('''CREATE TABLE IF NOT EXISTS xp_log
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  date TEXT NOT NULL,
                  change INTEGER NOT NULL,
                  reason TEXT NOT NULL)''')

    # User stats table (single persistent row)
    c.execute('''CREATE TABLE IF NOT EXISTS user_stats
                 (id INTEGER PRIMARY KEY,
                  total_xp INTEGER DEFAULT 0,
                  streak_days INTEGER DEFAULT 0,
                  last_win_day TEXT DEFAULT '',
                  last_penalty_date TEXT DEFAULT '',
                  savings_threshold_crossed INTEGER DEFAULT 0)''')
    c.execute('INSERT OR IGNORE INTO user_stats (id) VALUES (1)')

    # xp_reward column on tasks (for goal types)
    try:
        c.execute("ALTER TABLE tasks ADD COLUMN xp_reward INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        c.execute("ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'medium'")
    except Exception:
        pass
    # target_month column ('YYYY-MM') for monthly goals aimed at a specific month
    try:
        c.execute("ALTER TABLE tasks ADD COLUMN target_month TEXT")
    except Exception:
        pass

    # Mastered recipes table
    c.execute('''CREATE TABLE IF NOT EXISTS recipes
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL,
                  protein_g INTEGER DEFAULT 0,
                  calories INTEGER DEFAULT 0,
                  description TEXT DEFAULT '',
                  created_at TEXT NOT NULL)''')

    # Periods table (e.g. "Master's", Sept 2026 to Sept 2027)
    c.execute('''CREATE TABLE IF NOT EXISTS periods
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  title TEXT NOT NULL,
                  start_date TEXT NOT NULL,
                  end_date TEXT NOT NULL,
                  created_at TEXT NOT NULL)''')

    # Goals belonging to a period; parent_id set means the row is a subgoal
    c.execute('''CREATE TABLE IF NOT EXISTS period_goals
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  period_id INTEGER NOT NULL,
                  text TEXT NOT NULL,
                  completed INTEGER DEFAULT 0,
                  created_at TEXT NOT NULL)''')
    try:
        c.execute("ALTER TABLE period_goals ADD COLUMN parent_id INTEGER")
    except Exception:
        pass

    # Goal conditions table
    c.execute('''CREATE TABLE IF NOT EXISTS goal_conditions
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  task_id INTEGER NOT NULL,
                  condition_text TEXT NOT NULL,
                  completed INTEGER DEFAULT 0,
                  created_at TEXT NOT NULL)''')

    # Yume categories table
    c.execute('''CREATE TABLE IF NOT EXISTS yume_categories
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL UNIQUE,
                  created_at TEXT NOT NULL)''')

    # Yume items table
    c.execute('''CREATE TABLE IF NOT EXISTS yume_items
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  category_id INTEGER NOT NULL,
                  text TEXT NOT NULL,
                  rank TEXT DEFAULT 'B',
                  completed INTEGER DEFAULT 0,
                  created_at TEXT NOT NULL)''')
    try:
        c.execute("ALTER TABLE yume_items ADD COLUMN rank TEXT DEFAULT 'B'")
    except Exception:
        pass
    try:
        c.execute("ALTER TABLE yume_items ADD COLUMN completed INTEGER DEFAULT 0")
    except Exception:
        pass

    # Rank categories table (Levels feature — badges grouped by category, e.g. "Finance")
    c.execute('''CREATE TABLE IF NOT EXISTS rank_categories
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL UNIQUE,
                  created_at TEXT NOT NULL)''')

    # Ranks table (badges within a category, ordered by tier)
    c.execute('''CREATE TABLE IF NOT EXISTS ranks
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  category_id INTEGER NOT NULL,
                  name TEXT NOT NULL,
                  tier INTEGER DEFAULT 1,
                  required_level INTEGER DEFAULT 0,
                  badge_image TEXT,
                  created_at TEXT NOT NULL)''')

    # Rank conditions table (requirements a rank needs met, beyond its required_level).
    # condition_type: 'manual' (freeform, user checks it off), 'finance' (auto — balance
    # threshold), 'goal' (auto — linked Goals task must be completed). condition_text is
    # always a frozen display label, generated client-side at creation time.
    c.execute('''CREATE TABLE IF NOT EXISTS rank_conditions
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  rank_id INTEGER NOT NULL,
                  condition_type TEXT NOT NULL DEFAULT 'manual',
                  condition_text TEXT NOT NULL,
                  completed INTEGER DEFAULT 0,
                  finance_metric TEXT,
                  finance_target REAL,
                  linked_task_id INTEGER,
                  created_at TEXT NOT NULL)''')

    # Quotes table — one is shown per day, plain text, above the dashboard level box
    c.execute('''CREATE TABLE IF NOT EXISTS quotes
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  text TEXT NOT NULL,
                  created_at TEXT NOT NULL)''')

    conn.commit()
    conn.close()

# Initialize database on startup
init_db()


def _compute_level(total_xp):
    """Return (level, xp_in_level, xp_for_next_level) using 5000×1.1^n curve."""
    level = 0
    threshold = 5000
    remaining = total_xp
    while remaining >= threshold:
        remaining -= threshold
        level += 1
        threshold = int(threshold * 1.1)
    return level, remaining, threshold


def award_xp(c, change, reason):
    """Insert into xp_log and update total_xp, applying streak multiplier on gains."""
    today = datetime.now().strftime('%Y-%m-%d')
    c.execute('SELECT total_xp, streak_days FROM user_stats WHERE id = 1')
    row = c.fetchone()
    streak_days = row[1] if row else 0
    actual_change = int(change * 1.25) if (streak_days >= 2 and change > 0) else change
    c.execute('INSERT INTO xp_log (date, change, reason) VALUES (?, ?, ?)',
              (today, actual_change, reason))
    c.execute('UPDATE user_stats SET total_xp = total_xp + ? WHERE id = 1', (actual_change,))
    return actual_change


def daily_goals_done(c, date):
    """A day's goals count as done when at least 3 goals were set and all of them completed."""
    c.execute("SELECT completed FROM daily_goal_items WHERE date = ? AND TRIM(text) != ''", (date,))
    rows = c.fetchall()
    return len(rows) >= 3 and all(r[0] for r in rows)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/wins', methods=['GET', 'POST', 'DELETE'])
def wins():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    if request.method == 'POST':
        data = request.json
        c.execute('''INSERT INTO wins (category, activity, description, points, duration, date, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?)''',
                  (data['category'], data['activity'], data.get('description', ''),
                   data['points'], data.get('duration', 0), data['date'], datetime.now().isoformat()))
        award_xp(c, data['points'], f"Win: {data['activity']}")
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    elif request.method == 'DELETE':
        win_id = request.args.get('id')
        c.execute('DELETE FROM wins WHERE id = ?', (win_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    else:
        # Get wins for a specific date or today
        date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
        c.execute('SELECT * FROM wins WHERE date = ?', (date,))
        wins = c.fetchall()
        conn.close()
        
        wins_list = []
        for win in wins:
            wins_list.append({
                'id': win[0],
                'category': win[1],
                'activity': win[2],
                'points': win[3],
                'duration': win[4],
                'date': win[5],
                'timestamp': win[6],
                'description': win[7] if len(win) > 7 else ''
            })
        
        return jsonify(wins_list)

@app.route('/api/daily-summary')
def daily_summary():
    date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Get points by category
    c.execute('''SELECT category, SUM(points) FROM wins 
                 WHERE date = ? GROUP BY category''', (date,))
    results = c.fetchall()
    conn.close()
    
    summary = {
        'physical': 0,
        'work': 0,
        'health': 0,
        'relationships': 0,
        'mindset': 0,
        'total': 0
    }
    
    for row in results:
        category = row[0].lower()
        points = row[1]
        if category in summary:
            summary[category] = points
            summary['total'] += points
    
    return jsonify(summary)

@app.route('/api/week-data')
def week_data():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    week_data = []
    for i in range(7):
        date = (datetime.now() - timedelta(days=6-i)).strftime('%Y-%m-%d')

        c.execute('SELECT category, SUM(points) FROM wins WHERE date = ? GROUP BY category', (date,))
        cat_rows = c.fetchall()
        cats = {r[0].lower(): r[1] for r in cat_rows if r[0]}
        physical = cats.get('physical', 0)
        work     = cats.get('work', 0)
        health   = cats.get('health', 0)
        relationships = cats.get('relationships', 0)
        mindset  = cats.get('mindset', 0)
        total    = physical + work + health + relationships + mindset

        goals_all_done = daily_goals_done(c, date)

        week_data.append({
            'date': date, 'points': total, 'goals_all_done': goals_all_done,
            'physical': physical, 'work': work, 'health': health,
            'relationships': relationships, 'mindset': mindset, 'total': total
        })

    conn.close()
    return jsonify(week_data)


@app.route('/api/daily-goals', methods=['GET', 'POST'])
def daily_goals_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'POST':
        data = request.json
        date = data['date']
        goals = [g for g in data.get('goals', []) if (g.get('text') or '').strip()][:10]

        # Previous completion state (by position) to detect newly-completed goals
        c.execute('SELECT position, completed FROM daily_goal_items WHERE date = ?', (date,))
        old_complete = {r[0]: r[1] for r in c.fetchall()}

        c.execute('DELETE FROM daily_goal_items WHERE date = ?', (date,))
        today = datetime.now().strftime('%Y-%m-%d')
        for i, g in enumerate(goals):
            completed = 1 if g.get('completed') else 0
            c.execute('''INSERT INTO daily_goal_items (date, position, text, completed)
                         VALUES (?, ?, ?, ?)''', (date, i, g['text'].strip(), completed))
            # Award +100 XP per newly completed goal (only for today's date)
            if date == today and completed == 1 and not old_complete.get(i, 0):
                award_xp(c, 100, f"Goal {i+1} completed")

        conn.commit()
        conn.close()
        return jsonify({'success': True})

    date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    c.execute("SELECT text, completed FROM daily_goal_items WHERE date = ? AND TRIM(text) != '' ORDER BY position", (date,))
    goals = [{'text': r[0], 'completed': bool(r[1])} for r in c.fetchall()]

    # Compute streak: consecutive past days with at least 3 goals, all completed
    streak = 0
    check = datetime.strptime(date, '%Y-%m-%d') - timedelta(days=1)
    while daily_goals_done(c, check.strftime('%Y-%m-%d')):
        streak += 1
        check -= timedelta(days=1)
        if streak > 365:
            break

    conn.close()
    return jsonify({'date': date, 'goals': goals, 'streak': streak})

@app.route('/api/tasks', methods=['GET', 'POST', 'PUT', 'DELETE'])
def tasks():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    if request.method == 'POST':
        data = request.json
        task_type = data.get('task_type', 'task')
        period = data.get('period', 'today')
        
        # Monthly goals can target a specific month ('YYYY-MM'); default is the current month
        target_month = data.get('target_month') or None
        if period == 'monthly' and not target_month:
            target_month = datetime.now().strftime('%Y-%m')

        # Calculate due date based on period
        due_date = data.get('due_date')
        if not due_date and period == 'today':
            due_date = datetime.now().strftime('%Y-%m-%d')
        elif not due_date and period == 'weekly':
            due_date = (datetime.now() + timedelta(days=7)).strftime('%Y-%m-%d')
        elif not due_date and period == 'monthly':
            # Due at the end of the target month
            ty, tm = map(int, target_month.split('-'))
            if tm == 12:
                due_date = f'{ty}-12-31'
            else:
                due_date = (datetime(ty, tm + 1, 1) - timedelta(days=1)).strftime('%Y-%m-%d')

        c.execute('''INSERT INTO tasks (task, task_type, period, due_date, created_at, xp_reward, priority, target_month)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                  (data['task'], task_type, period, due_date, datetime.now().isoformat(),
                   data.get('xp_reward', 0), data.get('priority', 'medium'), target_month))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    elif request.method == 'PUT':
        data = request.json
        c.execute('SELECT completed, xp_reward, task, period FROM tasks WHERE id = ?', (data['id'],))
        old = c.fetchone()
        c.execute('UPDATE tasks SET completed = ? WHERE id = ?',
                  (data['completed'], data['id']))
        conn.commit()  # save the tick immediately — nothing below can undo this
        # Award XP as a separate step so any failure doesn't affect the saved tick
        if data['completed'] == 1 and old and old[0] == 0:
            try:
                period_defaults = {'weekly': 50, 'monthly': 100, 'yearly': 200, 'lifelong': 500, 'today': 25}
                xp = old[1] if (old[1] and old[1] > 0) else period_defaults.get(old[3], 50)
                award_xp(c, xp, f"Goal: {old[2][:50]}")
                conn.commit()
            except Exception:
                pass
        conn.close()
        return jsonify({'success': True})
    
    elif request.method == 'DELETE':
        task_id = request.args.get('id')
        c.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    else:
        task_type = request.args.get('type', 'task')
        period = request.args.get('period', 'all')
        now = datetime.now()
        conn.row_factory = sqlite3.Row
        c = conn.cursor()

        sel = 'SELECT id, task, task_type, period, completed, due_date, created_at, moved_to_old, xp_reward, priority, target_month FROM tasks'

        if period == 'old':
            today = now.strftime('%Y-%m-%d')
            c.execute(f'{sel} WHERE task_type = ? AND due_date < ? ORDER BY due_date DESC', (task_type, today))
        elif period == 'all':
            c.execute(f'{sel} WHERE task_type = ? ORDER BY completed, CASE priority WHEN \'high\' THEN 0 WHEN \'medium\' THEN 1 ELSE 2 END, due_date', (task_type,))
        elif period == 'weekly':
            week_start = (now - timedelta(days=now.weekday())).strftime('%Y-%m-%d')
            c.execute(f'{sel} WHERE task_type = ? AND period = ? AND DATE(created_at) >= ? ORDER BY completed, CASE priority WHEN \'high\' THEN 0 WHEN \'medium\' THEN 1 ELSE 2 END, created_at',
                     (task_type, period, week_start))
        elif period == 'monthly':
            # Goals targeting the current month; legacy rows fall back to their creation month
            current_month = now.strftime('%Y-%m')
            c.execute(f'{sel} WHERE task_type = ? AND period = ? AND COALESCE(target_month, strftime(\'%Y-%m\', created_at)) = ? ORDER BY completed, CASE priority WHEN \'high\' THEN 0 WHEN \'medium\' THEN 1 ELSE 2 END, created_at',
                     (task_type, period, current_month))
        elif period == 'monthly-upcoming':
            current_month = now.strftime('%Y-%m')
            c.execute(f'{sel} WHERE task_type = ? AND period = \'monthly\' AND COALESCE(target_month, strftime(\'%Y-%m\', created_at)) > ? ORDER BY target_month, created_at',
                     (task_type, current_month))
        elif period == 'yearly':
            year_start = now.replace(month=1, day=1).strftime('%Y-%m-%d')
            c.execute(f'{sel} WHERE task_type = ? AND period = ? AND DATE(created_at) >= ? ORDER BY completed, CASE priority WHEN \'high\' THEN 0 WHEN \'medium\' THEN 1 ELSE 2 END, created_at',
                     (task_type, period, year_start))
        else:
            c.execute(f'{sel} WHERE task_type = ? AND period = ? ORDER BY completed, due_date',
                     (task_type, period))

        tasks = c.fetchall()
        conn.close()

        tasks_list = []
        for task in tasks:
            tasks_list.append({
                'id': task['id'],
                'task': task['task'],
                'task_type': task['task_type'],
                'period': task['period'],
                'completed': task['completed'],
                'due_date': task['due_date'],
                'created_at': task['created_at'],
                'moved_to_old': task['moved_to_old'],
                'xp_reward': task['xp_reward'],
                'priority': task['priority'] or 'medium',
                'target_month': task['target_month']
            })

        return jsonify(tasks_list)

@app.route('/api/finance', methods=['GET', 'POST'])
def finance():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    if request.method == 'POST':
        data = request.json
        c.execute('''INSERT INTO finance (type, amount, category, description, date, account_id)
                     VALUES (?, ?, ?, ?, ?, ?)''',
                  (data['type'], data['amount'], data.get('category'),
                   data.get('description'), data['date'], data.get('account_id')))

        # XP for income (savings) deposits
        if data['type'] == 'income':
            deposit_xp = int(data['amount'])
            if deposit_xp > 0:
                award_xp(c, deposit_xp, f"Savings deposit £{data['amount']:.2f}")
            # Check if a new £1000 savings threshold has been crossed
            c.execute('SELECT savings_threshold_crossed FROM user_stats WHERE id = 1')
            stat_row = c.fetchone()
            prev_threshold = stat_row[0] if stat_row else 0
            c.execute("SELECT SUM(amount) FROM finance WHERE type = 'income'")
            total_row = c.fetchone()
            total_income = total_row[0] if total_row[0] else 0
            new_threshold = int(total_income // 1000)
            if new_threshold > prev_threshold:
                for t in range(prev_threshold + 1, new_threshold + 1):
                    award_xp(c, 1000, f"£{t * 1000} savings milestone!")
                c.execute('UPDATE user_stats SET savings_threshold_crossed = ? WHERE id = 1',
                          (new_threshold,))

        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    else:
        c.execute('SELECT id, type, amount, category, description, date, account_id FROM finance ORDER BY date DESC')
        records = c.fetchall()
        conn.close()

        finance_list = []
        for record in records:
            finance_list.append({
                'id': record[0],
                'type': record[1],
                'amount': record[2],
                'category': record[3],
                'description': record[4],
                'date': record[5],
                'account_id': record[6]
            })
        
        return jsonify(finance_list)

@app.route('/api/finance-settings', methods=['GET', 'PUT'])
def finance_settings_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'PUT':
        data = request.json

        if 'crypto_label' in data:
            name = (data.get('crypto_label') or '').strip()
            if not name:
                conn.close()
                return jsonify({'success': False, 'error': 'Category name is required'}), 400
            if name.lower() in ('savings', 'total balance'):
                conn.close()
                return jsonify({'success': False, 'error': 'That category already exists'}), 400
            c.execute('UPDATE finance_settings SET crypto_label = ? WHERE id = 1', (name,))

        if 'card_order' in data:
            order = ','.join(str(k).strip() for k in (data.get('card_order') or []) if str(k).strip())
            c.execute('UPDATE finance_settings SET card_order = ? WHERE id = 1', (order,))

        conn.commit()
        conn.close()
        return jsonify({'success': True})

    else:
        c.execute('SELECT crypto_label, card_order FROM finance_settings WHERE id = 1')
        row = c.fetchone()
        conn.close()
        return jsonify({
            'crypto_label': row[0] if row else 'Crypto',
            'card_order': [k for k in (row[1] or '').split(',') if k] if row else []
        })

@app.route('/api/finance-holdings', methods=['GET', 'PUT'])
def finance_holdings_api():
    """What each category is currently composed of, as freeform bullet lines."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'PUT':
        data = request.json
        key = (data.get('account_key') or '').strip()
        if not key:
            conn.close()
            return jsonify({'success': False, 'error': 'Category is required'}), 400
        items = [str(i).strip() for i in (data.get('items') or []) if str(i).strip()]
        # The editor sends the whole list, so replace rather than merge
        c.execute('DELETE FROM finance_holdings WHERE account_key = ?', (key,))
        for pos, item in enumerate(items):
            c.execute('INSERT INTO finance_holdings (account_key, item, position) VALUES (?, ?, ?)',
                      (key, item, pos))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    else:
        c.execute('SELECT account_key, item FROM finance_holdings ORDER BY account_key, position')
        holdings = {}
        for key, item in c.fetchall():
            holdings.setdefault(key, []).append(item)
        conn.close()
        return jsonify(holdings)

@app.route('/api/finance-accounts', methods=['GET', 'POST', 'PUT', 'DELETE'])
def finance_accounts_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'POST':
        name = (request.json.get('name') or '').strip()
        if not name:
            conn.close()
            return jsonify({'success': False, 'error': 'Category name is required'}), 400
        if name.lower() in ('savings', 'crypto', 'total balance'):
            conn.close()
            return jsonify({'success': False, 'error': 'That category already exists'}), 400
        try:
            c.execute('INSERT INTO finance_accounts (name, created_at) VALUES (?, ?)',
                      (name, datetime.now().isoformat()))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'success': False, 'error': 'That category already exists'}), 400
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'PUT':
        data = request.json
        name = (data.get('name') or '').strip()
        if not name:
            conn.close()
            return jsonify({'success': False, 'error': 'Category name is required'}), 400
        if name.lower() in ('savings', 'crypto', 'total balance'):
            conn.close()
            return jsonify({'success': False, 'error': 'That category already exists'}), 400
        deposit_label = (data.get('deposit_label') or '').strip() or None
        withdrawal_label = (data.get('withdrawal_label') or '').strip() or None
        try:
            c.execute('UPDATE finance_accounts SET name = ?, deposit_label = ?, withdrawal_label = ? WHERE id = ?',
                      (name, deposit_label, withdrawal_label, data['id']))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'success': False, 'error': 'That category already exists'}), 400
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'DELETE':
        account_id = request.args.get('id')
        c.execute('DELETE FROM finance WHERE account_id = ?', (account_id,))
        c.execute('DELETE FROM finance_holdings WHERE account_key = ?', (f'account:{account_id}',))
        c.execute('DELETE FROM finance_accounts WHERE id = ?', (account_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    else:
        c.execute('SELECT id, name, deposit_label, withdrawal_label FROM finance_accounts ORDER BY created_at')
        rows = c.fetchall()
        conn.close()
        return jsonify([{
            'id': r[0], 'name': r[1],
            'deposit_label': r[2] or 'Deposit',
            'withdrawal_label': r[3] or 'Withdrawal'
        } for r in rows])


@app.route('/api/finance/monthly')
def finance_monthly():
    """Income vs expenses per month for the past 12 months."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''SELECT strftime('%Y-%m', date) as month,
                        SUM(CASE WHEN type='income'  THEN amount ELSE 0 END) as income,
                        SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expenses
                 FROM finance
                 WHERE date >= date('now', '-12 months')
                 GROUP BY month ORDER BY month''')
    rows = c.fetchall()
    conn.close()
    return jsonify([{'month': r[0], 'income': r[1] or 0, 'expenses': r[2] or 0} for r in rows])


@app.route('/api/activities', methods=['GET', 'POST', 'PUT', 'DELETE'])
def activities_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    if request.method == 'POST':
        data = request.json
        c.execute('''INSERT INTO activities (category, name, points)
                     VALUES (?, ?, ?)''',
                  (data['category'], data['name'], data['points']))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    elif request.method == 'PUT':
        data = request.json
        c.execute('UPDATE activities SET name = ?, points = ? WHERE id = ?',
                  (data['name'], data['points'], data['id']))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    elif request.method == 'DELETE':
        activity_id = request.args.get('id')
        c.execute('DELETE FROM activities WHERE id = ?', (activity_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    else:
        # GET all activities
        c.execute('SELECT * FROM activities ORDER BY category, name')
        activities = c.fetchall()
        conn.close()
        
        activities_list = []
        for activity in activities:
            activities_list.append({
                'id': activity[0],
                'category': activity[1],
                'name': activity[2],
                'points': activity[3]
            })
        
        return jsonify(activities_list)

# Built-in pillar categories that cannot be created or deleted as custom ones
BUILTIN_CATEGORIES = {'physical', 'work', 'health', 'relationships', 'mindset', 'fullday', 'other'}

@app.route('/api/categories', methods=['GET', 'POST', 'DELETE'])
def categories_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'POST':
        name = (request.json.get('name') or '').strip()
        if not name:
            conn.close()
            return jsonify({'success': False, 'error': 'Category name is required'}), 400
        if name.lower() in BUILTIN_CATEGORIES:
            conn.close()
            return jsonify({'success': False, 'error': 'That category already exists'}), 400
        try:
            c.execute('INSERT INTO custom_categories (name, created_at) VALUES (?, ?)',
                      (name, datetime.now().isoformat()))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'success': False, 'error': 'That category already exists'}), 400
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'DELETE':
        name = request.args.get('name', '')
        c.execute('DELETE FROM custom_categories WHERE name = ?', (name,))
        # Remove preset activities that belonged to this category
        c.execute('DELETE FROM activities WHERE category = ?', (name,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    else:
        c.execute('SELECT name FROM custom_categories ORDER BY name')
        names = [row[0] for row in c.fetchall()]
        conn.close()
        return jsonify(names)

BUILTIN_FINANCE_CATEGORIES = {
    'salary', 'freelance', 'investment', 'food', 'rent', 'transport',
    'subscriptions', 'health', 'entertainment', 'shopping', 'other'
}

@app.route('/api/finance-categories', methods=['GET', 'POST', 'DELETE'])
def finance_categories_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'POST':
        name = (request.json.get('name') or '').strip()
        if not name:
            conn.close()
            return jsonify({'success': False, 'error': 'Category name is required'}), 400
        if name.lower() in BUILTIN_FINANCE_CATEGORIES:
            conn.close()
            return jsonify({'success': False, 'error': 'That category already exists'}), 400
        try:
            c.execute('INSERT INTO finance_categories (name, created_at) VALUES (?, ?)',
                      (name, datetime.now().isoformat()))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'success': False, 'error': 'That category already exists'}), 400
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'DELETE':
        name = request.args.get('name', '')
        c.execute('DELETE FROM finance_categories WHERE name = ?', (name,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    else:
        c.execute('SELECT name FROM finance_categories ORDER BY name')
        names = [row[0] for row in c.fetchall()]
        conn.close()
        return jsonify(names)

@app.route('/api/reminders', methods=['GET', 'POST', 'PUT', 'DELETE'])
def reminders_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    if request.method == 'POST':
        data = request.json
        c.execute('''INSERT INTO reminders (reminder, reminder_type, time, date, repeat, active, created_at, recurring, urgency, notice_hours)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                  (data['reminder'], data.get('reminder_type', 'daily'), data.get('time'),
                   data.get('date'), data.get('repeat'), 1, datetime.now().isoformat(),
                   data.get('recurring', 0), data.get('urgency', 'low'), data.get('notice_hours', 0)))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    elif request.method == 'PUT':
        data = request.json
        if 'active' in data:
            c.execute('UPDATE reminders SET active = ? WHERE id = ?',
                      (data['active'], data['id']))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    elif request.method == 'DELETE':
        reminder_id = request.args.get('id')
        c.execute('DELETE FROM reminders WHERE id = ?', (reminder_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    else:
        reminder_type = request.args.get('type', 'all')
        if reminder_type == 'all':
            c.execute('SELECT * FROM reminders WHERE active = 1 ORDER BY reminder_type, time')
        else:
            c.execute('SELECT * FROM reminders WHERE reminder_type = ? AND active = 1 ORDER BY time',
                     (reminder_type,))
        
        reminders = c.fetchall()
        conn.close()
        
        reminders_list = []
        for reminder in reminders:
            reminders_list.append({
                'id': reminder[0],
                'reminder': reminder[1],
                'reminder_type': reminder[2],
                'time': reminder[3],
                'date': reminder[4] if len(reminder) > 4 else None,
                'repeat': reminder[5] if len(reminder) > 5 else None,
                'active': reminder[6] if len(reminder) > 6 else 1,
                'recurring': reminder[8] if len(reminder) > 8 else 0,
                'urgency': reminder[9] if len(reminder) > 9 else 'low',
                'notice_hours': reminder[10] if len(reminder) > 10 else 0
            })
        
        return jsonify(reminders_list)

@app.route('/api/calendar-events', methods=['GET', 'POST', 'PUT', 'DELETE'])
def calendar_events_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    if request.method == 'POST':
        data = request.json
        c.execute('''INSERT INTO calendar_events (title, date, start_time, end_time, category, importance, description, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                  (data['title'], data['date'], data.get('start_time'), data.get('end_time'),
                   data['category'], data.get('importance', 'normal'), data.get('description', ''),
                   datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    elif request.method == 'PUT':
        data = request.json
        if 'completed' in data and 'title' not in data:
            # Lightweight completion toggle
            c.execute('UPDATE calendar_events SET completed = ? WHERE id = ?',
                      (int(data['completed']), data['id']))
        else:
            c.execute('''UPDATE calendar_events
                         SET title = ?, date = ?, start_time = ?, end_time = ?, category = ?, importance = ?, description = ?
                         WHERE id = ?''',
                      (data['title'], data['date'], data.get('start_time'), data.get('end_time'),
                       data['category'], data.get('importance', 'normal'), data.get('description', ''), data['id']))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    elif request.method == 'DELETE':
        event_id = request.args.get('id')
        c.execute('DELETE FROM calendar_events WHERE id = ?', (event_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    
    else:
        # GET events for a specific month or all
        month = request.args.get('month')
        year = request.args.get('year')
        
        sel = '''SELECT id, title, date, start_time, end_time, category, importance, description, completed
                 FROM calendar_events'''
        if month and year:
            c.execute(f'{sel} WHERE strftime("%Y-%m", date) = ? ORDER BY date, start_time',
                     (f"{year}-{month.zfill(2)}",))
        else:
            c.execute(f'{sel} ORDER BY date, start_time')

        events = c.fetchall()
        conn.close()

        events_list = []
        for event in events:
            events_list.append({
                'id': event[0],
                'title': event[1],
                'date': event[2],
                'start_time': event[3],
                'end_time': event[4],
                'category': event[5],
                'importance': event[6],
                'description': event[7],
                'completed': bool(event[8])
            })

        return jsonify(events_list)

@app.route('/api/plan-events', methods=['GET', 'POST', 'PUT', 'DELETE'])
def plan_events_api():
    """Events on the independent Plans calendar. Same shape as /api/calendar-events,
    but its own table, so the two calendars never affect each other."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'POST':
        data = request.json
        c.execute('''INSERT INTO plan_events
                     (title, date, start_time, end_time, category, importance, description,
                      plan_type, start_date, end_date, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                  (data['title'], data.get('date') or '', data.get('start_time'), data.get('end_time'),
                   data['category'], data.get('importance', 'normal'), data.get('description', ''),
                   data.get('plan_type', 'single'), data.get('start_date'), data.get('end_date'),
                   datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'PUT':
        data = request.json
        if 'completed' in data and 'title' not in data:
            c.execute('UPDATE plan_events SET completed = ? WHERE id = ?',
                      (int(data['completed']), data['id']))
        else:
            c.execute('''UPDATE plan_events
                         SET title = ?, date = ?, start_time = ?, end_time = ?, category = ?, importance = ?, description = ?,
                             plan_type = ?, start_date = ?, end_date = ?
                         WHERE id = ?''',
                      (data['title'], data.get('date') or '', data.get('start_time'), data.get('end_time'),
                       data['category'], data.get('importance', 'normal'), data.get('description', ''),
                       data.get('plan_type', 'single'), data.get('start_date'), data.get('end_date'), data['id']))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'DELETE':
        event_id = request.args.get('id')
        c.execute('DELETE FROM plan_events WHERE id = ?', (event_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    else:
        month = request.args.get('month')
        year = request.args.get('year')

        sel = '''SELECT id, title, date, start_time, end_time, category, importance, description, completed,
                        plan_type, start_date, end_date
                 FROM plan_events'''
        if month and year:
            c.execute(f'{sel} WHERE strftime("%Y-%m", date) = ? ORDER BY date, start_time',
                     (f"{year}-{month.zfill(2)}",))
        else:
            c.execute(f'{sel} ORDER BY date, start_time')

        events = c.fetchall()
        conn.close()

        events_list = []
        for event in events:
            events_list.append({
                'id': event[0],
                'title': event[1],
                'date': event[2],
                'start_time': event[3],
                'end_time': event[4],
                'category': event[5],
                'importance': event[6],
                'description': event[7],
                'completed': bool(event[8]),
                'plan_type': event[9] or 'single',
                'start_date': event[10],
                'end_date': event[11]
            })

        return jsonify(events_list)

@app.route('/api/calendar-parse', methods=['POST'])
def calendar_parse_api():
    """Parse a free-text sentence into calendar-event fields using Groq (Llama 3.3).

    This route is completely isolated: it never touches the database. It only
    returns structured fields that the frontend prefills into the normal Add
    Event form, which the user still submits manually. If the API key is missing
    or anything fails, it returns an error and the manual form is unaffected.
    """
    data = request.json or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'success': False, 'error': 'No text provided.'}), 400

    api_key = os.environ.get('GROQ_API_KEY')
    if not api_key:
        return jsonify({
            'success': False,
            'error': 'AI not configured (GROQ_API_KEY is not set).'
        }), 503

    today = datetime.now()
    categories = ['uni', 'work', 'hobbies', 'personal', 'health', 'social', 'other']
    importances = ['normal', 'quite', 'very', 'top']

    system_prompt = (
        "You extract calendar event details from a short sentence and return "
        "ONLY a JSON object. Do not add commentary.\n"
        f"Today's date is {today.strftime('%Y-%m-%d')} ({today.strftime('%A')}). "
        "Resolve relative dates like 'tomorrow' or 'next Tuesday' against today.\n"
        "Return these keys:\n"
        '  "title": short event title (string; include who it is with, e.g. '
        '"Interview with Sarah").\n'
        '  "date": the event date as "YYYY-MM-DD".\n'
        '  "start_time": start time as 24-hour "HH:MM", or "" if none given.\n'
        '  "end_time": end time as 24-hour "HH:MM", or "" if none given.\n'
        f'  "category": one of {categories}. Pick the best fit; use "other" if unsure.\n'
        f'  "importance": one of {importances}. Use "normal" unless the text implies otherwise.\n'
        '  "description": any extra detail, or "".\n'
        "If a field is unknown, use an empty string (but always provide a date)."
    )

    payload = json.dumps({
        'model': 'llama-3.3-70b-versatile',
        'temperature': 0.1,
        'response_format': {'type': 'json_object'},
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': text},
        ],
    }).encode('utf-8')

    req = urllib.request.Request(
        'https://api.groq.com/openai/v1/chat/completions',
        data=payload,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode('utf-8'))
        content = body['choices'][0]['message']['content']
        parsed = json.loads(content)
    except urllib.error.HTTPError as e:
        return jsonify({'success': False, 'error': f'AI request failed ({e.code}).'}), 502
    except (urllib.error.URLError, TimeoutError) as e:
        return jsonify({'success': False, 'error': 'Could not reach the AI service.'}), 502
    except (KeyError, ValueError, json.JSONDecodeError):
        return jsonify({'success': False, 'error': 'AI returned an unreadable response.'}), 502

    # Sanitize against our known enums so the frontend never gets junk.
    category = parsed.get('category') if parsed.get('category') in categories else 'other'
    importance = parsed.get('importance') if parsed.get('importance') in importances else 'normal'

    return jsonify({
        'success': True,
        'event': {
            'title': (parsed.get('title') or '').strip(),
            'date': (parsed.get('date') or '').strip(),
            'start_time': (parsed.get('start_time') or '').strip(),
            'end_time': (parsed.get('end_time') or '').strip(),
            'category': category,
            'importance': importance,
            'description': (parsed.get('description') or '').strip(),
        }
    })

@app.route('/api/month-data')
def month_data():
    year = request.args.get('year')
    month = request.args.get('month')
    if not year or not month:
        return jsonify({})

    month_str = f"{year}-{month.zfill(2)}"
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute(
        '''SELECT date, SUM(points) FROM wins
           WHERE strftime('%Y-%m', date) = ?
           GROUP BY date''',
        (month_str,)
    )
    points_rows = c.fetchall()

    c.execute(
        '''SELECT date, COUNT(*), SUM(CASE WHEN completed THEN 1 ELSE 0 END)
           FROM daily_goal_items
           WHERE strftime('%Y-%m', date) = ? AND TRIM(text) != ''
           GROUP BY date''',
        (month_str,)
    )
    goals_rows = c.fetchall()
    conn.close()

    goals_map = {row[0]: (row[1] >= 3 and row[2] == row[1]) for row in goals_rows}

    result = {}
    for date, pts in points_rows:
        result[date] = {'points': pts, 'goals_all_done': goals_map.get(date, False)}

    return jsonify(result)


@app.route('/api/pillar-scores', methods=['GET', 'POST'])
def pillar_scores_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'POST':
        data = request.json
        c.execute('''INSERT OR REPLACE INTO pillar_scores
                     (id, physical, work, health, relationships, mindset)
                     VALUES (1, ?, ?, ?, ?, ?)''',
                  (data.get('physical', 0), data.get('work', 0),
                   data.get('health', 0), data.get('relationships', 0),
                   data.get('mindset', 0)))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    c.execute('SELECT physical, work, health, relationships, mindset FROM pillar_scores WHERE id = 1')
    row = c.fetchone()
    conn.close()
    if row:
        return jsonify({'physical': row[0], 'work': row[1], 'health': row[2],
                        'relationships': row[3], 'mindset': row[4]})
    return jsonify({'physical': 0, 'work': 0, 'health': 0, 'relationships': 0, 'mindset': 0})


@app.route('/api/health-metrics', methods=['GET', 'POST'])
def health_metrics_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'POST':
        data = request.json
        c.execute('''INSERT OR REPLACE INTO health_metrics
                     (id, weight_kg, height_cm, age, sex, exercise_intensity,
                      calorie_target, protein_target, carb_target, fat_target,
                      weight_target, calorie_deficit, calorie_mode)
                     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                  (data.get('weight_kg', 0), data.get('height_cm', 0),
                   data.get('age', 0), data.get('sex', 'male'),
                   data.get('exercise_intensity', 'sedentary'),
                   data.get('calorie_target', 0), data.get('protein_target', 0),
                   data.get('carb_target', 0), data.get('fat_target', 0),
                   data.get('weight_target', 0),
                   data.get('calorie_deficit', 0),
                   data.get('calorie_mode', 'average')))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    c.execute('SELECT * FROM health_metrics WHERE id = 1')
    row = c.fetchone()
    conn.close()
    if row:
        return jsonify({
            'weight_kg': row[1], 'height_cm': row[2], 'age': row[3],
            'sex': row[4], 'exercise_intensity': row[5],
            'calorie_target': row[6], 'protein_target': row[7],
            'carb_target': row[8], 'fat_target': row[9],
            'weight_target':    row[10] if len(row) > 10 else 0,
            'calorie_deficit':  row[11] if len(row) > 11 else 0,
            'calorie_mode':     row[12] if len(row) > 12 else 'average'
        })
    return jsonify({
        'weight_kg': 0, 'height_cm': 0, 'age': 0, 'sex': 'male',
        'exercise_intensity': 'sedentary',
        'calorie_target': 0, 'protein_target': 0, 'carb_target': 0, 'fat_target': 0,
        'weight_target': 0, 'calorie_deficit': 0, 'calorie_mode': 'average'
    })


@app.route('/api/health-week-summary')
def health_week_summary():
    """Weekly averages for the Health tab: deficit, protein, weight, activity calories burned."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    try:
        end_dt = datetime.strptime(request.args.get('date', ''), '%Y-%m-%d')
    except ValueError:
        end_dt = datetime.now()
    end = end_dt.strftime('%Y-%m-%d')
    start = (end_dt - timedelta(days=6)).strftime('%Y-%m-%d')

    c.execute('SELECT calorie_target FROM health_metrics WHERE id = 1')
    row = c.fetchone()
    calorie_target = row[0] if row else 0

    # Only days with something actually logged count toward the averages,
    # and each stat needs at least MIN_DAYS logged days to be meaningful.
    MIN_DAYS = 4

    c.execute('''SELECT date, SUM(calories), SUM(protein_g) FROM food_log
                 WHERE date BETWEEN ? AND ? GROUP BY date''', (start, end))
    food_rows = [r for r in c.fetchall() if (r[1] or 0) > 0 or (r[2] or 0) > 0]

    avg_protein = None
    avg_deficit = None
    if len(food_rows) >= MIN_DAYS:
        avg_protein = sum(r[2] or 0 for r in food_rows) / len(food_rows)
        if calorie_target > 0:
            avg_deficit = sum(calorie_target - (r[1] or 0) for r in food_rows) / len(food_rows)

    c.execute('SELECT COUNT(*), AVG(weight_kg) FROM weight_log WHERE date BETWEEN ? AND ?', (start, end))
    weight_days, avg_weight = c.fetchone()
    if weight_days < MIN_DAYS:
        avg_weight = None

    c.execute('''SELECT date, SUM(calories_burned) FROM activity_log
                 WHERE date BETWEEN ? AND ? GROUP BY date''', (start, end))
    burned_rows = [r for r in c.fetchall() if (r[1] or 0) > 0]
    avg_burned = (sum(r[1] for r in burned_rows) / len(burned_rows)) if len(burned_rows) >= MIN_DAYS else None

    conn.close()
    return jsonify({
        'avg_deficit': round(avg_deficit) if avg_deficit is not None else None,
        'avg_protein': round(avg_protein, 1) if avg_protein is not None else None,
        'avg_weight': round(avg_weight, 1) if avg_weight is not None else None,
        'avg_calories_burned': round(avg_burned) if avg_burned is not None else None,
        'days_logged': len(food_rows)
    })


@app.route('/api/food-log/recent')
def food_log_recent():
    """Return the 10 most recently used unique food names with their avg macros."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''SELECT food_name, AVG(calories), AVG(protein_g)
                 FROM food_log
                 GROUP BY food_name
                 ORDER BY MAX(created_at) DESC
                 LIMIT 10''')
    rows = c.fetchall()
    conn.close()
    return jsonify([{'food_name': r[0], 'calories': round(r[1] or 0), 'protein_g': round(r[2] or 0, 1)} for r in rows])


@app.route('/api/meal-pattern')
def meal_pattern():
    """Which main meals (breakfast/lunch/dinner) were logged per day: 30-day combo counts + 14-day strip."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    today = datetime.now()
    start = (today - timedelta(days=29)).strftime('%Y-%m-%d')
    c.execute('''SELECT DISTINCT date, meal FROM food_log
                 WHERE date >= ? AND meal IN ('breakfast', 'lunch', 'dinner')''', (start,))
    by_date = {}
    for d, m in c.fetchall():
        by_date.setdefault(d, set()).add(m)
    conn.close()

    combos = {'breakfast+lunch': 0, 'breakfast+dinner': 0, 'lunch+dinner': 0, 'all_three': 0}
    for meals in by_date.values():
        if len(meals) == 3:
            combos['all_three'] += 1
        elif meals == {'breakfast', 'lunch'}:
            combos['breakfast+lunch'] += 1
        elif meals == {'breakfast', 'dinner'}:
            combos['breakfast+dinner'] += 1
        elif meals == {'lunch', 'dinner'}:
            combos['lunch+dinner'] += 1

    strip = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        ds = d.strftime('%Y-%m-%d')
        meals = by_date.get(ds, set())
        strip.append({
            'date': ds,
            'day': d.strftime('%a')[0],
            'breakfast': 'breakfast' in meals,
            'lunch': 'lunch' in meals,
            'dinner': 'dinner' in meals
        })

    return jsonify({'combos': combos, 'days_logged': len(by_date), 'strip': strip})


@app.route('/api/nutrition-week')
def nutrition_week():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    try:
        end_dt = datetime.strptime(request.args.get('date', ''), '%Y-%m-%d')
    except ValueError:
        end_dt = datetime.now()
    result = []
    for i in range(7):
        date = (end_dt - timedelta(days=6-i)).strftime('%Y-%m-%d')
        c.execute('SELECT COALESCE(SUM(calories),0), COALESCE(SUM(protein_g),0) FROM food_log WHERE date = ?', (date,))
        row = c.fetchone()
        result.append({'date': date, 'calories': row[0] or 0, 'protein': row[1] or 0})
    conn.close()
    return jsonify(result)


@app.route('/api/food-log', methods=['GET', 'POST', 'DELETE'])
def food_log_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'POST':
        data = request.json
        entry_date = data['date']
        c.execute('''INSERT INTO food_log
                     (date, meal, food_name, calories, protein_g, carbs_g, fat_g, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                  (entry_date, data['meal'], data['food_name'],
                   data.get('calories', 0), data.get('protein_g', 0),
                   data.get('carbs_g', 0), data.get('fat_g', 0),
                   datetime.now().isoformat()))
        conn.commit()
        # Check if protein target is met for today
        c.execute('SELECT SUM(protein_g) FROM food_log WHERE date = ?', (entry_date,))
        total_protein = c.fetchone()[0] or 0
        c.execute('SELECT protein_target FROM health_metrics WHERE id = 1')
        m = c.fetchone()
        protein_target = m[0] if m else 0
        if protein_target > 0 and total_protein >= protein_target:
            c.execute("SELECT COUNT(*) FROM xp_log WHERE DATE(date) = ? AND reason LIKE 'Protein goal%'",
                     (entry_date,))
            if c.fetchone()[0] == 0:
                award_xp(c, int(protein_target), f'Protein goal met ({int(total_protein)}g)')
                conn.commit()
        conn.close()
        return jsonify({'success': True})

    if request.method == 'DELETE':
        entry_id = request.args.get('id')
        c.execute('DELETE FROM food_log WHERE id = ?', (entry_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    c.execute('SELECT * FROM food_log WHERE date = ? ORDER BY meal, created_at', (date,))
    rows = c.fetchall()
    conn.close()
    return jsonify([{
        'id': r[0], 'date': r[1], 'meal': r[2], 'food_name': r[3],
        'calories': r[4], 'protein_g': r[5], 'carbs_g': r[6], 'fat_g': r[7]
    } for r in rows])


@app.route('/api/activity-log', methods=['GET', 'POST', 'DELETE'])
def activity_log_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'POST':
        data = request.json
        c.execute('''INSERT INTO activity_log
                     (date, activity_type, duration_mins, intensity, calories_burned, created_at)
                     VALUES (?, ?, ?, ?, ?, ?)''',
                  (data['date'], data['activity_type'], data.get('duration_mins', 0),
                   data.get('intensity', 'moderate'), data.get('calories_burned', 0),
                   datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    if request.method == 'DELETE':
        entry_id = request.args.get('id')
        c.execute('DELETE FROM activity_log WHERE id = ?', (entry_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    c.execute('SELECT * FROM activity_log WHERE date = ? ORDER BY created_at', (date,))
    rows = c.fetchall()
    conn.close()
    return jsonify([{
        'id': r[0], 'date': r[1], 'activity_type': r[2],
        'duration_mins': r[3], 'intensity': r[4], 'calories_burned': r[5]
    } for r in rows])


@app.route('/api/weight-log', methods=['GET', 'POST', 'DELETE'])
def weight_log_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'POST':
        data = request.json
        c.execute('''INSERT OR REPLACE INTO weight_log (date, weight_kg, created_at)
                     VALUES (?, ?, ?)''',
                  (data['date'], data['weight_kg'], datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    if request.method == 'DELETE':
        entry_id = request.args.get('id')
        c.execute('DELETE FROM weight_log WHERE id = ?', (entry_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    c.execute('SELECT id, date, weight_kg FROM weight_log ORDER BY date ASC')
    rows = c.fetchall()
    conn.close()
    return jsonify([{'id': r[0], 'date': r[1], 'weight_kg': r[2]} for r in rows])


@app.route('/api/xp', methods=['GET'])
def xp_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT total_xp, streak_days FROM user_stats WHERE id = 1')
    row = c.fetchone()
    total_xp = row[0] if row else 0
    streak_days = row[1] if row else 0
    # Add current finance total balance as a starter XP boost
    c.execute('''SELECT COALESCE(SUM(CASE
        WHEN type='income'             THEN amount
        WHEN type='expense'            THEN -amount
        WHEN type='crypto_investment'  THEN amount
        WHEN type='crypto_withdrawal'  THEN -amount
        ELSE 0 END), 0) FROM finance''')
    balance = c.fetchone()[0] or 0
    conn.close()
    effective_xp = total_xp + max(0, int(balance))
    level, xp_in_level, xp_for_next = _compute_level(effective_xp)
    multiplier = 1.25 if streak_days >= 2 else 1.0
    return jsonify({
        'total_xp': effective_xp,
        'level': level,
        'xp_in_level': xp_in_level,
        'xp_for_next': xp_for_next,
        'streak_days': streak_days,
        'multiplier': multiplier
    })


@app.route('/api/xp/log', methods=['GET'])
def xp_log_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT id, date, change, reason FROM xp_log ORDER BY id DESC LIMIT 20')
    rows = c.fetchall()
    conn.close()
    return jsonify([{'id': r[0], 'date': r[1], 'change': r[2], 'reason': r[3]} for r in rows])


@app.route('/api/xp/complete-day', methods=['POST'])
def xp_complete_day():
    """Award +200 bonus XP and update streak when today is a win day."""
    today = datetime.now().strftime('%Y-%m-%d')
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute('SELECT last_win_day, streak_days FROM user_stats WHERE id = 1')
    row = c.fetchone()
    last_win_day = row[0] if row else ''
    streak_days = row[1] if row else 0

    if last_win_day == today:
        conn.close()
        return jsonify({'success': True, 'already_counted': True})

    # Verify today actually qualifies
    c.execute('SELECT SUM(points) FROM wins WHERE date = ?', (today,))
    pts_row = c.fetchone()
    today_points = pts_row[0] if pts_row[0] else 0

    goals_done = daily_goals_done(c, today)

    if today_points < 1000 or not goals_done:
        conn.close()
        return jsonify({'success': False, 'reason': 'conditions not met'})

    # Update streak
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    if last_win_day == yesterday:
        new_streak = streak_days + 1
    else:
        new_streak = 1

    c.execute('UPDATE user_stats SET last_win_day = ?, streak_days = ? WHERE id = 1',
              (today, new_streak))
    award_xp(c, 200, "Perfect day bonus (1000pts + all daily goals)")
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'streak': new_streak})


@app.route('/api/xp/daily-check', methods=['POST'])
def xp_daily_check():
    """Apply streak penalty if yesterday was a missed day. Call once per app load."""
    today = datetime.now().strftime('%Y-%m-%d')
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    day_before = (datetime.now() - timedelta(days=2)).strftime('%Y-%m-%d')

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute('SELECT last_penalty_date, last_win_day, streak_days FROM user_stats WHERE id = 1')
    row = c.fetchone()
    last_penalty_date = row[0] if row else ''
    last_win_day = row[1] if row else ''
    streak_days = row[2] if row else 0

    # Only penalise once per day, and only if user has had at least one win day
    if last_penalty_date == today or not last_win_day:
        conn.close()
        return jsonify({'success': True, 'skipped': True})

    def day_was_win(date):
        c.execute('SELECT SUM(points) FROM wins WHERE date = ?', (date,))
        p = c.fetchone()[0] or 0
        return p >= 1000 and daily_goals_done(c, date)

    c.execute('UPDATE user_stats SET last_penalty_date = ? WHERE id = 1', (today,))

    if not day_was_win(yesterday):
        # Missed yesterday
        if not day_was_win(day_before):
            # Two consecutive missed days → -1000 XP
            award_xp(c, -100, "Missed 2 consecutive days penalty")
        else:
            award_xp(c, -50, "Missed yesterday penalty")
        # Reset streak
        c.execute('UPDATE user_stats SET streak_days = 0 WHERE id = 1')

    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/recipes', methods=['GET', 'POST', 'DELETE'])
def recipes():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'POST':
        data = request.json
        c.execute('''INSERT INTO recipes (name, protein_g, calories, description, created_at)
                     VALUES (?, ?, ?, ?, ?)''',
                  (data['name'], int(data.get('protein_g', 0)), int(data.get('calories', 0)),
                   data.get('description', ''), datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'DELETE':
        recipe_id = request.args.get('id')
        c.execute('DELETE FROM recipes WHERE id = ?', (recipe_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    else:
        c.execute('SELECT id, name, protein_g, calories, description, created_at FROM recipes ORDER BY name')
        rows = c.fetchall()
        conn.close()
        return jsonify([{
            'id': r[0], 'name': r[1], 'protein_g': r[2],
            'calories': r[3], 'description': r[4], 'created_at': r[5]
        } for r in rows])


@app.route('/api/periods', methods=['GET', 'POST', 'DELETE'])
def periods_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'POST':
        data = request.json
        now = datetime.now().isoformat()
        c.execute('''INSERT INTO periods (title, start_date, end_date, created_at)
                     VALUES (?, ?, ?, ?)''',
                  (data['title'], data['start_date'], data['end_date'], now))
        period_id = c.lastrowid
        for text in data.get('goals', []):
            text = text.strip()
            if text:
                c.execute('''INSERT INTO period_goals (period_id, text, completed, created_at)
                             VALUES (?, ?, 0, ?)''', (period_id, text, now))
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'id': period_id})

    elif request.method == 'DELETE':
        period_id = request.args.get('id')
        c.execute('DELETE FROM period_goals WHERE period_id = ?', (period_id,))
        c.execute('DELETE FROM periods WHERE id = ?', (period_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    else:
        c.execute('SELECT id, title, start_date, end_date, created_at FROM periods ORDER BY start_date')
        period_rows = c.fetchall()
        c.execute('SELECT id, period_id, text, completed, parent_id FROM period_goals ORDER BY id')
        goal_rows = c.fetchall()
        conn.close()

        subs_by_parent = {}
        for g in goal_rows:
            if g[4]:
                subs_by_parent.setdefault(g[4], []).append(
                    {'id': g[0], 'text': g[2], 'completed': bool(g[3])})

        goals_by_period = {}
        for g in goal_rows:
            if not g[4]:
                goals_by_period.setdefault(g[1], []).append(
                    {'id': g[0], 'text': g[2], 'completed': bool(g[3]),
                     'subgoals': subs_by_parent.get(g[0], [])})

        return jsonify([{
            'id': p[0], 'title': p[1], 'start_date': p[2], 'end_date': p[3],
            'created_at': p[4], 'goals': goals_by_period.get(p[0], [])
        } for p in period_rows])


@app.route('/api/period-goals', methods=['POST', 'PUT', 'DELETE'])
def period_goals_api():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    def sync_parent(parent_id):
        """A goal with subgoals is complete exactly when all its subgoals are."""
        if not parent_id:
            return
        c.execute('SELECT COUNT(*), SUM(completed) FROM period_goals WHERE parent_id = ?', (parent_id,))
        total, done = c.fetchone()
        if total > 0:
            c.execute('UPDATE period_goals SET completed = ? WHERE id = ?',
                      (1 if done == total else 0, parent_id))

    if request.method == 'POST':
        data = request.json
        parent_id = int(data['parent_id']) if data.get('parent_id') else None
        c.execute('''INSERT INTO period_goals (period_id, text, completed, created_at, parent_id)
                     VALUES (?, ?, 0, ?, ?)''',
                  (int(data['period_id']), data['text'], datetime.now().isoformat(), parent_id))
        sync_parent(parent_id)
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'PUT':
        data = request.json
        goal_id = int(data['id'])
        c.execute('UPDATE period_goals SET completed = ? WHERE id = ?',
                  (int(data.get('completed', 0)), goal_id))
        c.execute('SELECT parent_id FROM period_goals WHERE id = ?', (goal_id,))
        row = c.fetchone()
        sync_parent(row[0] if row else None)
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    else:
        goal_id = request.args.get('id')
        c.execute('SELECT parent_id FROM period_goals WHERE id = ?', (goal_id,))
        row = c.fetchone()
        parent_id = row[0] if row else None
        c.execute('DELETE FROM period_goals WHERE id = ? OR parent_id = ?', (goal_id, goal_id))
        # Only re-sync if subgoals remain; deleting the last subgoal must not untick the goal
        if parent_id:
            c.execute('SELECT COUNT(*) FROM period_goals WHERE parent_id = ?', (parent_id,))
            if c.fetchone()[0] > 0:
                sync_parent(parent_id)
        conn.commit()
        conn.close()
        return jsonify({'success': True})


@app.route('/api/goal-conditions', methods=['GET', 'POST', 'PUT', 'DELETE'])
def goal_conditions():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'GET':
        task_id = request.args.get('task_id')
        c.execute('SELECT id, task_id, condition_text, completed FROM goal_conditions WHERE task_id = ? ORDER BY created_at', (task_id,))
        rows = c.fetchall()
        conn.close()
        return jsonify([{'id': r[0], 'task_id': r[1], 'condition_text': r[2], 'completed': r[3]} for r in rows])

    elif request.method == 'POST':
        data = request.json
        c.execute('INSERT INTO goal_conditions (task_id, condition_text, completed, created_at) VALUES (?, ?, 0, ?)',
                  (data['task_id'], data['condition_text'], datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'PUT':
        data = request.json
        c.execute('UPDATE goal_conditions SET completed = ? WHERE id = ?', (data['completed'], data['id']))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'DELETE':
        cond_id = request.args.get('id')
        c.execute('DELETE FROM goal_conditions WHERE id = ?', (cond_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})


@app.route('/api/yume/categories', methods=['GET', 'POST', 'DELETE'])
def yume_categories():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'GET':
        c.execute('SELECT id, name FROM yume_categories ORDER BY name')
        rows = c.fetchall()
        conn.close()
        return jsonify([{'id': r[0], 'name': r[1]} for r in rows])

    elif request.method == 'POST':
        data = request.json
        try:
            c.execute('INSERT INTO yume_categories (name, created_at) VALUES (?, ?)',
                      (data['name'], datetime.now().isoformat()))
            conn.commit()
            cat_id = c.lastrowid
            conn.close()
            return jsonify({'success': True, 'id': cat_id})
        except Exception:
            conn.close()
            return jsonify({'success': False, 'error': 'Category already exists'}), 400

    elif request.method == 'DELETE':
        cat_id = request.args.get('id')
        c.execute('DELETE FROM yume_items WHERE category_id = ?', (cat_id,))
        c.execute('DELETE FROM yume_categories WHERE id = ?', (cat_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})


@app.route('/api/yume/items', methods=['GET', 'POST', 'PUT', 'DELETE'])
def yume_items():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'GET':
        cat_id = request.args.get('category_id')
        c.execute('SELECT id, text, rank, completed FROM yume_items WHERE category_id = ? ORDER BY created_at', (cat_id,))
        rows = c.fetchall()
        conn.close()
        return jsonify([{'id': r[0], 'text': r[1], 'rank': r[2] or 'B', 'completed': r[3] or 0} for r in rows])

    elif request.method == 'POST':
        data = request.json
        c.execute('INSERT INTO yume_items (category_id, text, rank, completed, created_at) VALUES (?, ?, ?, 0, ?)',
                  (data['category_id'], data['text'], data.get('rank', 'B'), datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'PUT':
        data = request.json
        c.execute('UPDATE yume_items SET completed = ? WHERE id = ?', (data['completed'], data['id']))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'DELETE':
        item_id = request.args.get('id')
        c.execute('DELETE FROM yume_items WHERE id = ?', (item_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})


@app.route('/api/rank-categories', methods=['GET', 'POST', 'DELETE'])
def rank_categories():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'GET':
        c.execute('SELECT id, name FROM rank_categories ORDER BY name')
        rows = c.fetchall()
        conn.close()
        return jsonify([{'id': r[0], 'name': r[1]} for r in rows])

    elif request.method == 'POST':
        data = request.json
        try:
            c.execute('INSERT INTO rank_categories (name, created_at) VALUES (?, ?)',
                      (data['name'], datetime.now().isoformat()))
            conn.commit()
            cat_id = c.lastrowid
            conn.close()
            return jsonify({'success': True, 'id': cat_id})
        except Exception:
            conn.close()
            return jsonify({'success': False, 'error': 'Category already exists'}), 400

    elif request.method == 'DELETE':
        cat_id = request.args.get('id')
        c.execute('DELETE FROM rank_conditions WHERE rank_id IN (SELECT id FROM ranks WHERE category_id = ?)', (cat_id,))
        c.execute('DELETE FROM ranks WHERE category_id = ?', (cat_id,))
        c.execute('DELETE FROM rank_categories WHERE id = ?', (cat_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})


@app.route('/api/ranks', methods=['GET', 'POST', 'PUT', 'DELETE'])
def ranks():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'GET':
        cat_id = request.args.get('category_id')
        c.execute('''SELECT id, category_id, name, tier, required_level, badge_image
                     FROM ranks WHERE category_id = ? ORDER BY tier, id''', (cat_id,))
        rows = c.fetchall()
        conn.close()
        return jsonify([{
            'id': r[0], 'category_id': r[1], 'name': r[2],
            'tier': r[3], 'required_level': r[4], 'badge_image': r[5]
        } for r in rows])

    elif request.method == 'POST':
        data = request.json
        c.execute('''INSERT INTO ranks (category_id, name, tier, required_level, badge_image, created_at)
                     VALUES (?, ?, ?, ?, ?, ?)''',
                  (data['category_id'], data['name'], data.get('tier', 1),
                   data.get('required_level', 0), data.get('badge_image'),
                   datetime.now().isoformat()))
        conn.commit()
        rank_id = c.lastrowid
        conn.close()
        return jsonify({'success': True, 'id': rank_id})

    elif request.method == 'PUT':
        data = request.json
        c.execute('''UPDATE ranks SET name = ?, tier = ?, required_level = ?, badge_image = ?
                     WHERE id = ?''',
                  (data['name'], data.get('tier', 1), data.get('required_level', 0),
                   data.get('badge_image'), data['id']))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'DELETE':
        rank_id = request.args.get('id')
        c.execute('DELETE FROM rank_conditions WHERE rank_id = ?', (rank_id,))
        c.execute('DELETE FROM ranks WHERE id = ?', (rank_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})


@app.route('/api/rank-conditions', methods=['GET', 'POST', 'PUT', 'DELETE'])
def rank_conditions():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'GET':
        rank_id = request.args.get('rank_id')
        c.execute('''SELECT id, rank_id, condition_type, condition_text, completed,
                            finance_metric, finance_target, linked_task_id
                     FROM rank_conditions WHERE rank_id = ? ORDER BY created_at''', (rank_id,))
        rows = c.fetchall()
        conn.close()
        return jsonify([{
            'id': r[0], 'rank_id': r[1], 'condition_type': r[2], 'condition_text': r[3],
            'completed': r[4], 'finance_metric': r[5], 'finance_target': r[6],
            'linked_task_id': r[7]
        } for r in rows])

    elif request.method == 'POST':
        data = request.json
        c.execute('''INSERT INTO rank_conditions
                     (rank_id, condition_type, condition_text, completed,
                      finance_metric, finance_target, linked_task_id, created_at)
                     VALUES (?, ?, ?, 0, ?, ?, ?, ?)''',
                  (data['rank_id'], data.get('condition_type', 'manual'), data['condition_text'],
                   data.get('finance_metric'), data.get('finance_target'), data.get('linked_task_id'),
                   datetime.now().isoformat()))
        conn.commit()
        cond_id = c.lastrowid
        conn.close()
        return jsonify({'success': True, 'id': cond_id})

    elif request.method == 'PUT':
        data = request.json
        c.execute('UPDATE rank_conditions SET completed = ? WHERE id = ?', (data['completed'], data['id']))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

    elif request.method == 'DELETE':
        cond_id = request.args.get('id')
        c.execute('DELETE FROM rank_conditions WHERE id = ?', (cond_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})


@app.route('/api/quotes', methods=['GET', 'POST', 'DELETE'])
def quotes():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if request.method == 'GET':
        c.execute('SELECT id, text FROM quotes ORDER BY created_at')
        rows = c.fetchall()
        conn.close()
        return jsonify([{'id': r[0], 'text': r[1]} for r in rows])

    elif request.method == 'POST':
        data = request.json
        text = (data.get('text') or '').strip()
        if not text:
            conn.close()
            return jsonify({'success': False, 'error': 'Quote text required'}), 400
        c.execute('INSERT INTO quotes (text, created_at) VALUES (?, ?)',
                  (text, datetime.now().isoformat()))
        conn.commit()
        quote_id = c.lastrowid
        conn.close()
        return jsonify({'success': True, 'id': quote_id})

    elif request.method == 'DELETE':
        quote_id = request.args.get('id')
        c.execute('DELETE FROM quotes WHERE id = ?', (quote_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})


if __name__ == '__main__':
    app.run(debug=True, port=5001)
