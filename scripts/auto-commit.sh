#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
msg=${1:-"auto: $(date +"%Y-%m-%d %H:%M:%S")"}

git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
  exit 0
fi

git commit -m "$msg"
git push
