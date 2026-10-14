#!/bin/bash
# Blocks the end of a turn when the project's living documents are stale.
#   1. Code changed (uncommitted) but handoff.md / docs/activity-log.md have no REAL content change (a line-ending-only
#      difference does not count - that is how handoff.md went stale for weeks while always "showing as modified").
#   2. handoff.md is more than 6 hours older than the newest commit touching the app code.
cd "C:/Users/DjArVee/Documents/GitHub/claude bsm app/bsm-app" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

CODE_CHANGED=$(git status --porcelain -- src api package.json vercel.json 2>/dev/null)
DOCS_CONTENT_CHANGED=$(git diff --ignore-space-at-eol --ignore-cr-at-eol --numstat -- docs/activity-log.md handoff.md 2>/dev/null)
LAST_CODE=$(git log -1 --format=%ct -- src api package.json 2>/dev/null)
LAST_HAND=$(git log -1 --format=%ct -- handoff.md 2>/dev/null)
STALE=""
if [ -n "$LAST_CODE" ] && [ -n "$LAST_HAND" ] && [ $((LAST_CODE - LAST_HAND)) -gt 21600 ] && [ -z "$DOCS_CONTENT_CHANGED" ]; then STALE=1; fi

if { [ -n "$CODE_CHANGED" ] && [ -z "$DOCS_CONTENT_CHANGED" ]; } || [ -n "$STALE" ]; then
  cat <<'HOOKEOF'
{"decision":"block","reason":"handoff.md or docs/activity-log.md is stale. Update the CURRENT STATE section at the top of handoff.md (version, what shipped, open items) and append a dated entry to docs/activity-log.md before finishing. A change that is only line endings does not count."}
HOOKEOF
fi
