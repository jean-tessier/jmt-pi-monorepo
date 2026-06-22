# Structured Output — Prompts & Examples

> Prompts you can use after installing `pi-structured-output` (and optionally `pi-delegate`).
> Install via `node install.mjs` from the repo root (auto-updates `~/.config/pi/settings.json`) or manually register in `~/.config/pi/pi.yaml`.

---

## What the extension gives you

The `pi-structured-output` extension registers a **`structured_output`** tool inside child Pi processes. When you pair it with `pi-delegate` and supply an `outputSchema`, the child agent calls `structured_output({ output: ... })` and the result comes back as validated JSON instead of freeform text.

### Without structured output

> `"from agent 'extractor': The title is 'Foo' and there were 3 topics..."`

You parse or strip the prefix — fragile and error-prone.

### With structured output

> `"from agent 'extractor' (structured): {\"title\":\"Foo\",\"topics\":[...],\"wordCount\":123}"`

You get validated JSON, labeled as a structured result so the parent can parse it cleanly. The parent rejects non-conforming results.

---

## Prerequisites

1. **Install the extensions** — run `node install.mjs` from the monorepo root.
2. **Register with Pi** — add to `~/.config/pi/pi.yaml`:
   ```yaml
   extensions:
     - ~/.config/pi/extensions/pi-delegate/src/parent/index.ts
     - ~/.config/pi/extensions/pi-delegate/src/delegate-provider/index.ts
     - ~/.config/pi/extensions/pi-structured-output/src/index.ts
   ```
3. **Define your agents** — create `.md` files with YAML frontmatter in `~/.config/pi/agents/`.

---

## Example 1: Basic structured extraction

Extract metadata from a document as a strongly-typed object.

**Prompt:**
```
Use the delegate tool with agent "extractor" to pull structured metadata from this blog post:

URL: https://example.com/ai-architecture-post

outputSchema:
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "author": { "type": "string" },
    "wordCount": { "type": "integer" },
    "topics": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["title", "author", "topics"]
}
```

**Result:**
```
from agent "extractor" (structured): {"title":"Building AI Systems at Scale","author":"Jane Doe","wordCount":1240,"topics":["AI","architecture","distributed-systems"]}
```

---

## Example 2: Richer schema (nested objects & enums)

Extract a full financial document analysis with nested fields and enumerated values.

**Prompt:**
```
Use the delegate tool to analyze this earnings call transcript.
I need structured financial data back.

Agent: financial-analyst

outputSchema:
{
  "type": "object",
  "properties": {
    "company": { "type": "string" },
    "quarter": { "type": "string" },
    "revenue": { "type": "number" },
    "earningsPerShare": { "type": "number" },
    "keyMetrics": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "value": { "type": "string" },
          "trend": { "type": "string", "enum": ["up", "down", "flat"] }
        },
        "required": ["name", "value", "trend"]
      }
    },
    "risks": { "type": "array", "items": { "type": "string" } },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
  },
  "required": ["company", "quarter", "revenue", "keyMetrics"]
}
```

**Result:**
```
from agent "financial-analyst" (structured): {"company":"Acme Corp","quarter":"Q2 2025","revenue":4520000000,"earningsPerShare":2.34,"keyMetrics":[{"name":"Gross Margin","value":"62%","trend":"up"},{"name":"CAC","value":"$450","trend":"flat"}],"risks":["Supply chain volatility","FX headwinds"],"confidence":0.89}
```

---

## Example 3: Parallel fan-out with structured output

Run multiple extraction tasks concurrently, each returning typed output.

**Prompt:**
```
Use the delegate tool with parallel tasks:

parallel:
  - task: "Extract structured metadata from doc1.txt"
    agent: extractor
    outputSchema:
      type: object
      properties:
        title: { type: string }
        wordCount: { type: integer }
      required: [title]

  - task: "Extract structured metadata from doc2.txt"
    agent: extractor
    outputSchema:
      type: object
      properties:
        title: { type: string }
        wordCount: { type: integer }
      required: [title]

  - task: "Extract structured metadata from doc3.txt"
    agent: extractor
    outputSchema:
      type: object
      properties:
        title: { type: string }
        wordCount: { type: integer }
      required: [title]

concurrency: 2
failFast: false
```

