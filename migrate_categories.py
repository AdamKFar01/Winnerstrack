"""
Migration: Rename win categories
  mental  → work
  social  → relationships
  mood    → mindset

Safe to run multiple times (idempotent).
Run: python3 migrate_categories.py
"""
import sqlite3
import os

DB_PATH = os.environ.get(
    'WINNERSTRACKBUILDER_DB',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wintracker.db')
)

RENAMES = [
    ('mental', 'work'),
    ('social', 'relationships'),
    ('mood',   'mindset'),
]

def migrate():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    for old, new in RENAMES:
        c.execute('UPDATE wins SET category = ? WHERE category = ?', (new, old))
        wins_changed = c.rowcount
        c.execute('UPDATE activities SET category = ? WHERE category = ?', (new, old))
        acts_changed = c.rowcount
        print(f"  {old!r} → {new!r}: {wins_changed} win(s), {acts_changed} activity record(s) updated")

    conn.commit()
    conn.close()
    print("Migration complete.")

if __name__ == '__main__':
    print(f"DB: {DB_PATH}")
    migrate()
