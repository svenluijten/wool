#!/bin/sh
# wool-trust.sh: wool's trust gate for a repo's .herdr/wool.yml(.dist).
#
#   wool-trust.sh list               every trusted or declined file
#   wool-trust.sh forget <folder>    forget every decision for <folder>'s repo
#   wool-trust.sh run <folder>       set up <folder>'s worktree again (asks first if needed)
#   wool-trust.sh prompt <state dir> ask about a worktree's config (wool runs this)
#
# wool itself runs `wool-trust.sh check` and `wool-trust.sh prompt`. There is
# deliberately no `trust` subcommand: trusting a file takes an answer typed
# into wool's prompt.
#
# The store is ${XDG_CONFIG_HOME:-$HOME/.config}/wool/trust.tsv, one line per
# decision: <sha256> TAB <trusted|declined> TAB <repo> TAB <file> TAB <date>.
# Lines that don't look like that are kept as they are and otherwise ignored.
set -u

dir="${XDG_CONFIG_HOME:-$HOME/.config}/wool"
store="$dir/trust.tsv"
lockdir="$dir/trust.lock"
requests="$dir/requests"
locked=

usage() {
  cat >&2 <<'EOF'
usage: wool-trust.sh list
       wool-trust.sh forget <folder>
       wool-trust.sh run <folder>
       wool-trust.sh prompt <state dir>
EOF
  exit 2
}

die() {
  printf 'wool-trust.sh %s\n' "$*" >&2
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

# Ends every run: drops the store lock, and if a prompt is ending without an
# answer (an error, a signal, a closed terminal), answers `none` for it.
answered=1
nonce=
finish() {
  # Herdr closing a tab sends HUP more than once: don't let a second one cut
  # this short.
  trap '' HUP INT TERM
  unlock
  if [ -z "$answered" ] && [ -n "$nonce" ] && [ "$(cat "$state/trust-request" 2>/dev/null)" = "$request" ]; then
    printf 'none\t%s\n' "$nonce" > "$state/trust-answer"
  fi
}
trap finish EXIT

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
  [ $# -eq 4 ] || usage
  state=$1 repo=$2 file=$3 ask=$4
  [ -f "$state/config.yml" ] || die "check: no $state/config.yml"
  sum=$(checksum "$state/config.yml")
  [ -n "$sum" ] || die "check: couldn't checksum $state/config.yml"
  # <nonce>: wool's id for this question; the prompt's answer carries it.
  printf '%s\t%s\t%s\t%s\n' "$repo" "$file" "$sum" "$ask" > "$state/trust-request" || die "check: can't write $state/trust-request"
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

# Prints a file without terminal control characters (keeps newline and tab),
# so a config can't move the cursor, retitle the terminal or hide its lines.
# C1 controls (U+0080..U+009F, two bytes in UTF-8) go too.
show() {
  c2=$(printf '\302')
  c1lo=$(printf '\200')
  c1hi=$(printf '\237')
  LC_ALL=C tr -d '\000-\010\013-\037\177' < "$1" | LC_ALL=C sed "s/$c2[$c1lo-$c1hi]//g"
}

cmd_prompt() {
  [ $# -eq 1 ] || usage
  state=$1
  if [ ! -t 0 ]; then
    echo "wool-trust.sh prompt: needs a terminal" >&2
    exit 1
  fi
  # Closed, hung up, Ctrl-C'd or failed without an answer: finish() answers
  # none (nothing saved, nothing runs).
  answered=
  trap 'trap "" HUP INT TERM; exit 130' HUP INT TERM
  give_up() {
    printf '%s\n' "$1"
    exit 1
  }

  request=$(cat "$state/trust-request" 2>/dev/null) || give_up "wool: no trust request in $state."
  tab=$(printf '\t')
  repo=${request%%"$tab"*}
  rest=${request#*"$tab"}
  file=${rest%%"$tab"*}
  rest=${rest#*"$tab"}
  sum=${rest%%"$tab"*}
  nonce=${rest#*"$tab"}
  [ "$nonce" != "$rest" ] && [ -n "$nonce" ] || { nonce=; give_up "wool: $state/trust-request isn't one wool wrote."; }
  [ -f "$state/config.yml" ] || give_up "wool: no $state/config.yml."
  # What's shown must be what's checksummed (and what wool runs).
  [ "$(checksum "$state/config.yml")" = "$sum" ] || give_up "wool: $state/config.yml changed since wool read it. Nothing will run."

  bin=$(cd "$(dirname "$0")" && pwd)
  worktree=$(dirname "$(cat "$state/../gitdir" 2>/dev/null)" 2>/dev/null)
  [ -n "$worktree" ] && [ "$worktree" != . ] || worktree="<worktree>"

  printf '\nwool: this repo wants to set up your new worktree.\n\n'
  printf '  Repo:      %s\n  File:      %s\n  Checksum:  %s\n\n' "$repo" "$file" "$sum"
  printf -- '----- %s -----\n' "${file##*/}"
  show "$state/config.yml"
  printf -- '\n----- end -----\n\n'
  printf 'Nothing from this file has run yet. Its commands run as you.\n\n'

  while :; do
    printf '[d]ecline  trust [o]nce  [t]rust project: '
    if ! read -r a; then
      printf '\nNo answer. Nothing will run.\n'
      exit 0
    fi
    case $a in
      d | D | decline | Decline) choice=decline ;;
      o | O | once | Once) choice=once ;;
      t | T | trust | Trust) choice=trust ;;
      *) continue ;;
    esac
    break
  done

  # wool asked again (wool-trust.sh run) while this prompt stayed open: this
  # answer is about a question wool no longer waits for.
  if [ "$(cat "$state/trust-request" 2>/dev/null)" != "$request" ]; then
    printf '\nThis question is out of date (wool asked again in another tab). Nothing was saved.\n'
    answered=1
    exit 1
  fi

  case $choice in
    trust) store_put "$sum" trusted "$repo" "$file" ;;
    decline) store_put "$sum" declined "$repo" "$file" ;;
  esac
  answered=1
  printf '%s\t%s\n' "$choice" "$nonce" > "$state/trust-answer"

  if [ "$choice" = decline ]; then
    printf '\nDeclined. wool won'"'"'t ask about this file again.\n'
    printf 'To undo:\n  sh "%s/wool-trust.sh" forget "%s"\n  sh "%s/wool-trust.sh" run "%s"\n' "$bin" "$repo" "$bin" "$worktree"
  else
    printf '\nwool is setting up %s.\n' "$worktree"
    printf 'If nothing happens (wool restarted while this was open), run:\n  sh "%s/wool-trust.sh" run "%s"\n' "$bin" "$worktree"
  fi
}

