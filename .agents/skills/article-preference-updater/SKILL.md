---
name: article-preference-updater
description: Update this project's article preference and first-stage LLM filtering workflow. Use when Codex is asked to learn from `.data/items.json` and `.data/preferences.json`, evolve `.data/preference-guidelines.md` or `.data/preference-guidelines.json`, refine article filtering rules, debug `llm_filter_rule_ids` or `llm_filter_reason`, or calibrate the digest LLM for broader retrieved article topics.
---

# Article Preference Updater

## Mission

Maintain the reusable preference-learning workflow for this repository. The goal is not to summarize articles; it is to keep the downstream article-filtering LLM aligned with the user's evolving taste while preserving debuggable decisions.

## Repository Contract

- Runtime article records live in `.data/items.json`.
- User labels live in `.data/preferences.json`.
- The generated LLM prompt artifact is `.data/preference-guidelines.md`.
- Structured rule evidence lives in `.data/preference-guidelines.json`.
- Digest generation refreshes guidelines before LLM curation through `src/lib/digest.js`.
- The LLM curation output stores `llm_filter_rule_ids` and `llm_filter_reason` on items for debugging.

## Workflow

1. Inspect the current state:
   - Read `src/lib/preference-guidelines.js`, `src/lib/summarizer.js`, and `README.md` before editing.
   - Inspect `.data/preference-guidelines.json` only for generated shape and current rule quality; do not hard-code its current contents.
   - Check `git status --short` and avoid unrelated local changes.
2. Preserve the two-layer design:
   - Deterministic code prepares compact evidence, examples, and fallback rules.
   - The LLM synthesizes the actual evolving guideline from evidence and prior rules when `OPENAI_API_KEY` is available.
   - If OpenAI is unavailable, write a clearly marked `deterministic_fallback`; do not present fallback rules as the intended final mode.
3. Keep rules semantic and debuggable:
   - Prefer rules such as "raise X when concrete system detail is present" over plain keyword allowlists or blocklists.
   - Treat mixed evidence as caution rules, not hard rejects.
   - Keep stable rule IDs when meaning is unchanged; introduce new IDs when meaning changes materially.
   - Require curation responses to cite `filter_rule_ids` and explain with `filter_reason`.
4. Update implementation with narrow edits:
   - Put reusable logic in `src/lib/preference-guidelines.js`.
   - Keep LLM application logic in `src/lib/summarizer.js`.
   - Surface user-visible trace data through `src/lib/item-store.js` and `public/app.js` only when needed.
   - Document operator commands in `README.md`.
5. Validate:
   - Run `npm test`.
   - Run `npm run guidelines`.
   - If the guidelines command falls back because network is blocked and LLM synthesis is required, rerun it with the necessary approval instead of accepting the fallback silently.
   - Confirm `.data/preference-guidelines.json` has `generated_by: "llm_synthesis"` when the user expects an LLM-updated artifact.

## Final Response

Report:

- Files changed.
- Whether the generated guideline used `llm_synthesis` or `deterministic_fallback`.
- Test commands and results.
- Any remaining uncertainty about weak preference signals or unavailable LLM/network access.

Keep the final response concise. Do not include a long plan unless the user explicitly asks for one.
