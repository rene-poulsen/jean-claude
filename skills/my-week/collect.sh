#!/usr/bin/env bash
# Usage: collect.sh [since-date YYYY-MM-DD] [author-pattern]
#        collect.sh --set-roots <folder> [<folder> ...]
# Prints this week's commits grouped by repo, one commit per line.
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
for root in "${ROOTS[@]}"; do
  find "$root" -maxdepth 7 -name .git \
    -not -path "*/node_modules/*" -not -path "*/.worktrees/*" 2>/dev/null
done | sort -u | while read -r g; do
  r=$(dirname "$g")
  out=$(git -C "$r" log --all --no-merges --since="$SINCE" --author="$AUTHOR" \
        --pretty=format:"%at|%ad|%s" --date=format:"%a %d %b %H:%M" 2>/dev/null \
        | sort -t'|' -k3 -u | sort -t'|' -k1,1n | cut -d'|' -f2-)
  [ -n "$out" ] || continue
  n=$(printf '%s\n' "$out" | wc -l)
  echo "=== $r ($n)"
  printf '%s\n' "$out"
done
exit 0
