#!/bin/sh
# wool port [name]
# Prints a port from 10000 to 19999 picked from this worktree's branch (and
# <name>, so one worktree can claim several). The same branch and name always
# give the same port, so setup and teardown agree and worktrees don't collide
# (unless two hashes happen to land on the same port).
set -u
if [ "$#" -gt 1 ]; then
  echo "usage: wool port [name]" >&2
  exit 2
fi
if [ -z "${HERDR_BRANCH:-}" ]; then
  echo "wool port: HERDR_BRANCH is empty (a detached worktree has no branch, and this only works in setup and teardown steps)" >&2
  exit 1
fi
key=$HERDR_BRANCH
if [ "$#" -gt 0 ]; then key="$1-$key"; fi
sum=$(printf %s "$key" | cksum | awk '{ print $1 }')
echo $((10000 + sum % 10000))
