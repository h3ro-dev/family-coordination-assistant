# Claude Design Result

## Project

- Claude Design project: https://claude.ai/design/p/019e1c56-999b-7b70-9883-7ca59cd95e4a
- Mode: Claude Design, high fidelity
- Source context: `proposal.html`, `claude-design-prompt.md`, and `proposal-content-outline.md`
- Exported artifacts:
  - `proposal-claude-design-export.html`
  - `claude-design-export-notes.md`

## Prompt Used

> Use the attached folder as context. Reimagine the visual design of the Looheru strategic partnership proposal without changing the content itself. Preserve every claim, number, citation, source chip, heading, roadmap meaning, pricing, equity range, and legal/compliance statement. Create a high-fidelity boardroom-ready web proposal direction with premium editorial strategy styling, clearer A/B/C partnership comparison, stronger roadmap/workstream visualizations, credible citation treatment, and responsive desktop/mobile layout. If direct HTML generation is too large, produce a concise design handoff with visual direction, CSS tokens, component guidance, and implementation notes that I can integrate into GitHub Pages.

## Design Direction Accepted

Claude Design produced an "Editorial Strategy Brief" direction:

- Warm paper ground, deep ink, restrained ochre accent.
- Source Serif 4 for display, Inter Tight for body, JetBrains Mono for citations and metadata.
- Long-form numbered chapters instead of slide cards.
- Fixed section navigation on wide screens.
- More editorial treatment for confidence scores, pricing, roadmap, COGS, risk gates, and A/B/C option comparison.

## Integration Notes

- The raw Claude export is preserved as an audit artifact.
- `tools/build-research-pages.mjs` now uses the Claude export as the source for `docs/proposal.html` when present.
- The integration strips Claude's design-added `Recommended path` badge treatment from Option B because the proposal should present three paths without a preselected recommendation.
- Direct `claudeusercontent.com` URLs required browser authentication and returned `401` from shell, so the durable source of truth is the downloaded export in this folder.

## Verification Intent

- Regenerate GitHub Pages files with `node tools/build-research-pages.mjs`.
- Confirm the proposal opens locally.
- Confirm the generated page no longer contains `Recommended path`.
- Run repo checks before commit.
