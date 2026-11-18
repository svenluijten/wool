#!/bin/sh
# wool records <folder>
# Lists the teardown records of the repo that <folder> belongs to (any of its
# checkouts), one per line: <record><TAB><worktree>. Prints nothing outside a repo.
set -u

cd "$1" 2>/dev/null || exit 0
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
for rec in "$common"/wool/*; do
  [ -f "$rec/worktree" ] || continue
  printf '%s\t%s\n' "$rec" "$(head -n 1 "$rec/worktree")"
done
