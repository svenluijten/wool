#!/bin/sh
# wool.sh: wool's trust gate for a repo's .herdr/wool.yml(.dist).
#
#   wool.sh list               every trusted or declined file
#   wool.sh forget <folder>    forget every decision for <folder>'s repo
#
# wool itself runs `wool.sh check`. There is deliberately no `trust`
# subcommand: trusting a file takes an answer typed into wool's prompt.
#
# The store is ${XDG_CONFIG_HOME:-$HOME/.config}/wool/trust.tsv, one line per
# decision: <sha256> TAB <trusted|declined> TAB <repo> TAB <file> TAB <date>.
# Lines that don't look like that are kept as they are and otherwise ignored.
set -u

dir="${XDG_CONFIG_HOME:-$HOME/.config}/wool"
store="$dir/trust.tsv"
lockdir="$dir/trust.lock"
locked=

usage() {
  cat >&2 <<'EOF'
usage: wool.sh list
       wool.sh forget <folder>
EOF
  exit 2
}

die() {
  printf 'wool.sh %s\n' "$*" >&2
  exit 1
}

# An awk test for a well-formed store line (fields split on tabs).
VALID='NF == 5 && length($1) == 64 && $1 !~ /[^0-9a-f]/ && ($2 == "trusted" || $2 == "declined")'

checksum() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 < "$1"
  else
    sha256sum < "$1"
  fi | awk '{ print $1 }'
}

# The main checkout of the repo <folder> belongs to.
main_of() {
  common=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  case $common in
    */.git) printf '%s\n' "${common%/.git}" ;;
    *) git -C "$1" worktree list --porcelain | sed -n '1s/^worktree //p' ;;
  esac
}

lock() {
  mkdir -p "$dir" || die "store: can't create $dir"
  n=0
  until mkdir "$lockdir" 2>/dev/null; do
    n=$((n + 1))
    [ "$n" -ge 50 ] && die "store: $lockdir is held by something else (remove it if nothing is running)"
    sleep 0.1
  done
  locked=1
}

unlock() {
  if [ -n "$locked" ]; then
    rmdir "$lockdir" 2>/dev/null
    locked=
  fi
}

trap unlock EXIT

# Rewrites the store as: old lines that awk program $1 keeps, then $2 (if any).
# Runs under the lock; the new file replaces the old one with mv.
rewrite() {
  tmpf="$store.$$"
  {
    if [ -f "$store" ]; then awk -F '\t' "$1" "$store" || exit 1; fi
    if [ -n "$2" ]; then printf '%s\n' "$2"; fi
  } > "$tmpf" && mv -f "$tmpf" "$store" || { rm -f "$tmpf"; die "store: can't write $store"; }
}

# store_put <sha> <trusted|declined> <repo> <file>: one decision per repo + sha.
store_put() {
  lock
  line=$(printf '%s\t%s\t%s\t%s\t%s' "$1" "$2" "$3" "$4" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
  S=$1 R=$3 rewrite "!($VALID && \$1 == ENVIRON[\"S\"] && \$3 == ENVIRON[\"R\"])" "$line"
  unlock
}

# store_get <sha> <repo>: prints trusted, declined or nothing.
store_get() {
  [ -f "$store" ] || return 0
  S=$1 R=$2 awk -F '\t' "$VALID && \$1 == ENVIRON[\"S\"] && \$3 == ENVIRON[\"R\"] { d = \$2 } END { if (d != \"\") print d }" "$store"
}

cmd_check() {
  [ $# -eq 3 ] || usage
  state=$1 repo=$2 file=$3
  [ -f "$state/config.yml" ] || die "check: no $state/config.yml"
  sum=$(checksum "$state/config.yml")
  [ -n "$sum" ] || die "check: couldn't checksum $state/config.yml"
  printf '%s\t%s\t%s\n' "$repo" "$file" "$sum" > "$state/trust-request" || die "check: can't write $state/trust-request"
  verdict=ask
  case ${file##*/} in
    wool.yml)
      # Only a personal file git ignores is yours; a committed one isn't.
      if git -C "$(dirname "$file")" check-ignore -q "$file" 2>/dev/null; then verdict=implicit; fi
      ;;
  esac
  if [ "$verdict" = ask ]; then
    found=$(store_get "$sum" "$repo")
    [ -n "$found" ] && verdict=$found
  fi
  printf '%s\t%s\n' "$verdict" "$sum"
}

cmd_list() {
  [ $# -eq 0 ] || usage
  out=
  [ -f "$store" ] && out=$(awk -F '\t' "$VALID { printf \"%s  %s  %s  %s  %s\\n\", \$2, substr(\$1, 1, 12), \$3, \$4, \$5 }" "$store")
  if [ -z "$out" ]; then
    echo "No trusted or declined files."
  else
    printf '%s\n' "$out"
  fi
}

cmd_forget() {
  [ $# -eq 1 ] || usage
  repo=$(main_of "$1") && [ -n "$repo" ] || die "forget: $1 isn't in a git repository"
  count=0
  if [ -f "$store" ]; then
    lock
    count=$(R=$repo awk -F '\t' "$VALID && \$3 == ENVIRON[\"R\"] { n++ } END { print n + 0 }" "$store")
    R=$repo rewrite "!($VALID && \$3 == ENVIRON[\"R\"])" ""
    unlock
  fi
  if [ "$count" -eq 1 ]; then
    printf 'Forgot 1 entry for %s.\n' "$repo"
  else
    printf 'Forgot %s entries for %s.\n' "$count" "$repo"
  fi
}

[ $# -ge 1 ] || usage
sub=$1
shift
case $sub in
  check) cmd_check "$@" ;;
  list) cmd_list "$@" ;;
  forget) cmd_forget "$@" ;;
  _put) # for tests only
    [ $# -eq 4 ] || usage
    store_put "$@" ;;
  *) usage ;;
esac
