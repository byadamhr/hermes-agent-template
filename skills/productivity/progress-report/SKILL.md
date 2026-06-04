---
name: progress-report
description: "Structured progress reporting for long-running tasks. Use when hitting tool limits, context boundaries, or need to pause and resume work."
tags: [reporting, progress, long-running, resumption]
---

# Progress Report Skill

## When to Use

- Hitting tool call limits mid-task
- Nearing context window limits
- Multi-step tasks where you need to pause and resume
- Any task where the user needs visibility into what's done vs. remaining

## Report Format

Output this exact structure when pausing or hitting a boundary:

```
***
**PROGRESS REPORT**

**Completed:**
- [Specific action + result, e.g., "Fetched 60 issues from owner/repo, pages 1-3"]

**Current State:**
- [What data you now have]
- [Key findings or patterns]

**Remaining:**
- [Specific next actions]
- [Estimated scope if known]

**NEXT STEP:** [One clear sentence]

Say **Continue** to keep going.
***
```

## Rules

1. **Be specific** — "Fetched 60 issues" not "Got some data"
2. **Include data state** — what you have, what's missing
3. **One clear NEXT STEP** — not a list, not ambiguous
4. **"Say Continue"** — explicit signal for the user to resume
5. **Mark progress in task lists** — use `[x]` done, `[→]` in-progress, `[ ]` pending
6. **One `[→]` at a time** — never show two tasks in-progress simultaneously
7. **Mark complete immediately** — don't batch completions
8. **Only `[x]` when fully done** — failing tests or partial work keeps `[→]`

## Task List Format

```
Tasks
- [x] 1. Install dependencies
- [→] 2. Update User model
- [ ] 3. Create auth middleware
- [ ] 4. Create auth routes
```

Update at the **start of every response** during implementation. Mark `[→]` BEFORE starting work. Mark `[x]` IMMEDIATELY after finishing.

## Resuming After Pause

When the user says "Continue":
1. Re-read relevant files from disk (don't assume in-memory state)
2. Pick up exactly from NEXT STEP
3. Update task list at the top of your response
4. Never stop mid-section — finish the current step, save, then pause if needed
