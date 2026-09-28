import subprocess
import tempfile
import os

APPLESCRIPT_TEMPLATE = '''
on pad2(n)
    set n to n as integer
    if n < 10 then
        return "0" & n
    else
        return n as string
    end if
end pad2

on isoDate(d)
    set y to year of d as integer
    set mo to (month of d as integer)
    set da to day of d
    set h to hours of d
    set mi to minutes of d
    set se to seconds of d
    return (y as string) & "-" & my pad2(mo) & "-" & my pad2(da) & "T" & my pad2(h) & ":" & my pad2(mi) & ":" & my pad2(se)
end isoDate

set daysBehind to DAYS_BEHIND_PLACEHOLDER
set daysAhead to DAYS_AHEAD_PLACEHOLDER
set rangeStart to (current date) - (daysBehind * days)
set rangeEnd to (current date) + (daysAhead * days)

set FS to (ASCII character 31)
set RS to (ASCII character 30)
set output to ""

tell application "Calendar"
    repeat with cal in calendars
        set calName to name of cal
        try
            set calEvents to (every event of cal whose start date is greater than or equal to rangeStart and start date is less than or equal to rangeEnd)
        on error
            set calEvents to {}
        end try
        repeat with evt in calEvents
            set evtTitle to summary of evt
            set evtStart to my isoDate(start date of evt)
            set evtEnd to my isoDate(end date of evt)
            set evtLoc to ""
            try
                set evtLoc to location of evt
            end try
            if evtLoc is missing value then set evtLoc to ""
            set output to output & evtTitle & FS & evtStart & FS & evtEnd & FS & calName & FS & evtLoc & RS
        end repeat
    end repeat
end tell

return output
'''


def get_mac_calendar_events(days_behind=7, days_ahead=30):
    """Reads events directly from the macOS Calendar app via AppleScript.

    Returns a list of dicts: title, start, end, calendar, location.
    Returns [] if Calendar automation access hasn't been granted yet,
    or the query otherwise fails.
    """
    script = APPLESCRIPT_TEMPLATE.replace(
        'DAYS_BEHIND_PLACEHOLDER', str(int(days_behind))
    ).replace(
        'DAYS_AHEAD_PLACEHOLDER', str(int(days_ahead))
    )

    script_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.applescript', delete=False
        ) as f:
            f.write(script)
            script_path = f.name

        result = subprocess.run(
            ['osascript', script_path],
            capture_output=True, text=True, timeout=30
        )
    except (subprocess.TimeoutExpired, OSError):
        return []
    finally:
        if script_path:
            os.remove(script_path)

    if result.returncode != 0:
        return []

    raw = result.stdout.strip('\n')
    if not raw:
        return []

    events = []
    for row in raw.split('\x1e'):
        if not row:
            continue
        fields = row.split('\x1f')
        if len(fields) < 4:
            continue
        events.append({
            'title': fields[0],
            'start': fields[1],
            'end': fields[2],
            'calendar': fields[3],
            'location': fields[4] if len(fields) > 4 else '',
        })
    return events
