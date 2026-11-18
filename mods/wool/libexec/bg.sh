#!/bin/sh
# wool bg <stateDir> <n> [--wait] -- command...
# Runs a background command (no pane) with its output in <stateDir>/bg-<n>.log
# and its exit code in <stateDir>/bg-<n>.exit ("skipped" when it waited for a
# setup that failed). The command's pid is in <stateDir>/bg-<n>.pid: kill it
# to stop it.
set -u

state=$1
n=$2
shift 2
wait=0
if [ "${1:-}" = "--wait" ]; then wait=1; shift; fi
if [ "${1:-}" = "--" ]; then shift; fi
log="$state/bg-$n.log"
here=$(dirname "$0")

if [ "$wait" -eq 1 ]; then
  # wait.sh execs the command, so this pid becomes the command's.
  sh "$here/wait.sh" "$state" -- "$@" > "$log" 2>&1 &
else
  "$@" > "$log" 2>&1 &
fi
pid=$!
printf '%s\n' "$pid" > "$state/bg-$n.pid"
wait "$pid"
code=$?
if [ "$wait" -eq 1 ] && [ "$(head -n 1 "$state/status" 2>/dev/null)" != ok ]; then code=skipped; fi
printf '%s\n' "$code" > "$state/bg-$n.exit"
