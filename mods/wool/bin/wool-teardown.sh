#!/bin/sh
# wool-teardown.sh [--check] <record>
# <record> is <common git dir>/wool/<name>, written when setup ran. Once the
# worktree named in <record>/worktree is gone, runs <record>/teardown.sh in the
# main checkout (output in <record>/teardown.log), then deletes <record>.
# Prints one line last:
#   alive          the worktree still exists: nothing ran
#   busy           another teardown of this record is running
#   ok             teardown finished and the record is deleted
#   failed <step>  a step failed: the record stays, with status and log
# --check prints alive, busy, failed or gone, and runs nothing.
set -u

check=0
if [ "${1:-}" = "--check" ]; then check=1; shift; fi

# Refuse anything but <git dir>/wool/<name> with wool's files in it: this
# script ends with rm -rf.
rec=$(cd "${1:-}" 2>/dev/null && pwd -P) || { echo "wool-teardown: no such record: ${1:-}" >&2; exit 2; }
parent=$(dirname "$rec")
if [ "$(basename "$parent")" != wool ] || [ ! -f "$(dirname "$parent")/HEAD" ] ||
  [ ! -f "$rec/worktree" ] || [ ! -f "$rec/teardown.sh" ]; then
  echo "wool-teardown: not a wool record: $rec" >&2
  exit 2
fi

worktree=$(head -n 1 "$rec/worktree")
if [ -n "$worktree" ] && [ -e "$worktree" ]; then echo alive; exit 0; fi

if [ "$check" -eq 1 ]; then
  if [ -d "$rec/running" ]; then echo busy
  elif head -n 1 "$rec/status" 2>/dev/null | grep -q '^failed'; then echo failed
  else echo gone
  fi
  exit 0
fi

mkdir "$rec/running" 2>/dev/null || { echo busy; exit 0; }
trap 'rmdir "$rec/running" 2>/dev/null' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

rm -f "$rec/status" "$rec/failed-step" "$rec/code"
{
  WOOL_STATE_DIR=$rec sh "$rec/teardown.sh" 2>&1
  echo $? > "$rec/code"
} | tee "$rec/teardown.log"
code=$(cat "$rec/code" 2>/dev/null)
[ -n "$code" ] || code=1

if [ "$code" -eq 0 ]; then
  trap - EXIT
  rm -rf "$rec"
  rmdir "$parent" 2>/dev/null
  echo ok
  exit 0
fi

step=$(head -n 1 "$rec/failed-step" 2>/dev/null)
[ -n "$step" ] || step="exit $code"
printf 'failed %s\n' "$step" > "$rec/status"
echo "failed $step"
exit "$code"
