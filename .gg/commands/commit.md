---
name: commit
description: Run checks, agent code review, commit with AI message, and push
---

1. Run quality checks:
   - `npm run lint`
   - `npm run build`
   Fix ALL errors before continuing. Use auto-fix commands where available.

2. Review changes: run `git status`, `git diff --staged`, and `git diff`.

3. Fast review gate: spawn ONE subagent with the full diff. Instruct it to review ONLY the diff for real bugs, regressions, leftover debug code, and unintended changes. Score each issue 0-100 confidence; pre-existing issues and stylistic nitpicks are false positives and score low. Report ONLY issues with confidence >= 80, with `file:line` and a one-line fix. If none, reply `CLEAR`. This is a fast last check, not a deep audit.

4. If `CLEAR`, proceed straight to step 5 and push WITHOUT asking anything. If issues >= 80 were reported, STOP, show them, and ask exactly:
   "Want me to fix this first, or commit and push anyway?
   A) Fix it first, then commit & push
   B) Commit & push anyway"
   On A: fix, re-run step 1, then continue without re-review. On B: continue as-is.

5. Stage relevant files with `git add <specific files>`; never use `git add -A`.

6. Generate a concise commit message, preferably one line: start with Add, Update, Fix, Remove, or Refactor and describe the specific change.

7. Commit AND push in one go without pausing for confirmation: `git commit -m "<generated message>" && git push`.
