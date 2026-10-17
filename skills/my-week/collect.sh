#!/usr/bin/env bash
# Usage: collect.sh [since-date YYYY-MM-DD] [author-pattern]
#        collect.sh --set-roots <folder> [<folder> ...]
# Prints this week's commits grouped by repo, one commit per line, with the Claude Code
# tokens spent on each commit (from the Claude Code transcripts, see tokens.js; needs Node.js).
# The folders to scan are saved in config.txt next to this script.
# Without it, the script prints NO_CONFIG and exits 2.
DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$DIR/config.txt"

if [ "$1" = "--set-roots" ]; then
  shift
  [ $# -gt 0 ] || { echo "Usage: collect.sh --set-roots <folder> [<folder> ...]"; exit 1; }
  : > "$CONFIG"
  for p in "$@"; do
    command -v cygpath >/dev/null 2>&1 && p=$(cygpath -u "$p")
    [ -d "$p" ] || echo "Warning: $p does not exist" >&2
    echo "root=$p" >> "$CONFIG"
  done
  echo "Saved to $CONFIG:"
  cat "$CONFIG"
  exit 0
fi

if [ ! -s "$CONFIG" ]; then
  echo "NO_CONFIG"
  exit 2
fi
ROOTS=()
while IFS= read -r line; do
  case "$line" in root=*) ROOTS+=("${line#root=}") ;; esac
done < "$CONFIG"

SINCE="${1:-$(date -d "last monday" +%F 2>/dev/null || date -v-Mon +%F 2>/dev/null || date +%F)}"
[ "$(date +%u)" = "1" ] && [ -z "$1" ] && SINCE=$(date +%F)
AUTHOR="${2:-$(git config --global user.name)}"
[ -n "$AUTHOR" ] || { echo "No author: pass one, or set git config --global user.name"; exit 1; }
echo "Since: $SINCE  Author: $AUTHOR  Roots: ${ROOTS[*]}"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
for root in "${ROOTS[@]}"; do
  find "$root" -maxdepth 7 -name .git \
    -not -path "*/node_modules/*" -not -path "*/.worktrees/*" 2>/dev/null
done | sort -u | while read -r g; do
  r=$(dirname "$g")
  # repo \t hash \t unix time \t date \t Claude co-author (0|1) \t subject; dedupe on subject, oldest first
  git -C "$r" log --all --no-merges --since="$SINCE 00:00" --author="$AUTHOR" \
      --pretty=format:"%at%x09%h%x09%ad%x09%(trailers:key=Co-Authored-By,valueonly,separator=%x2C)%x09%s" \
      --date=format:"%a %d %b %H:%M" 2>/dev/null \
    | sort -t$'\t' -k5 -u | sort -t$'\t' -k1,1n \
    | awk -F'\t' -v repo="$r" 'BEGIN{OFS="\t"} {c=(tolower($4)~/claude/)?1:0; s=$5; for(i=6;i<=NF;i++) s=s"\t"$i; print repo,$2,$1,$3,c,s}'
done > "$TMP"
if command -v node >/dev/null 2>&1; then
  node "$DIR/tokens.js" "$SINCE" < "$TMP"
else
  # no Node.js: same output without the token column
  awk -F'\t' '
    function flush() { print "=== " repo " (" n ")"; for (i = 1; i <= n; i++) print line[i] }
    $1 != repo { if (repo != "") flush(); repo = $1; n = 0 }
    { line[++n] = $4 "|" $6 }
    END { if (repo != "") flush() }' "$TMP"
  echo "NO_NODE"
fi
exit 0
