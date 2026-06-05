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

## Pitfalls

### Unicode characters cause misleading terminal output

`cat -A` and similar flags render Unicode box-drawing characters (`─`, `│`, `═`) as `M-bM-^TM-^@` escape sequences, which can make separate lines appear concatenated. This caused a false positive during a security audit — a properly formatted `.env.example` appeared broken because `cat -A` merged lines visually.

**Rules:**
- Use `read_file()` tool (not `cat`) to inspect file contents — it renders Unicode correctly
- If you must use `cat`, avoid `cat -A` for files that may contain Unicode
- When grep output looks suspicious (unexpected concatenation), verify with `read_file()` before reporting findings
- Never report a finding based solely on `cat -A` or `xxd` output — always cross-check with a clean read

```bash
# BAD — Unicode breaks visual formatting
cat -A .env.example

# GOOD — read_file tool renders correctly
# (use the read_file tool, not terminal)

# GOOD — plain cat works for most files
cat .env.example
```

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
