#!/usr/bin/env python3
"""Fire macOS notifications for WinnersTrack reminders even when the app is closed.

Run every minute by a launchd agent (com.adam.winnerstrack.reminders).
Reads the reminders table directly from the app database and shows native
notifications via osascript. Keeps a small JSON state file so each reminder
occurrence only notifies once.

Two kinds of notifications:
  - advance: high urgency reminders with notice_hours fire when entering the
    notice window (same rule as the in-app bell)
  - due: any active reminder fires at its occurrence time (onetime with a
    date, daily with a time), with a 4 hour grace window so reminders that
    came due while the laptop was asleep still fire
"""

import json
import os
import sqlite3
import subprocess
from datetime import datetime, timedelta

APP_SUPPORT = os.path.expanduser('~/Library/Application Support/WinnersTrack')
STATE_PATH = os.path.join(APP_SUPPORT, 'reminder_notifier_state.json')
DUE_GRACE_HOURS = 4


def find_db():
    """Use the most recently modified database the app might be writing to."""
    candidates = [
        os.environ.get('WINNERSTRACKBUILDER_DB'),
        os.path.join(APP_SUPPORT, 'wintracker.db'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wintracker.db'),
    ]
    existing = [p for p in candidates if p and os.path.exists(p)]
    if not existing:
        return None
    return max(existing, key=os.path.getmtime)


def load_state():
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(state):
    os.makedirs(APP_SUPPORT, exist_ok=True)
    # Drop entries older than 60 days so the file never grows unbounded
    cutoff = (datetime.now() - timedelta(days=60)).strftime('%Y-%m-%d')
    state = {k: v for k, v in state.items() if v >= cutoff}
    with open(STATE_PATH, 'w') as f:
        json.dump(state, f)


def notify(title, message):
    script = 'display notification {} with title {} sound name "Glass"'.format(
        json.dumps(message), json.dumps(title))
    subprocess.run(['osascript', '-e', script], capture_output=True, timeout=15)


def occurrence_datetime(r, now):
    """The next/current occurrence for a reminder, or None if undeterminable."""
    rid, text, rtype, time_s, date_s, urgency, notice_hours = r
    if date_s:
        return datetime.strptime(f"{date_s} {time_s or '00:00'}", '%Y-%m-%d %H:%M')
    if rtype == 'daily' and time_s:
        return datetime.strptime(f"{now.strftime('%Y-%m-%d')} {time_s}", '%Y-%m-%d %H:%M')
    return None


def main():
    db = find_db()
    if not db:
        return
    conn = sqlite3.connect(db)
    c = conn.cursor()
    try:
        c.execute('''SELECT id, reminder, reminder_type, time, date, urgency, notice_hours
                     FROM reminders WHERE active = 1''')
        reminders = c.fetchall()
    except sqlite3.Error:
        conn.close()
        return
    conn.close()

    now = datetime.now()
    state = load_state()
    today = now.strftime('%Y-%m-%d')
    changed = False

    for r in reminders:
        rid, text, rtype, time_s, date_s, urgency, notice_hours = r
        occ = occurrence_datetime(r, now)
        if not occ:
            continue
        occ_key = occ.strftime('%Y-%m-%d')

        # Advance notice for high urgency reminders (mirrors the in-app bell)
        if urgency == 'high' and (notice_hours or 0) > 0:
            key = f'{rid}:{occ_key}:advance'
            window_start = occ - timedelta(hours=notice_hours)
            if window_start <= now < occ and key not in state:
                hours_left = max(1, round((occ - now).total_seconds() / 3600))
                when = 'today' if occ.date() == now.date() else occ.strftime('%a %d %b')
                notify('WinnersTrack reminder soon',
                       f'{text} ({when} at {occ.strftime("%H:%M")}, about {hours_left}h from now)')
                state[key] = today
                changed = True

        # Due-time notification, with a grace window for sleep/reboots
        key = f'{rid}:{occ_key}:due'
        if occ <= now <= occ + timedelta(hours=DUE_GRACE_HOURS) and key not in state:
            title = 'WinnersTrack: important reminder' if urgency == 'high' else 'WinnersTrack reminder'
            notify(title, f'{text} ({occ.strftime("%H:%M") if time_s else occ_key})')
            state[key] = today
            changed = True

    if changed:
        save_state(state)


if __name__ == '__main__':
    main()
