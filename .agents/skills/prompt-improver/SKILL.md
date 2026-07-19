---
name: prompt-improver
description: Enriches vague prompts with targeted research and clarification before execution. Use when a prompt is underspecified, ambiguous, or lacks sufficient context to act on confidently.
---

# Prompt Improver Skill

## Purpose

Transform vague, ambiguous prompts into actionable, well-defined requests through systematic research and targeted clarification. This skill is invoked when the nudge engine has already determined a prompt needs enrichment.

## When This Skill is Invoked

**Automatic invocation:**
- sbdt's nudge engine evaluates the prompt on submission
- The `improve` nudge determines the prompt is vague (missing specifics, context, or clear target)
- The nudge wrapper instructs the model to research and ask clarifying questions

**Manual invocation:**
- To enrich a vague prompt with research-based questions
- When prompt lacks sufficient context even with conversation history

**Assumptions:**
- Prompt has already been identified as vague
- Evaluation phase is complete (done by nudge engine)
- Proceed directly to research and clarification

## Core Workflow

### Phase 1: Research

Gather context before asking questions. Use sbdt's tools:

1. **Check conversation history first** — Review recent session messages to avoid redundant exploration
2. **Explore the codebase** if needed:
   - Serena (`get_symbols_overview`, `find_symbol`) for code structure and symbol lookup
   - Codebase Memory (`search_graph`, `get_architecture`, `trace_path`) for architecture, callers/callees, impact analysis
   - `ripgrep_search` for text/regex patterns across files
   - `ast_grep_search` for structural code search
   - `read_text_file` for specific files (use `head`/`tail` for targeted reads)
3. **Gather additional context** as needed:
   - Read local documentation files
   - `WebSearch` for best practices and current information
4. **Document findings** to ground questions in actual project context

**Critical Rules:**
- NEVER skip research
- Check conversation history before exploring codebase
- Questions must be grounded in actual findings, not assumptions
- Use the narrowest tool that answers the question

### Phase 2: Generate Targeted Questions

Based on research findings, formulate 1-3 questions that will clarify the ambiguity.

**Question Guidelines:**
- **Grounded**: Every option comes from research (codebase findings, documentation, patterns)
- **Specific**: Avoid vague options like "Other approach"
- **Multiple choice**: Provide 2-4 concrete options per question
- **Focused**: Each question addresses one decision point
- **Contextual**: Include brief explanations of trade-offs

### Phase 3: Get Clarification

Use the `AskUserQuestion` tool to present your research-grounded questions.

**Format:**
```
questions: [
  {
    question: "Clear, specific question ending with ?",
    multiSelect: false,
    options: [
      { label: "Concise choice", description: "Context about this option" },
      { label: "Another choice", description: "Why this option, tradeoffs" }
    ]
  }
]
```

### Phase 4: Execute with Context

Proceed with the original user request using:
- Original prompt intent
- Clarification answers from user
- Research findings and context
- Conversation history

Execute the request as if it had been clear from the start.

## Key Principles

1. **Assume Vagueness**: Skill is only invoked for vague prompts
2. **Research First**: Always gather context before formulating questions
3. **Ground Questions**: Use research findings, not assumptions
4. **Be Specific**: Provide concrete options from actual codebase/context
5. **Stay Focused**: Max 1-3 questions, each addressing one decision point
6. **Systematic**: Follow 4-phase workflow (Research → Questions → Clarify → Execute)

## Progressive Disclosure

This SKILL.md contains the core workflow. For deeper guidance, see:
- `references/question-patterns.md` — Question templates and effective patterns
- `references/research-strategies.md` — Context gathering strategies
- `references/examples.md` — Real prompt transformations

Load these references only when detailed guidance is needed.
