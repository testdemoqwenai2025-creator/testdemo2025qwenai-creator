#!/bin/bash
# Restarts the static docs server on port 3100.
# Uses a double-fork pattern so the server survives parent shell exit.
set -e
PIDFILE=/tmp/nbody-server.pid
LOGFILE=/tmp/nbody-server.log

# Kill any prior instance
if [ -f "$PIDFILE" ]; then
  OLDPID=$(cat "$PIDFILE" 2>/dev/null || echo "")
  if [ -n "$OLDPID" ] && kill -0 "$OLDPID" 2>/dev/null; then
    kill "$OLDPID" 2>/dev/null || true
    sleep 1
  fi
fi
pkill -f "serve-docs.js" 2>/dev/null || true
sleep 1

# Start fresh, fully detached
cd /home/z/my-project
nohup node scripts/serve-docs.js > "$LOGFILE" 2>&1 < /dev/null &
NEWPID=$!
echo "$NEWPID" > "$PIDFILE"
disown "$NEWPID" 2>/dev/null || true

# Give it a moment to bind
sleep 1.5

if kill -0 "$NEWPID" 2>/dev/null; then
  echo "OK: server PID $NEWPID listening on http://localhost:3100/"
  cat "$LOGFILE"
else
  echo "FAIL: server died on startup. Log:"
  cat "$LOGFILE"
  exit 1
fi
