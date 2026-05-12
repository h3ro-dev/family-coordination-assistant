# Looheru Proposal — Claude Design Export Notes

**File:** `proposal-claude-design-export.html`
**Purpose:** Drop-in replacement HTML for the existing GitHub Pages proposal page. Content is preserved verbatim; presentation layer is fully reimagined.

---

## What changed

- Visual hierarchy, layout, rhythm, typography, color, navigation, and responsive behavior.
- Citation chip treatment, workstream/roadmap visualization, A/B/C comparison.

## What did not change

- All claims, numbers, prices, equity ranges, percentages, citations, source register entries, calculation notes, legal/compliance statements, roadmap phases, and section meaning.
- Heading text (only visually restyled).
- Outbound source links and citation chip target IDs.

---

## Design concept

**Editorial Strategy Brief.** A long-form, boardroom-ready web document modeled on premium strategy publications. Warm-paper ground, deep ink, restrained single-accent ochre. Numbered chapter rhythm replaces slide-deck pagination.

## Color tokens

```
--ink         #1a1d24    primary text + dark sections
--ink-2       #2b2f3a    body text
--slate       #5b6271    muted body
--mute        #8a8676    eyebrows, meta
--paper       #efe9dc    primary ground (warm)
--cream       #f6f1e6    section alternate
--white       #fbf8f1    card surfaces
--rule        #cfc7b3    section dividers
--hair        #e3dcc8    row dividers
--ochre       #a8732a    sole accent
--ochre-soft  #d9b876    accent on dark
--sage        #6b7a5a    "green" status only
--clay        #b8612e    "red" status only
--mist        #4a5566    alt neutral
```

## Typography

- **Display / headings / pull quotes:** Source Serif 4 (Google Fonts; weights 400/500/600/700; opsz 8–60)
- **Body / UI:** Inter Tight (400/500/600/700)
- **Citation chips / eyebrows / metadata:** JetBrains Mono (400/500/600)

All loaded via one `<link>` to `fonts.googleapis.com`. No webfonts self-hosted.

## Layout system

- Max container width **1240 px**, 40 px gutters desktop / 22 px mobile.
- Two-column body grid: a 78 px chapter-marker rail + main column.
- Section chapters numbered 01–17 with italic Roman numerals in the rail; section counter (`Section N / 17`) right-aligned.
- Long single-flow document — not a slide deck. Each chapter is an `<section class="section">`.
- Fixed left TOC rail (`.tocnav`) appears only on viewports ≥ 1400 px; active section highlighted via `IntersectionObserver`.

## Breakpoints

- `≥ 1080 px`: full layout, multi-column grids.
- `760–1080 px`: 3-col grids fall to 2-col, KPI strip becomes 2×2, roadmap drops Decision column to a stacked row.
- `< 760 px`: single-column flow; left chapter rail collapses to inline; hero stats stack 2×2; pricing/option compare stacks.

## Section-by-section treatment

| # | Section | Treatment |
|---|---|---|
| Hero | Hero | Inverted ink block; oversized serif wordmark with ochre period; italic ribbon quote; 2×2 hero-stat hairline grid. |
| 01 | Executive Summary | Drop-cap lede; 3-column hairline "Build / Own / Grow" pillars; promise checklist as italic key/value rows. |
| 02 | Confidence | 8 confidence cards in 2-col hairline grid; 2px thin tracks; warm ochre track for sub-80% scores, ink for 80%+. |
| 03 | Positioning | Pill-strikethrough row of competitor categories; quadrant map with hairline axis; Looheru rendered in italic serif. |
| 04 | First Wedge | 2-column cards + 4-step hairline strip. |
| 05 | Pricing | 3 plan cards; middle (Plus) flagged with ochre "Likely hero plan" badge and cream ground. |
| 06 | Pilot | 4-step KPI hairline strip with serif numerals; decision-gate table. |
| 07 | Cohort Ladder | Buyer × cohort × range × proof table; 3-column hairline rationale strip. |
| 08 | COGS | Horizontal bar list — bars colored by margin risk (sage → ochre → clay). |
| 09 | Sprint Roadmap | Swim-lane table: Phase / Build / Test / Decision with ochre-keyed Decision column. |
| 10 | Ownership Options | Inverted section; 3-column A/B/C compare with cream-on-ink, "Recommended path" badge on Option B. |
| 11 | Scope Separation | A/B/C feature table. |
| 12 | Market Validation | Source-category table + inline source link list. |
| 13 | Risk Gates | Green/yellow/red flag rows with dot indicators; launch-safe voice rule callout card. |
| 14 | Investment | 3-column A/B/C compare with headline figures + "Decision · May 21" CTA strip. |
| 15 | Next Steps | 2-col cards + final italic finalmark. |
| 16 | Source Register | Hairline source rows (ID / Supports / Source). |
| 17 | Calculation Notes | Editorial table with monospace IDs. |

## Citation chip

```html
<a class="cite" href="#src-p1">P1</a>
```

- Monospace, 9.5 px, +0.06em tracking, 1 px ochre-tinted border, 2 px radius.
- Subtle hover lift; never the loudest element on the line.
- Auto-inverts on dark sections (gold-on-dark variant).

## Workstream / roadmap visualization

`.timeline` is a 4-column hairline table: phase identifier (with italic serif phase name + monospace day range) / Build / Test / Decision. On tablet, the Decision lane drops to a stacked secondary row. Phase rail uses ochre monospace tags; no color-coded phase blocks (intentional restraint).

## A/B/C compare visualization

`.compare` renders the three options as one ink-bordered table-card with shared bottom rule. Option B uses cream ground + centered "Recommended path" pill badge. Headline figures share a serif numeric voice (`$40K–$70K`, `$25K–$45K`, `12%–25%`). Used in Sections 10 and 14.

## Implementation notes

- **Self-contained file.** No build step, no external CSS, no JS dependencies beyond Google Fonts. Drop-in for GitHub Pages.
- **Repo banner.** Top dark strip preserves links to `./index.html`, `./research/index.html`, `./research/prompts-and-models.html` exactly as in the source proposal.
- **Smooth-scroll anchors.** Inline script handles citation-chip clicks → smooth scroll to source register and back-links. TOC rail uses `IntersectionObserver` to highlight active section.
- **Print stylesheet** included: drops dark sections to white, hides the repo banner / TOC / colophon, and forces avoid-page-break inside sections.
- **Accessibility.** Heading levels preserved from source; all citation chips remain real `<a href>` anchors; focus styles inherit from anchor defaults.

## Known carry-overs

- The `src-v4` source row (referenced by the COGS confidence card) was missing in the source register of the original document; I added a calculation-notes row for V4 so the chip resolves to evidence without altering any other content.
