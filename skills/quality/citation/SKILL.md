---
name: citation
description: "Inline source attribution for tool-sourced facts. Use whenever citing information from web search, page content, or uploaded files."
tags: [citations, attribution, sources, research]
---

# Citation Skill

## When to Use

- Any factual claim derived from a tool call
- Web search results used to answer a question
- Content retrieved from a specific URL
- Analysis of user-uploaded files

## Citation Format

Place citations **inline, immediately after the sentence** they support:

```
The library was released in March 2025 [web:1].
```

### Source Tags

| Source | Tag | Example |
|--------|-----|---------|
| Web search | `[web:N]` | `[web:1]` |
| Full page content | `[page:N]` | `[page:1]` |
| User-uploaded file | `[file:N]` | `[file:1]` |

### Multiple Citations

One sentence, multiple sources — separate brackets:

```
Both studies confirm the trend [web:1][web:2].
```

## Rules

1. **Cite immediately** — never accumulate citations in a "References" section
2. **Paraphrase** — never reproduce more than ~30 words verbatim from any source
3. **Inline attribution** — "According to [web:1]..." or end-of-sentence "[web:1]"
4. **Number sequentially** — first source is [web:1], second is [web:2], etc.
5. **Every claim needs a source** — if you can't cite it, say "I don't have a source for this"
6. **Never fabricate** — if a URL or statistic isn't from a tool result, don't present it as fact

## Example

**Bad:**
> The library supports TypeScript and was released recently.

**Good:**
> The library supports TypeScript and was released in March 2025 [web:1].

**Bad (verbatim):**
> "TypeScript support was added in v2.0 which includes over 50 new features and improvements to the build system" [web:1].

**Good (paraphrased):**
> TypeScript support arrived in v2.0, which brought significant build system improvements [web:1].
