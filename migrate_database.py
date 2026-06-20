import sqlite3
import os
import sys

# This script updates your database to the latest schema
# Run this ONCE before starting the app with the new version

db_path = 'wintracker.db'

if not os.path.exists(db_path):
    print("❌ Error: wintracker.db not found!")
    print("Make sure you're running this in the win-tracker folder")
    sys.exit(1)

conn = sqlite3.connect(db_path)
c = conn.cursor()

print("🔄 Starting database migration...")
print()

# Function to check if column exists
def column_exists(table, column):
    c.execute(f"PRAGMA table_info({table})")
    columns = [row[1] for row in c.fetchall()]
    return column in columns

# Function to check if table exists
def table_exists(table):
    c.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'")
    return c.fetchone() is not None

# 1. Update wins table
print("📝 Checking wins table...")
if not column_exists('wins', 'description'):
    try:
        c.execute("ALTER TABLE wins ADD COLUMN description TEXT DEFAULT ''")
        conn.commit()
        print("   ✅ Added 'description' column to wins")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ Wins table already has description column")

# 2. Update tasks table
print("📝 Checking tasks table...")
if not column_exists('tasks', 'task_type'):
    try:
        c.execute("ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'task'")
        conn.commit()
        print("   ✅ Added 'task_type' column")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ Tasks table already has task_type")

if not column_exists('tasks', 'period'):
    try:
        c.execute("ALTER TABLE tasks ADD COLUMN period TEXT DEFAULT 'today'")
        conn.commit()
        print("   ✅ Added 'period' column")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ Tasks table already has period")

if not column_exists('tasks', 'moved_to_old'):
    try:
        c.execute("ALTER TABLE tasks ADD COLUMN moved_to_old INTEGER DEFAULT 0")
        conn.commit()
        print("   ✅ Added 'moved_to_old' column")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ Tasks table already has moved_to_old")

# 3. Create activities table
print("📝 Checking activities table...")
if not table_exists('activities'):
    try:
        c.execute('''CREATE TABLE activities
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      category TEXT NOT NULL,
                      name TEXT NOT NULL,
                      points INTEGER NOT NULL)''')
        conn.commit()
        print("   ✅ Created activities table")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ Activities table exists")

# 4. Create calendar_events table
print("📝 Checking calendar_events table...")
if not table_exists('calendar_events'):
    try:
        c.execute('''CREATE TABLE calendar_events
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      title TEXT NOT NULL,
                      date TEXT NOT NULL,
                      start_time TEXT,
                      end_time TEXT,
                      category TEXT NOT NULL,
                      importance TEXT DEFAULT 'normal',
                      description TEXT,
                      created_at TEXT NOT NULL)''')
        conn.commit()
        print("   ✅ Created calendar_events table")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ Calendar_events table exists")

# 5. Check reminders table
print("📝 Checking reminders table...")
if table_exists('reminders'):
    if not column_exists('reminders', 'reminder_type'):
        print("   ⚠️  Reminders table needs restructuring")
        print("   📝 Creating new reminders table...")
        try:
            c.execute("DROP TABLE IF EXISTS reminders_old")
            c.execute("ALTER TABLE reminders RENAME TO reminders_old")
            c.execute('''CREATE TABLE reminders
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          reminder TEXT NOT NULL,
                          reminder_type TEXT DEFAULT 'daily',
                          time TEXT,
                          date TEXT,
                          repeat TEXT,
                          active INTEGER DEFAULT 1,
                          created_at TEXT NOT NULL)''')
            # Try to migrate old data if possible
            try:
                c.execute('''INSERT INTO reminders (reminder, time, repeat, active, created_at)
                             SELECT reminder, time, repeat, active, created_at FROM reminders_old''')
                c.execute("DROP TABLE reminders_old")
                print("   ✅ Migrated old reminder data")
            except:
                print("   ⚠️  Could not migrate old reminders (table structure too different)")
            conn.commit()
            print("   ✅ Reminders table updated")
        except Exception as e:
            print(f"   ⚠️  Warning: {e}")
    else:
        # Check for additional columns
        for col, definition, label in [
            ('recurring', 'INTEGER DEFAULT 0', 'recurring'),
            ('urgency', "TEXT DEFAULT 'low'", 'urgency'),
            ('notice_hours', 'INTEGER DEFAULT 0', 'notice_hours'),
        ]:
            if not column_exists('reminders', col):
                try:
                    c.execute(f"ALTER TABLE reminders ADD COLUMN {col} {definition}")
                    conn.commit()
                    print(f"   ✅ Added '{label}' column to reminders")
                except Exception as e:
                    print(f"   ⚠️  Warning: {e}")
        print("   ✅ Reminders table is up to date")
else:
    c.execute('''CREATE TABLE reminders
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  reminder TEXT NOT NULL,
                  reminder_type TEXT DEFAULT 'daily',
                  time TEXT,
                  date TEXT,
                  repeat TEXT,
                  active INTEGER DEFAULT 1,
                  created_at TEXT NOT NULL)''')
    conn.commit()
    print("   ✅ Created reminders table")

