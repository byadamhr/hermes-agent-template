---
name: safe-push
description: Guardrail for git push — prevents last-response loss from session DB by pushing via subagent or explicit save-first pattern.
tags: [git, push, session, safety, guardrail]
---

# Safe Push Skill

## Problem

When a `git push` is executed directly in the main session, the last assistant response
can vanish from the session DB. This creates a gap in conversation history — the work
done before the push is recorded, but the response containing the push result (or the
wrap-up message after it) disappears.

## Root Cause

The push operation may trigger session state changes (gateway events, process signals,
or DB flush timing) that cause the final response to not persist.

## Guardrail Pattern

**Rule: The git push MUST NOT be the last action in the main session.**

Two approaches, in order of preference:

### Approach 1: Push via Subagent (Preferred)

Delegate the push to a subagent. The main session's last response is the delegation
call itself, which always persists. The subagent's push result is returned as context,
not as the session's final message.

```python
# In the main session, after all edits are done and committed:
delegate_task(
    goal="Push to remote. Run: cd /data/hermes-agent-template && git push https://${GH_TOKEN}@github.com/byadamhr/hermes-agent-template.git main. Return the push output.",
    toolsets=["terminal"]
)
# Main session continues — the delegation call is the last persisted response
```

**After delegation returns**, add a brief summary message in the main session.
This becomes the true last response and is guaranteed to persist.

### Approach 2: Save-then-Push (Fallback)

If subagent delegation is not available or appropriate:

1. Complete all edits and commit
2. The assistant's response naturally persists after the turn
3. Push happens as the last terminal command
4. Follow up with a one-line confirmation message ("Push complete. All fixes deployed.")

The follow-up message is critical — it ensures the session has a response AFTER the push.

## Anti-Patterns (DO NOT)

- ❌ Push as the very last tool call with no follow-up message
- ❌ Push inside a batch of other terminal commands without clear separation
- ❌ Push + immediately end the session without a closing response

## When to Apply

- Any `git push` in a session where conversation history matters
- Deployments where the push triggers CI/CD
- Multi-commit sessions where you want full audit trail in session DB

## Verification

After pushing, check session history:
```
/session_search (browse recent sessions)
```
Confirm the last assistant message is present and contains the wrap-up, not just the push output.