**Result:**
```
from agent "extractor" (structured): {"title":"Doc One","wordCount":800}

from agent "extractor" (structured): {"title":"Doc Two","wordCount":1200}

[BLOCKED:SCHEMA_INVALID] from agent "extractor": Agent timed out
```

---

## Example 4: Classification / decision-making

Classify content into a fixed set of categories with structured output.

**Prompt:**
```
Use the delegate tool to classify the sentiment of these customer reviews.

Agent: classifier

outputSchema:
{
  "type": "object",
  "properties": {
    "reviews": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "sentiment": { "type": "string", "enum": ["positive", "negative", "neutral"] },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "keyPhrases": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["id", "sentiment", "confidence"]
      }
    }
  },
  "required": ["reviews"]
}
```

---

## Example 5: Code generation with validation

Generate a React component that must conform to a specific structure.

**Prompt:**
```
Use the delegate tool to generate a React component based on this spec.

Agent: code-generator

outputSchema:
{
  "type": "object",
  "properties": {
    "componentName": { "type": "string" },
    "code": { "type": "string" },
    "dependencies": { "type": "array", "items": { "type": "string" } },
    "props": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "type": { "type": "string" },
          "required": { "type": "boolean" }
        },
        "required": ["name", "type"]
      }
    },
    "testCases": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "description": { "type": "string" },
          "input": {},
          "expectedOutput": {}
        },
        "required": ["description"]
      }
    }
  },
  "required": ["componentName", "code", "props"]
}
```

---

## Example 6: Standalone usage (without pi-delegate)

Use `pi-structured-output` without `pi-delegate` by setting environment variables directly.

```bash
export PI_OUTPUT_SCHEMA='{"type":"object","properties":{"summary":{"type":"string"},"keyPoints":{"type":"array","items":{"type":"string"}},"sentiment":{"type":"string","enum":["positive","negative","neutral"]}},"required":["summary","keyPoints"]}'
export PI_OUTPUT_FILE=/tmp/pi-structured-result.json

pi run --agent my-agent "Analyze this article and provide a summary, key points, and overall sentiment."
```

**Prompt inside the child agent:**
```
You have a structured_output tool available. When you've completed the analysis,
call structured_output({ output: { summary, keyPoints, sentiment } })
with the results matching the expected schema.
```

**Read the result:**
```bash
cat /tmp/pi-structured-result.json
# -> { "summary": "...", "keyPoints": [...], "sentiment": "positive" }
```

---

## Example 7: Nested delegation with structured output

A coordinator agent delegates subtasks, each returning typed output, then synthesizes.

**Agent definition** (`coordinator.md`):
```markdown
---
name: coordinator
description: Research coordinator that delegates to specialists
model: claude-opus
delegateAgents: [summarizer, fact-checker, sentiment-analyzer]
---

You are a research coordinator. Gather information by delegating to specialist agents.
Each specialist returns structured data. Synthesize their outputs into a final report.

When calling delegate, always provide an outputSchema so you get typed results back.
Then combine the structuredOutput values into your final analysis.
```

**Prompt:**
```
Use the coordinator agent to research the latest developments in quantum computing.
Start by delegating to summarizer, fact-checker, and sentiment-analyzer specialists
with appropriate outputSchemas, then synthesize a final report.
```

---

## Environment variables reference

| Variable | Purpose |
|----------|---------|
| `PI_OUTPUT_SCHEMA` | JSON Schema string. When set, the `structured_output` tool is registered in the child process. |
| `PI_OUTPUT_FILE` | Path where the tool writes its JSON payload. Must be writable by the child process. |

Both are set automatically by `pi-delegate` when you provide an `outputSchema` — you only need to set them manually for standalone usage (Example 6).
