#!/usr/bin/env bash
# Usage: push-pages.sh <gh-pages checkout> <commit message> <path to stage>
# Commits only when the staged path changed. The probe writes only data/ and the site workflow
# never touches data/, so a rebase onto the other workflow's newer commit cannot conflict.
set -euo pipefail
cd "$1"
git add -A -- "$3"
if git diff --cached --quiet; then
  echo "No change"
  exit 0
fi
git -c user.name="github-actions[bot]" \
  -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit --quiet -m "$2"
for attempt in 1 2 3; do
  if git push --quiet origin HEAD:gh-pages; then exit 0; fi
  git pull --quiet --rebase origin gh-pages
done
echo "Could not push to gh-pages after 3 attempts" >&2
exit 1
