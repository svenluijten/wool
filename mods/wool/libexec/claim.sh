#!/bin/sh
# wool claim <folder> [fresh-minutes]
# wool claim <folder> rerun     (wool rerun: any age, old state cleared)
# Prints exactly one line:
#   not-linked                                   not a linked git worktree
#   stale                                        made more than [fresh-minutes] (3) ago
#   taken                                        wool already handled it (or is handling it)
#   running                                      (rerun) its setup is running right now
#   claimed<TAB><git-dir><TAB><main-root><TAB><branch><TAB><worktree-root>
# The claim is mkdir "<git-dir>/wool": atomic, so two copies of wool (two
# windows, or a reload mid-setup) can never both claim one worktree.
set -u

folder=$1
minutes=${2:-3}
rerun=
if [ "$minutes" = rerun ]; then rerun=1; fi

cd "$folder" 2>/dev/null || { echo not-linked; exit 0; }
dirs=$(git rev-parse --path-format=absolute --git-dir --git-common-dir 2>/dev/null) || { echo not-linked; exit 0; }
gitdir=$(printf '%s\n' "$dirs" | sed -n 1p)
common=$(printf '%s\n' "$dirs" | sed -n 2p)
if [ -z "$gitdir" ] || [ -z "$common" ] || [ "$gitdir" = "$common" ]; then
  echo not-linked
  exit 0
fi

if [ -n "$rerun" ]; then
  if [ -d "$gitdir/wool" ]; then
    if [ "$(sed -n 1p "$gitdir/wool/status" 2>/dev/null)" = running ]; then echo running; exit 0; fi
    rm -rf "$gitdir/wool" || { echo "wool claim: can't clear $gitdir/wool" >&2; exit 1; }
  fi
# git worktree add writes <git-dir>/commondir once; its age is the worktree's.
elif [ -z "$(find "$gitdir/commondir" -mmin "-$minutes" 2>/dev/null)" ]; then
  echo stale
  exit 0
fi

if ! mkdir "$gitdir/wool" 2>/dev/null; then
  if [ -d "$gitdir/wool" ]; then echo taken; exit 0; fi
  echo "wool claim: can't create $gitdir/wool" >&2
  exit 1
fi

case $common in
  */.git) main=${common%/.git} ;;
  *) main=$(git worktree list --porcelain | sed -n '1s/^worktree //p') ;;
esac
branch=$(git symbolic-ref --short -q HEAD 2>/dev/null || true)
top=$(git rev-parse --show-toplevel)
printf 'claimed\t%s\t%s\t%s\t%s\n' "$gitdir" "$main" "$branch" "$top"
