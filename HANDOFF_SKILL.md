# HANDOFF SKILL

## Purpose
Every coding project must maintain a `handoff.md` file at the project root. This file is the single source of truth for project state. Claude must read it at the start of every session and update it at the end of every response that makes changes.

## When to read handoff.md
- At the START of every conversation involving a coding project
- When the user says "continue", "let's continue", or similar
- After any workspace reset or context loss
- Before making any changes to understand current state

## When to update handoff.md
- After EVERY response that changes code, schema, files, or plans
- After completing a feature
- After fixing a bug
- After a failed attempt (note what was tried and why it failed)
- Before ending a response that has pending work

## What handoff.md must contain

```markdown
# Project Handoff — [Project Name]

## Last Updated
[Date and brief description of what changed]

## Tech Stack
[Languages, frameworks, key libraries, versions]

## Project Structure
[Key directories and what they contain]

## Current Schema Version
[e.g. Dexie v13 — list what changed in each version]

## Completed Features
[Bulleted list of what's fully built and verified]

## Current State (what was just done)
[Specific files changed in the last session, what they do now]

## In Progress
[Anything partially built — what's done, what's missing]

## Next Steps (in priority order)
[Numbered list of what needs to be done next]

## Known Issues
[Bugs found but not yet fixed]

## Key Design Decisions
[Important decisions that affect the whole codebase]

## File Locations
[Where to find critical files]
```

## Rules
1. handoff.md is ALWAYS updated before delivering any zip or ending any response with code changes
2. If handoff.md doesn't exist, create it before writing any code
3. Keep it concise but complete — a new Claude instance must be able to continue the work from handoff.md alone
4. Never let handoff.md get more than one response behind the actual code state
5. If a workspace reset is detected (files missing), read handoff.md first to reconstruct context before touching anything
