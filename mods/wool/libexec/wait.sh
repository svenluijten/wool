#!/bin/sh
# wool wait <stateDir> -- command...
# Waits for wool's setup to finish, then execs the command if it succeeded.
# Gives up (exit 1) when setup failed, when the runner died without a result,
# or when no status shows up within WOOL_WAIT_MISSING_SECS (default 10).
set -u

state=$1
shift
if [ "${1:-}" = "--" ]; then shift; fi
missing=${WOOL_WAIT_MISSING_SECS:-10}

give_up() {
  printf 'wool: setup failed, not starting: %s\n' "$*"
  exit 1
}

printf 'wool: waiting for setup...\n'
waited=0
while :; do
  s=$(head -n 1 "$state/status" 2>/dev/null)
  case $s in
    ok)
      exec "$@"
      ;;
    failed*)
      give_up "$@"
      ;;
    running)
      pid=$(head -n 1 "$state/pid" 2>/dev/null)
      if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
        # The runner is gone. Read once more in case it finished just now.
        s=$(head -n 1 "$state/status" 2>/dev/null)
        [ "$s" = ok ] && exec "$@"
        give_up "$@"
      fi
      ;;
    *)
      waited=$((waited + 1))
      if [ "$waited" -gt "$missing" ]; then give_up "$@"; fi
      ;;
  esac
  sleep 1
done