# 6. Create daily_goals table
print("📝 Checking daily_goals table...")
if not table_exists('daily_goals'):
    try:
        c.execute('''CREATE TABLE daily_goals
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      date TEXT NOT NULL UNIQUE,
                      goal_1_text TEXT DEFAULT '',
                      goal_1_complete INTEGER DEFAULT 0,
                      goal_2_text TEXT DEFAULT '',
                      goal_2_complete INTEGER DEFAULT 0,
                      goal_3_text TEXT DEFAULT '',
                      goal_3_complete INTEGER DEFAULT 0)''')
        conn.commit()
        print("   ✅ Created daily_goals table")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ daily_goals table exists")

# 7. Create health_metrics table
print("📝 Checking health_metrics table...")
if not table_exists('health_metrics'):
    try:
        c.execute('''CREATE TABLE health_metrics
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
        conn.commit()
        print("   ✅ Created health_metrics table")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ health_metrics table exists")

# 7b. Add health_metrics extra columns
for col, definition in [
    ('weight_target',   'REAL DEFAULT 0'),
    ('calorie_deficit', 'INTEGER DEFAULT 0'),
    ('calorie_mode',    "TEXT DEFAULT 'average'"),
]:
    if not column_exists('health_metrics', col):
        try:
            c.execute(f"ALTER TABLE health_metrics ADD COLUMN {col} {definition}")
            conn.commit()
            print(f"   ✅ Added '{col}' column to health_metrics")
        except Exception as e:
            print(f"   ⚠️  Warning: {e}")

# 8. Create food_log table
print("📝 Checking food_log table...")
if not table_exists('food_log'):
    try:
        c.execute('''CREATE TABLE food_log
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      date TEXT NOT NULL,
                      meal TEXT NOT NULL,
                      food_name TEXT NOT NULL,
                      calories INTEGER DEFAULT 0,
                      protein_g REAL DEFAULT 0,
                      carbs_g REAL DEFAULT 0,
                      fat_g REAL DEFAULT 0,
                      created_at TEXT NOT NULL)''')
        conn.commit()
        print("   ✅ Created food_log table")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ food_log table exists")

# 9. Create activity_log table
print("📝 Checking activity_log table...")
if not table_exists('activity_log'):
    try:
        c.execute('''CREATE TABLE activity_log
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      date TEXT NOT NULL,
                      activity_type TEXT NOT NULL,
                      duration_mins INTEGER DEFAULT 0,
                      intensity TEXT DEFAULT 'moderate',
                      calories_burned INTEGER DEFAULT 0,
                      created_at TEXT NOT NULL)''')
        conn.commit()
        print("   ✅ Created activity_log table")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ activity_log table exists")

# 10. Create xp_log table
print("📝 Checking xp_log table...")
if not table_exists('xp_log'):
    try:
        c.execute('''CREATE TABLE xp_log
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      date TEXT NOT NULL,
                      change INTEGER NOT NULL,
                      reason TEXT NOT NULL)''')
        conn.commit()
        print("   ✅ Created xp_log table")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ xp_log table exists")

# 11. Create user_stats table
print("📝 Checking user_stats table...")
if not table_exists('user_stats'):
    try:
        c.execute('''CREATE TABLE user_stats
                     (id INTEGER PRIMARY KEY,
                      total_xp INTEGER DEFAULT 0,
                      streak_days INTEGER DEFAULT 0,
                      last_win_day TEXT DEFAULT '',
                      last_penalty_date TEXT DEFAULT '',
                      savings_threshold_crossed INTEGER DEFAULT 0)''')
        c.execute('INSERT OR IGNORE INTO user_stats (id) VALUES (1)')
        conn.commit()
        print("   ✅ Created user_stats table")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ user_stats table exists")

# 13. Create weight_log table
print("📝 Checking weight_log table...")
if not table_exists('weight_log'):
    try:
        c.execute('''CREATE TABLE weight_log
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      date TEXT NOT NULL UNIQUE,
                      weight_kg REAL NOT NULL,
                      created_at TEXT NOT NULL)''')
        conn.commit()
        print("   ✅ Created weight_log table")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ weight_log table exists")

# 12. Add xp_reward column to tasks
print("📝 Checking tasks.xp_reward column...")
if not column_exists('tasks', 'xp_reward'):
    try:
        c.execute("ALTER TABLE tasks ADD COLUMN xp_reward INTEGER DEFAULT 0")
        conn.commit()
        print("   ✅ Added 'xp_reward' column to tasks")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
else:
    print("   ✅ tasks.xp_reward column exists")

conn.close()

print()
print("=" * 50)
print("✅ DATABASE MIGRATION COMPLETE!")
print("=" * 50)
print()
print("Your database is now up to date.")
print("You can start the app with: ./start.sh")
print()

