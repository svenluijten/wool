#!/bin/sh
# wool run <stateDir> [-- command...]
# Runs <stateDir>/setup.sh in this terminal and records the result in
# <stateDir>/status: running, then ok or "failed <step>". On ok it execs the
# command (if any); on failure it leaves the error on screen and exits.
set -u

state=$1
shift
if [ "${1:-}" = "--" ]; then shift; fi
status="$state/status"

write_status() {
  printf '%s\n' "$1" > "$status.tmp" && mv -f "$status.tmp" "$status"
}

# Stops a process and everything it started, children first. A background
# job's children ignore INT, so Ctrl-C alone would leave the step running.
kill_tree() {
  for kid in $(ps -A -o pid= -o ppid= | awk -v p="$1" '$2 == p { print $1 }'); do
    kill_tree "$kid"
  done
  kill -TERM "$1" 2>/dev/null
}

child=
finish() {
  if [ -n "$child" ]; then kill_tree "$child"; child=; fi
  if [ "$(head -n 1 "$status" 2>/dev/null)" = running ]; then
    write_status "failed interrupted"
    printf '\nwool: setup interrupted; nothing that waits for it will start.\n'
  fi
}
trap finish EXIT
trap 'finish; trap - EXIT; exit 129' HUP
trap 'finish; trap - EXIT; exit 130' INT
trap 'finish; trap - EXIT; exit 143' TERM

rm -f "$state/failed-step"
printf '%s\n' "$$" > "$state/pid"
write_status running

# Run setup as a background job and wait for it, so a closed terminal (HUP)
# is noticed at once instead of after the current step. fd 3 keeps the
# terminal as the steps' stdin (background jobs would get /dev/null).
exec 3<&0
WOOL_STATE_DIR=$state sh "$state/setup.sh" <&3 &
child=$!
wait "$child"
code=$?
child=
exec 3<&-

if [ "$code" -eq 0 ]; then
  write_status ok
  printf '\nwool: setup finished.\n'
  if [ "$#" -gt 0 ]; then
    printf 'wool: starting: %s\n\n' "$*"
    trap - EXIT HUP INT TERM
    exec "$@"
  fi
  exit 0
fi

step=$(head -n 1 "$state/failed-step" 2>/dev/null)
[ -n "$step" ] || step="exit $code"
write_status "failed $step"
if [ "$#" -gt 0 ]; then
  printf 'wool: setup failed at step %s; not starting: %s\n' "'$step'" "$*"
else
  printf 'wool: setup failed at step %s.\n' "'$step'"
fi
exit "$code"
