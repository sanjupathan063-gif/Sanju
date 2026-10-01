#!/data/data/com.termux/files/usr/bin/bash
set -e
# Usage: bash ~/storage/downloads/push-to-github-termux.sh
# Ensure the project has been extracted to ~/sanju-app and Git remote is configured.
cd "$HOME/sanju-app"
git add .
if git diff --cached --quiet; then
  echo "কোনো নতুন পরিবর্তন নেই।"
else
  git commit -m "Update SANJU app and feature roadmap"
fi
git push