# wool-trust.sh run <folder>: asks the running wool to set up a worktree again.
cmd_run() {
  [ $# -eq 1 ] || usage
  dirs=$(git -C "$1" rev-parse --path-format=absolute --git-dir --git-common-dir 2>/dev/null) || dirs=
  gitdir=$(printf '%s\n' "$dirs" | sed -n 1p)
  common=$(printf '%s\n' "$dirs" | sed -n 2p)
  if [ -z "$gitdir" ] || [ -z "$common" ] || [ "$gitdir" = "$common" ]; then
    die "run: $1 isn't a linked git worktree"
  fi
  top=$(git -C "$1" rev-parse --show-toplevel) || die "run: can't find the top of $1"
  mkdir -p "$requests" || die "run: can't create $requests"
  name="$(date +%s)-$$"
  printf '%s\n' "$top" > "$requests/.$name.tmp" && mv -f "$requests/.$name.tmp" "$requests/$name" \
    || { rm -f "$requests/.$name.tmp"; die "run: can't write to $requests"; }
  printf 'Asked wool to set up %s.\n' "$top"
}

# wool-trust.sh _take (wool runs this): prints each pending request's folder and
# removes it. A request is taken with mv, so two copies of wool never both
# take one.
cmd_take() {
  [ -d "$requests" ] || return 0
  for f in "$requests"/*; do
    [ -f "$f" ] || continue
    t="$requests/.taken.$$.${f##*/}"
    mv "$f" "$t" 2>/dev/null || continue
    sed -n 1p "$t"
    rm -f "$t"
  done
}

[ $# -ge 1 ] || usage
sub=$1
shift
case $sub in
  check) cmd_check "$@" ;;
  list) cmd_list "$@" ;;
  forget) cmd_forget "$@" ;;
  run) cmd_run "$@" ;;
  prompt) cmd_prompt "$@" ;;
  _take) cmd_take ;;
  *) usage ;;
esac
