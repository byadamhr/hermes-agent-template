---
name: security-checklist
description: "Pre-commit security scan checklist. Run before committing code changes to catch common vulnerabilities."
tags: [security, checklist, pre-commit, vulnerabilities]
---

# Security Checklist Skill

## When to Use

- Before committing code changes
- After modifying authentication, authorization, or session logic
- When handling user input, API keys, or secrets
- Any time you're about to `git commit`

## Checklist

Scan for these before every commit:

### Injection Prevention
- [ ] No string interpolation into SQL queries → use parameterized queries
- [ ] No unsanitized user content in HTML → use proper escaping/templating
- [ ] No `eval()` or `exec()` of user-controlled strings
- [ ] No command injection vectors → use array-based subprocess calls, not shell strings
- [ ] No template injection → sandbox user inputs in templates

### Secrets & Credentials
- [ ] No hardcoded secrets, API keys, tokens, or passwords in code
- [ ] No secrets in commit messages
- [ ] `.env` files are in `.gitignore`
- [ ] Secrets loaded from environment variables or secret managers
- [ ] No secrets in logs or error messages

### Authentication & Authorization
- [ ] Session tokens are cryptographically random (not predictable)
- [ ] Passwords are hashed with bcrypt/argon2, never plaintext or MD5
- [ ] Auth checks exist on all protected endpoints
- [ ] CORS is configured restrictively
- [ ] Rate limiting on auth endpoints

### Data Handling
- [ ] Input validation at system boundaries (API endpoints, form submissions)
- [ ] Output encoding for browser-rendered content
- [ ] File uploads are validated (type, size, content)
- [ ] Sensitive data is not in URLs (use POST body or headers)

### Dependencies
- [ ] No known CVEs in used packages (run `npm audit` / `pip audit` / `cargo audit`)
- [ ] Dependencies are pinned to specific versions
- [ ] No unused dependencies that expand attack surface

## Quick Scan Commands

```bash
# Python
pip install bandit && bandit -r . -f json

# Node.js
npm audit

# Check for hardcoded secrets
grep -rn "password\|secret\|api_key\|token" --include="*.py" --include="*.js" --include="*.ts" .
```

## Auto-Fix Patterns

```python
# BAD: SQL injection
query = f"SELECT * FROM users WHERE id = {user_id}"

# GOOD: Parameterized
query = "SELECT * FROM users WHERE id = %s"
cursor.execute(query, (user_id,))
```

```python
# BAD: Shell injection
os.system(f"cat {filename}")

# GOOD: Safe subprocess
subprocess.run(["cat", filename], check=True)
```

```python
# BAD: Hardcoded secret
API_KEY = "sk-1234567890abcdef"

# GOOD: Environment variable
API_KEY = os.environ["API_KEY"]
```
