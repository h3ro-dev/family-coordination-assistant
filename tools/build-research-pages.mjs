import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const tamaraRoot = process.env.TAMARA_PROJECT_ROOT || path.resolve(repoRoot, "..", "..", "Tamara project");
const docsDir = path.join(repoRoot, "docs");
const researchDir = path.join(docsDir, "research");
const designHandoffDir = path.join(docsDir, "design-handoff");
const claudeDesignExportPath = path.join(designHandoffDir, "proposal-claude-design-export.html");

const traceId = "trc_20260512_183321Z_17qarn3x";
const issueUrl = "https://github.com/h3ro-dev/family-coordination-assistant/issues/17";
const issueLabel = "Issue #17";

const sourceDocs = [
  {
    file: "00-source-map.md",
    title: "Source Map",
    type: "Evidence map",
    model: "Codex GPT-5 local mailbox, file, repo, and public-source synthesis",
    sensitivity: "Private source - public page includes summary only",
    questions: [
      "Which inboxes, public sources, repo files, and local artifacts contained evidence?",
      "Which sources should be treated as private versus public-safe?"
    ],
    summary:
      "Mapped the evidence base for the Looheru opportunity, separating mailbox-derived context, local project files, public founder/company context, and the associated February app repo."
  },
  {
    file: "01-email-research-brief.md",
    title: "Email Research Brief",
    type: "Private evidence synthesis",
    model: "Codex GPT-5 local mailbox synthesis",
    sensitivity: "Private source - raw email content not published",
    questions: [
      "What information did Tamara send about the project and company?",
      "What commitments, assets, and unresolved questions were visible in the email trail?"
    ],
    summary:
      "Consolidated private email-derived facts into a working brief for strategy, partnership, and diligence. The raw source remains outside the public repo."
  },
  {
    file: "02-founder-and-public-context.md",
    title: "Founder And Public Context",
    type: "Founder/public context",
    model: "Codex GPT-5 plus public web research",
    sensitivity: "Public-safe summary with private details removed",
    questions: [
      "What public context supports founder-market fit?",
      "Which claims should be verified with Tamara before publishing?"
    ],
    summary:
      "Summarized public-facing founder credibility, healthcare AI context, and distribution hypotheses while flagging private or approval-required claims."
  },
  {
    file: "03-product-strategy-market.md",
    title: "Product Strategy And Market",
    type: "Strategy synthesis",
    model: "Codex GPT-5 synthesis from private packet and public market research",
    sensitivity: "Public-safe summary only",
    questions: [
      "What category is Looheru actually in?",
      "What wedge, ICP, pricing, GTM, and partnership questions matter most?"
    ],
    summary:
      "Positioned Looheru as an execution-first family coordination layer, not a calendar, marketplace, spouse-nudging tool, or generic assistant."
  },
  {
    file: "04-strategic-questions.md",
    title: "Strategic Questions",
    type: "Question bank",
    model: "Codex GPT-5 synthesis",
    sensitivity: "Public-safe after removing private names/details",
    questions: [
      "What strategy, pricing, GTM, product, legal, and partnership questions remain?",
      "Which questions should drive the next founder meeting?"
    ],
    summary:
      "Organized the open questions needed before moving from prototype to pilot and from vendor discussion to equity-bearing partnership."
  },
  {
    file: "05-github-project-integration.md",
    title: "GitHub Project Integration",
    type: "Repo mapping",
    model: "Codex GPT-5 with local git inspection",
    sensitivity: "Public-safe",
    questions: [
      "Which GitHub repo is associated with the February prototype?",
      "Where should public-safe strategy artifacts live?"
    ],
    summary:
      "Identified the associated repo as h3ro-dev/family-coordination-assistant and recommended keeping raw private research outside the public repo."
  },
  {
    file: "06-friday-meeting-strategy-notes.md",
    title: "Friday Meeting Strategy Notes",
    type: "Transcript synthesis",
    model: "Codex GPT-5 transcript synthesis",
    sensitivity: "Private source - raw transcript not published",
    questions: [
      "What did we promise to bring back after the Friday meeting?",
      "What did the transcript imply about ICP, monetization, voice, partnership, and May 21 deliverables?"
    ],
    summary:
      "Converted the noisy meeting transcript into a strategy source while avoiding raw transcript publication in the public repo."
  },
  {
    file: "07-gpt-55-pro-research-prompts.md",
    title: "GPT 5.5 Pro Research Prompt Pack",
    type: "Prompt pack",
    model: "Codex GPT-5 prompt preparation for GPT 5.5 Pro Deep Research",
    sensitivity: "Public-safe prompt summaries",
    questions: [
      "What focused research prompts should be run before the follow-up meeting?",
      "Which research lanes map to the promises from the Friday meeting?"
    ],
    summary:
      "Prepared nine deep-research prompts covering strategy, monetization, COGS, competitors, ICP, AI voice risk, partnership structures, pilot design, and public-safe repo artifacts."
  },
  {
    file: "08-copy-paste-gpt-55-pro-prompts.md",
    title: "Copy/Paste GPT 5.5 Pro Prompts",
    type: "Prompt pack",
    model: "Codex GPT-5 prompt preparation for GPT 5.5 Pro Deep Research",
    sensitivity: "Prompt summaries only; private attachment paths redacted from public pages",
    questions: [
      "How can the prompts be made self-contained enough to paste directly into GPT 5.5 Pro?",
      "Which project folders and context should be attached?"
    ],
    summary:
      "Created self-contained GPT 5.5 Pro prompts with attachment guidance and project context for repeatable research runs."
  },
  {
    file: "09-gpt-55-results-synthesis.md",
    title: "GPT 5.5 Results Synthesis",
    type: "Research synthesis",
    model: "Codex GPT-5 synthesis of GPT 5.5 Pro Deep Research outputs",
    sensitivity: "Public-safe summary only",
    questions: [
      "What did the completed GPT 5.5 Pro research outputs add?",
      "Which recommendations changed after the model outputs were reviewed?"
    ],
    summary:
      "Synthesized completed GPT 5.5 Pro outputs for monetization, COGS, competitors, AI voice/legal risk, and partnership structures."
  },
  {
    file: "10-revised-follow-up-prompts.md",
    title: "Revised Follow-Up Prompts",
    type: "Prompt pack",
    model: "Codex GPT-5 prompt preparation for GPT 5.5 Pro Deep Research",
    sensitivity: "Public-safe prompt summaries",
    questions: [
      "What research should be run after the first GPT 5.5 Pro outputs?",
      "Which prompts should replace the original remaining prompts?"
    ],
    summary:
      "Converted the first research cycle into revised prompts for paid pilot/user research, May 21 decision-making, legal issue spotting, and a public-safe repo artifact."
  },
  {
    file: "11-may-21-decision-memo.md",
    title: "May 21 Decision Memo",
    type: "Decision memo",
    model: "Codex GPT-5 synthesis",
    sensitivity: "Private source - public summary only",
    questions: [
      "What should we recommend for the May 21 working session?",
      "What must be true before deeper partnership or voice expansion?"
    ],
    summary:
      "Reframed the next meeting around Build / Own / Grow and a 30-60 day Build + Own Sprint before deeper operating commitments."
  },
  {
    file: "12-tamara-full-strategy-report.md",
    title: "Full Strategy Report",
    type: "Founder-facing report",
    model: "Codex GPT-5 synthesis using GPT 5.5 Pro results and repo inspection",
    sensitivity: "Proposal source - review before external sharing",
    questions: [
      "How do we answer each promised research item in a full report to Tamara?",
      "How should the confidence levels, partnership options, voice gates, and pilot plan be explained?"
    ],
    summary:
      "Full in-depth report covering positioning, first wedge, market, monetization, COGS, GTM, AI voice, partnership options, sprint scope, confidence scoring, and decisions needed."
  },
  {
    file: "13-targeted-gpt-55-confidence-research-prompts.md",
    title: "Targeted GPT 5.5 Confidence Prompts",
    type: "Prompt pack",
    model: "Codex GPT-5 prompt preparation for GPT 5.5 Pro Deep Research",
    sensitivity: "Public-safe prompt summaries",
    questions: [
      "What additional research would materially increase confidence?",
      "How should ownership, pilot/GTM, and AI voice/data risk be researched?"
    ],
    summary:
      "Prepared three targeted prompts for ownership/control economics, paid pilot/GTM/sponsored cohorts, and counsel-ready AI voice/healthcare/data risk."
  },
  {
    file: "14-targeted-research-integration.md",
    title: "Targeted Research Integration",
    type: "Research integration",
    model: "Codex GPT-5 synthesis of targeted GPT 5.5 Pro outputs",
    sensitivity: "Public-safe summary only",
    questions: [
      "How should the targeted GPT 5.5 Pro outputs change the proposal?",
      "What recommendations became stronger or weaker?"
    ],
    summary:
      "Integrated the ownership memo, GTM pilot program, and voice compliance report into the strategy report and proposal."
  },
  {
    file: "15-problem-solving-skill-application.md",
    title: "Problem-Solving Skill Application",
    type: "Decision-quality pass",
    model: "Codex GPT-5 using local problem-solving skills",
    sensitivity: "Public-safe",
    questions: [
      "Which local problem-solving skills improve confidence?",
      "What assumptions should be inverted, stress-tested, or simplified?"
    ],
    summary:
      "Applied local skills including inversion, scale testing, simplification cascades, meta-pattern recognition, collision-zone thinking, and stuck-type dispatch."
  },
  {
    file: "16-github-problem-solving-system-application.md",
    title: "GitHub Problem-Solving System Application",
    type: "Decision-quality pass",
    model: "Codex GPT-5 with GitHub repo review",
    sensitivity: "Public-safe",
    questions: [
      "What additional decision skills exist in the CryptoJym/problem-solving-system repo?",
      "How should the nine-skill stack change our confidence and recommendation?"
    ],
    summary:
      "Applied the external nine-skill problem-solving system to the Looheru decision, reframing the sprint as an evidence machine."
  },
  {
    file: "17-autonomous-onboarding-and-voice-phase-reevaluation.md",
    title: "Autonomous Onboarding And Voice Phase Reevaluation",
    type: "Product roadmap update",
    model: "Codex GPT-5 with May 2026 OpenAI, xAI, and Google source checks",
    sensitivity: "Public-safe summary",
    questions: [
      "What changes if Looheru does not want routine human escalation?",
      "How should the voice phases change based on May 11, 2026 voice-agent capability shifts?"
    ],
    summary:
      "Updated the product stance toward autonomous onboarding, parent handoff only when blocked, earlier parent-facing voice, and phased outbound voice."
  },
  {
    file: "18-market-grounded-partnership-and-tech-options.md",
    title: "Market-Grounded Partnership And Technology Options",
    type: "Partnership and roadmap update",
    model: "Codex GPT-5 with repo inspection and market/legal source checks",
    sensitivity: "Proposal source - review before external sharing",
    questions: [
      "What if Utlyze / SolutionStream wants equity up front?",
      "What partnership structures are fair by market tradition?",
      "How should the current repo baseline change the voice roadmap?"
    ],
    summary:
      "Replaced the previous partnership stance with three market-grounded paths, including Option B: Strategic Build Partner."
  },
  {
    file: "19-current-market-validation-and-option-scope.md",
    title: "Current Market Validation And Option Scope",
    type: "Market validation and proposal revision",
    model: "Codex GPT-5 with May 2026 web/source checks",
    sensitivity: "Proposal source - review before external sharing",
    questions: [
      "Are the A/B/C partnership option costs and equity ranges aligned with current market expectations?",
      "What is included and excluded in each option?",
      "What additional research questions would further refine the proposal?"
    ],
    summary:
      "Repriced and separated the partner options using current software build, SaaS MVP, fractional CTO, advisor-equity, technical partner, venture-studio, and voice-AI market signals."
  },
  {
    file: "20-ai-native-roadmap-pricing-architecture.md",
    title: "AI-Native Roadmap Pricing Architecture",
    type: "Roadmap and pricing architecture revision",
    model: "Codex GPT-5 with May 2026 AI-development source checks",
    sensitivity: "Proposal source - review before external sharing",
    questions: [
      "Should the pricing architecture define the roadmap path, build scope, tests, and phases?",
      "How should AI-assisted development trends lower the first-sprint cash ranges?",
      "Which systems belong in the 6-8 week sprint versus later phases?"
    ],
    summary:
      "Reframed the first engagement as an AI-native Build + Test Sprint with build/test/decision gates and lower first-sprint pricing, while reserving larger budgets for later roadmap phases."
  },
  {
    file: "21-proposal-source-and-calculation-methodology.md",
    title: "Proposal Source And Calculation Methodology",
    type: "Citation and methodology pass",
    model: "Codex GPT-5 with current source checks and local proposal synthesis",
    sensitivity: "Public-safe source and calculation summary",
    questions: [
      "Which source supports each material proposal number and strategic claim?",
      "How were the partner pricing, COGS, pilot, sponsored cohort, and confidence calculations derived?"
    ],
    summary:
      "Adds a source register and calculation methodology for proposal pricing, equity, COGS, pilot thresholds, sponsored cohorts, roadmap scope, vendor assumptions, and legal/product risk gates."
  },
  {
    file: "TRACKER.md",
    title: "Research Tracker",
    type: "Audit trail",
    model: "Codex GPT-5 working-session tracker",
    sensitivity: "Public summary only",
    questions: [
      "What work was done, when, and with which trace IDs?",
      "What verification was run after each update?"
    ],
    summary:
      "Maintains the local durable record of the Looheru research packet, source additions, proposal integrations, and verification passes."
  },
  {
    file: "deep-research-results/02-monetization-strategy.md",
    title: "Monetization Strategy",
    type: "GPT 5.5 Pro result",
    model: "GPT 5.5 Pro Deep Research",
    sensitivity: "Public-safe summary only",
    questions: [
      "What B2C, usage-based, concierge, employer/community, and hybrid pricing models make sense?",
      "What three pricing packages should be tested?"
    ],
    summary:
      "Deep research output used to shape the consumer pricing ladder, task-credit logic, and paid pilot pricing hypotheses."
  },
  {
    file: "deep-research-results/03-cogs-unit-economics.md",
    title: "COGS And Unit Economics",
    type: "GPT 5.5 Pro result",
    model: "GPT 5.5 Pro Deep Research",
    sensitivity: "Public-safe summary only",
    questions: [
      "What are the task-level cost drivers for SMS, email, AI, voice, hosting, and support?",
      "Which workflows are profitable under likely subscription tiers?"
    ],
    summary:
      "Deep research output used to separate low telecom/email costs from the real margin risks: failed automation, voice, browser work, and support burden."
  },
  {
    file: "deep-research-results/04-competitive-intelligence-report.md",
    title: "Competitive Intelligence Report",
    type: "GPT 5.5 Pro result",
    model: "GPT 5.5 Pro Deep Research",
    sensitivity: "Public-safe summary only",
    questions: [
      "Who are the direct and indirect competitors?",
      "Where is the white space for an execution-first parent assistant?"
    ],
    summary:
      "Deep research output used to distinguish Looheru from calendars, care marketplaces, family organization tools, virtual assistant services, and generic AI assistants."
  },
  {
    file: "deep-research-results/06-ai-voice-legal-product-risk.md",
    title: "AI Voice Legal And Product Risk",
    type: "GPT 5.5 Pro result",
    model: "GPT 5.5 Pro Deep Research",
    sensitivity: "Public-safe summary only",
    questions: [
      "What legal and product risks matter for AI voice calls?",
      "Which workflows should be allowed, gated, or blocked?"
    ],
    summary:
      "Deep research output used to frame AI disclosure, telecom, recording, consent, consumer health data, HIPAA-boundary, and product-gating issues."
  },
  {
    file: "deep-research-results/07-partnership-structures.md",
    title: "Partnership Structures",
    type: "GPT 5.5 Pro result",
    model: "GPT 5.5 Pro Deep Research",
    sensitivity: "Public-safe summary only",
    questions: [
      "What partnership structures are available between Tamara and Utlyze / SolutionStream?",
      "What are fair advisor, fractional CTO, studio, warrant, revenue-share, and cash structures?"
    ],
    summary:
      "Deep research output used to shape the original partnership menu and later refine it into three clean paths."
  },
  {
    file: "deep-research-results/13-ownership-recommendation-memo.md",
    title: "Ownership Recommendation Memo",
    type: "Targeted GPT 5.5 Pro result",
    model: "GPT 5.5 Pro Deep Research / extended-thinking research run",
    sensitivity: "Public-safe summary only",
    questions: [
      "How should ownership, IP, accounts, data, and decision rights work in the next 90 days?",
      "What market norms should anchor advisor, fractional CTO, and studio equity?"
    ],
    summary:
      "Targeted research output used to sharpen founder control, IP/account ownership, equity vesting, and clean offboarding recommendations."
  },
  {
    file: "deep-research-results/14-gtm-pilot-program.md",
    title: "GTM Strategy And Pilot Program",
    type: "Targeted GPT 5.5 Pro result",
    model: "GPT 5.5 Pro Deep Research / extended-thinking research run",
    sensitivity: "Public-safe summary only",
    questions: [
      "What should the paid pilot look like?",
      "How should sponsored cohorts be designed after B2C proof?"
    ],
    summary:
      "Targeted research output used to specify the 18-24 family paid pilot, activation metrics, stop/pivot thresholds, and sponsored cohort ladder."
  },
  {
    file: "deep-research-results/15-voice-ai-compliance-product-gating.md",
    title: "Voice AI Compliance And Product Gating",
    type: "Targeted GPT 5.5 Pro result",
    model: "GPT 5.5 Pro Deep Research / extended-thinking research run",
    sensitivity: "Public-safe summary only",
    questions: [
      "What is safe enough for MVP voice?",
      "What should be gated, blocked, or validated by counsel before scale?"
    ],
    summary:
      "Targeted research output used to define launch-safe voice rules, no-recording/no-raw-transcript posture, line-type checks, opt-out, and prohibited workflows."
  }
];

const promptRuns = [
  {
    group: "Original GPT 5.5 Pro prompt pack",
    prompt: "Prompt 1: Master Strategy Research",
    model: "GPT 5.5 Pro Deep Research",
    status: "Prepared; no completed output was provided in the local packet",
    question:
      "Research whether Looheru is a venture-scale opportunity or narrower services/SaaS opportunity."
  },
  {
    group: "Original GPT 5.5 Pro prompt pack",
    prompt: "Prompt 2: Monetization And Pricing",
    model: "GPT 5.5 Pro Deep Research",
    status: "Completed; output copied to deep-research-results/02-monetization-strategy.md",
    question:
      "Design B2C, usage-cap, concierge, employer/community, and hybrid pricing options and pilot tests."
  },
  {
    group: "Original GPT 5.5 Pro prompt pack",
    prompt: "Prompt 3: COGS And Unit Economics",
    model: "GPT 5.5 Pro Deep Research",
    status: "Completed; output copied to deep-research-results/03-cogs-unit-economics.md",
    question:
      "Model task-level telecom, email, AI, voice, hosting, payment, and support costs by workflow."
  },
  {
    group: "Original GPT 5.5 Pro prompt pack",
    prompt: "Prompt 4: Competitor And Substitute Matrix",
    model: "GPT 5.5 Pro Deep Research",
    status: "Completed; output copied to deep-research-results/04-competitive-intelligence-report.md",
    question:
      "Map competitors and substitutes across parent tech, AI assistants, care marketplaces, concierge services, and employer benefits."
  },
  {
    group: "Original GPT 5.5 Pro prompt pack",
    prompt: "Prompt 5: ICP, User Research, And Willingness To Pay",
    model: "GPT 5.5 Pro Deep Research",
    status: "Prepared; superseded by targeted pilot/GTM prompt",
    question:
      "Define the initial ICP, user research plan, survey/interview approach, and willingness-to-pay tests."
  },
  {
    group: "Original GPT 5.5 Pro prompt pack",
    prompt: "Prompt 6: AI Voice Calls, Consent, And Compliance",
    model: "GPT 5.5 Pro Deep Research",
    status: "Completed; output copied to deep-research-results/06-ai-voice-legal-product-risk.md",
    question:
      "Assess AI voice calls, consent, telecom, privacy, healthcare boundaries, and launch gates."
  },
  {
    group: "Original GPT 5.5 Pro prompt pack",
    prompt: "Prompt 7: Partnership Structures With Utlyze / SolutionStream",
    model: "GPT 5.5 Pro Deep Research",
    status: "Completed; output copied to deep-research-results/07-partnership-structures.md",
    question:
      "Compare cash, fractional CTO, advisor, venture studio, warrant, and revenue-share structures."
  },
  {
    group: "Original GPT 5.5 Pro prompt pack",
    prompt: "Prompt 8: Pilot Design And Build Roadmap",
    model: "GPT 5.5 Pro Deep Research",
    status: "Prepared; superseded by targeted pilot/GTM prompt",
    question:
      "Design the pilot and build roadmap for the first 30-60 days."
  },
  {
    group: "Original GPT 5.5 Pro prompt pack",
    prompt: "Prompt 9: Public-Safe Repo Research Artifact",
    model: "GPT 5.5 Pro Deep Research",
    status: "Prepared; fulfilled by this GitHub Pages appendix",
    question:
      "Create a public-safe strategy artifact suitable for the associated GitHub repo."
  },
  {
    group: "Targeted confidence research",
    prompt: "Prompt 1: Ownership, Control, And Partnership Economics",
    model: "GPT 5.5 Pro Deep Research / extended-thinking research run",
    status: "Completed; output copied to deep-research-results/13-ownership-recommendation-memo.md",
    question:
      "Make ownership, entity/IP/account/data control, economics, and counsel-prep recommendations explicit."
  },
  {
    group: "Targeted confidence research",
    prompt: "Prompt 2: Paid Pilot, GTM, And Sponsored Cohort Design",
    model: "GPT 5.5 Pro Deep Research / extended-thinking research run",
    status: "Completed; output copied to deep-research-results/14-gtm-pilot-program.md",
    question:
      "Turn the B2C pilot and sponsored cohort path into a concrete operating plan."
  },
  {
    group: "Targeted confidence research",
    prompt: "Prompt 3: Counsel-Ready AI Voice, Healthcare, And Data Risk Plan",
    model: "GPT 5.5 Pro Deep Research / extended-thinking research run",
    status: "Completed; output copied to deep-research-results/15-voice-ai-compliance-product-gating.md",
    question:
      "Prepare a legal/product risk plan and engineering acceptance criteria for AI voice and healthcare-adjacent workflows."
  },
  {
    group: "Synthesis and proposal generation",
    prompt: "Local synthesis, repo inspection, proposal rewrite, and page generation",
    model: "Codex GPT-5",
    status: "Completed in local workspace",
    question:
      "Integrate the research into a founder-facing proposal, confidence methodology, partnership options, and public-safe GitHub Pages appendix."
  },
  {
    group: "Current market validation revision",
    prompt: "A/B/C partnership option validation and proposal update",
    model: "Codex GPT-5 with current web/source checks",
    status: "Completed in local workspace; tracked in GitHub issue #3",
    question:
      "Validate whether the A/B/C cost/equity ranges are accurate, separate the included systems by option, add source material, and identify additional research questions."
  },
  {
    group: "AI-native roadmap pricing revision",
    prompt: "Phase roadmap, build/test gates, and AI-assisted cost correction",
    model: "Codex GPT-5 with current web/source checks",
    status: "Completed in local workspace; tracked in GitHub issue #5",
    question:
      "Tie pricing to a 6-8 week roadmap, show what is built and tested by phase, and adjust first-sprint pricing for AI-assisted development trends."
  },
  {
    group: "Decision framing revision",
    prompt: "Remove prechosen-path language while preserving Option B",
    model: "Codex GPT-5 local proposal edit",
    status: "Completed in local workspace; tracked in GitHub issue #7",
    question:
      "Remove language that presents Option B as chosen in advance while keeping Option B as a fully described partnership option."
  },
  {
    group: "Citation and calculation methodology revision",
    prompt: "Add proposal-wide source and calculation support",
    model: "Codex GPT-5 with current source checks and local proposal edit",
    status: "Completed in local workspace; tracked in GitHub issue #9",
    question:
      "For every price, cited number, and material strategic determination, show the supporting source, source class, and calculation logic used to derive the proposal range."
  },
  {
    group: "Claude Design visual refresh",
    prompt: "Claude Design high-fidelity visual reimagination with content-freeze guard",
    model: "Claude Design via logged-in claude.ai browser session, high-fidelity mode",
    status: "Completed and exported into docs/design-handoff; integrated through GitHub Pages generator",
    question:
      "Reimagine the proposal's visual design without changing claims, numbers, citations, roadmap meaning, pricing, equity ranges, or legal/compliance statements, then export and integrate it into GitHub Pages."
  },
  {
    group: "Internal partner pricing and readability revision",
    prompt: "Proposal readability edit plus partner economics correction",
    model: "Codex GPT-5 with proposal-readability-editor skill; Otter connector unavailable, chat feedback used as source",
    status: "Completed in local workspace; tracked in GitHub issue #13",
    question:
      "Revise the proposal after internal partner feedback: make it easier to read, raise Option A cash-services build pricing, keep Option B cash pricing but raise equity to 10%-15%, and revise Option C to an at-cost build path with 35%-40% company ownership, COGS-first revenue recovery, and a later revenue split."
  },
  {
    group: "Hero proof-card readability revision",
    prompt: "First-screen comprehension and sprint framing edit",
    model: "Codex GPT-5 with Proposal Writer and proposal-readability-editor skills",
    status: "Completed in local workspace; tracked in GitHub issue #15",
    question:
      "Rewrite the first-screen proof boxes so a first-time reader understands the context and consequence, reduce citation noise in the hero and decision frame, and update the first AI-native Build + Test Sprint framing from 6-8 weeks to 4-6 weeks."
  },
  {
    group: "Proposal-wide plain-language pass",
    prompt: "Lower reading level and reduce review friction",
    model: "Codex GPT-5 with Proposal Writer and proposal-readability-editor skills",
    status: "Completed in local workspace; tracked in GitHub issue #17",
    question:
      "Run a proposal-wide plain-language pass so the proposal feels easy to review for all audiences, with simpler first-read promise, simpler section headings, shorter dense passages, and plain-English summaries while preserving pricing, equity, legal meaning, citations, and source traceability."
  }
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugFromFile(file) {
  return file
    .replace(/^deep-research-results\//, "deep-")
    .replace(/\.md$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function sourcePathForDoc(file) {
  return path.join(tamaraRoot, "research", file);
}

function canPublishFullSource(doc) {
  const sensitivity = doc.sensitivity.toLowerCase();
  return !(
    sensitivity.includes("private source") ||
    sensitivity.includes("private evidence") ||
    sensitivity.includes("raw transcript") ||
    sensitivity.includes("raw email") ||
    sensitivity.includes("redacted")
  );
}

function redactPublicMarkdown(markdown) {
  return markdown
    .replace(/\/Users\/jamesbrady(?:\/[^\n`)]+)?/g, "[local path redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]");
}

function inlineMarkdown(value) {
  const codeSnippets = [];
  let html = String(value).replace(/`([^`]+)`/g, (_match, code) => {
    const token = `@@CODE${codeSnippets.length}@@`;
    codeSnippets.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  html = escapeHtml(html);
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_match, text, href) =>
      `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  for (const [index, snippet] of codeSnippets.entries()) {
    html = html.replaceAll(`@@CODE${index}@@`, snippet);
  }

  return html;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function renderTable(lines, start) {
  const header = splitTableRow(lines[start]);
  const rows = [];
  let i = start + 2;
  while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
    rows.push(splitTableRow(lines[i]));
    i += 1;
  }

  const thead = `<thead><tr>${header
    .map((cell) => `<th>${inlineMarkdown(cell)}</th>`)
    .join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`
    )
    .join("")}</tbody>`;

  return { html: `<table class="table source-table">${thead}${tbody}</table>`, next: i };
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push("<hr />");
      i += 1;
      continue;
    }

    if (i + 1 < lines.length && /\|/.test(trimmed) && isTableDivider(lines[i + 1])) {
      const table = renderTable(lines, i);
      blocks.push(table.html);
      i = table.next;
      continue;
    }

    if (/^>\s+/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(`<blockquote>${inlineMarkdown(quoteLines.join(" "))}</blockquote>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith("```") &&
      !(i + 1 < lines.length && /\|/.test(lines[i].trim()) && isTableDivider(lines[i + 1]))
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }

  return blocks.join("\n");
}

function renderSourceDocumentSection(doc) {
  const sourcePath = sourcePathForDoc(doc.file);
  if (!fs.existsSync(sourcePath)) {
    return `
        <section class="card">
          <h2>Research Document</h2>
          <div class="callout warn">
            The source markdown file was not found at generation time, so this public page includes the summary, questions, model, and publication boundary only.
          </div>
        </section>
`;
  }

  if (!canPublishFullSource(doc)) {
    return `
        <section class="card">
          <h2>Research Document</h2>
          <div class="callout warn">
            This research source is private or redacted. The public page intentionally exposes the model, questions, and summary without copying raw mailbox,
            transcript, private attachment, or account material into GitHub Pages.
          </div>
        </section>
`;
  }

  const markdown = redactPublicMarkdown(fs.readFileSync(sourcePath, "utf8").trim());
  return `
        <section class="card source-card">
          <h2>Research Document</h2>
          <div class="callout">
            This is the public-safe HTML rendering of the source research document. Local filesystem paths and direct email addresses are redacted.
          </div>
          <div class="source-content">
${markdownToHtml(markdown)}
          </div>
        </section>
`;
}

function renderShell({ title, description, nav = "", body, depth = "." }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="stylesheet" href="${depth}/assets/site.css" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,500;8..60,650&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div class="wrap">
      <aside class="sidebar">
        <div class="brand">
          <div class="title">Looheru Research Appendix</div>
          <div class="subtitle">Public-safe proposal and research pages for the February family coordination assistant repo.</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <span class="pill">Trace: ${traceId}</span>
            <span class="pill">${issueLabel}</span>
            <span class="pill">Public-safe</span>
          </div>
        </div>
        <nav class="nav">
          <a href="${depth}/index.html">System Guide</a>
          <a href="${depth}/proposal.html">Proposal</a>
          <a href="${depth}/research/index.html">Research Index</a>
          <a href="${depth}/research/prompts-and-models.html">Prompts + Models</a>
          <a href="https://github.com/h3ro-dev/family-coordination-assistant">GitHub Repo</a>
          <a href="${issueUrl}">Tracking Issue</a>
          ${nav}
        </nav>
        <div class="footer">Repo: h3ro-dev/family-coordination-assistant</div>
      </aside>
      <main class="main">
${body}
        <div class="footer">
          Published from the repo's <span class="k">/docs</span> folder using GitHub Pages.
        </div>
      </main>
    </div>
  </body>
</html>
`;
}

function listItems(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderResearchIndex() {
  const rows = sourceDocs
    .map((doc) => {
      const href = `${slugFromFile(doc.file)}.html`;
      return `<tr>
        <td><a href="${href}">${escapeHtml(doc.title)}</a><br /><span class="k">${escapeHtml(doc.file)}</span></td>
        <td>${escapeHtml(doc.type)}</td>
        <td>${escapeHtml(doc.model)}</td>
        <td>${escapeHtml(doc.sensitivity)}</td>
      </tr>`;
    })
    .join("\n");

  return renderShell({
    title: "Looheru Research Appendix",
    description: "Public-safe research appendix for the Looheru proposal.",
    depth: "..",
    body: `
        <section class="hero">
          <h1>Research Appendix</h1>
          <p>
            This appendix attaches the Looheru research packet to the February family coordination assistant repo in a public-safe form.
            It identifies every research document, the model or method used, and the question each document answered.
          </p>
          <p>
            Raw private mailbox evidence, raw transcript text, contact details, sensitive personal context, private deployment details,
            and internal account material remain outside this public repo.
          </p>
          <div class="mini-nav">
            <a href="../proposal.html">Open proposal</a>
            <a href="./prompts-and-models.html">Prompts and models</a>
            <a href="${issueUrl}">Tracking issue</a>
          </div>
        </section>

        <section class="card">
          <h2>Associated February GitHub Project</h2>
          <div class="grid3">
            <div class="card"><h3>Repo</h3><p><a href="https://github.com/h3ro-dev/family-coordination-assistant">h3ro-dev/family-coordination-assistant</a></p></div>
            <div class="card"><h3>First commits</h3><p>February 8-9, 2026: SMS sitter loop, worker jobs, admin UI, docs, voice result ingestion, and Twilio Voice calls.</p></div>
            <div class="card"><h3>Pages site</h3><p><a href="https://h3ro-dev.github.io/family-coordination-assistant/">GitHub Pages system guide</a></p></div>
          </div>
        </section>

        <section class="card">
          <h2>Research Documents</h2>
          <table class="table">
            <thead><tr><th>Document</th><th>Type</th><th>Model / Method</th><th>Publication Boundary</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>
`
  });
}

function renderPromptsPage() {
  const rows = promptRuns
    .map(
      (run) => `<tr>
        <td>${escapeHtml(run.group)}<br /><strong>${escapeHtml(run.prompt)}</strong></td>
        <td>${escapeHtml(run.model)}</td>
        <td>${escapeHtml(run.status)}</td>
        <td>${escapeHtml(run.question)}</td>
      </tr>`
    )
    .join("\n");

  return renderShell({
    title: "Looheru Prompts And Models",
    description: "Prompt and model lineage for Looheru research.",
    depth: "..",
    body: `
        <section class="hero">
          <h1>Prompts And Models Used</h1>
          <p>
            The research used GPT 5.5 Pro Deep Research for external/market/legal research runs, and Codex GPT-5 for local
            repo inspection, synthesis, proposal writing, and public-safe page generation.
          </p>
          <p>
            The table records the questions asked and whether each prompt produced a completed output in the local research packet.
          </p>
        </section>

        <section class="card">
          <h2>Prompt Lineage</h2>
          <table class="table">
            <thead><tr><th>Prompt</th><th>Model</th><th>Status</th><th>Question Asked</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>

        <section class="card">
          <h2>Attachment Policy</h2>
          <p>
            The GPT runs used the private Looheru research packet, completed GPT outputs, the current strategy report,
            the proposal draft, and the public family-coordination-assistant repo context. Private files were used for reasoning
            but are not copied into the public repo.
          </p>
        </section>
`
  });
}

function renderDocPage(doc) {
  const body = `
        <section class="hero">
          <h1>${escapeHtml(doc.title)}</h1>
          <p>${escapeHtml(doc.summary)}</p>
          <div class="mini-nav">
            <a href="./index.html">Research index</a>
            <a href="./prompts-and-models.html">Prompts and models</a>
            <a href="../proposal.html">Proposal</a>
          </div>
        </section>

        <section class="card">
          <h2>Document Metadata</h2>
          <div class="meta">
            <div><strong>Source document:</strong> <span class="k">${escapeHtml(doc.file)}</span></div>
            <div><strong>Type:</strong> ${escapeHtml(doc.type)}</div>
            <div><strong>Model / method:</strong> ${escapeHtml(doc.model)}</div>
            <div><strong>Publication boundary:</strong> ${escapeHtml(doc.sensitivity)}</div>
          </div>
        </section>

        <section class="card">
          <h2>Questions / Prompts Used</h2>
          ${listItems(doc.questions)}
        </section>

        <section class="card">
          <h2>Public-Safe Summary</h2>
          <p>${escapeHtml(doc.summary)}</p>
          <div class="callout warn" style="margin-top: 12px;">
            This page intentionally does not reproduce raw private email content, raw meeting transcript text, contact details,
            sensitive personal context, local filesystem paths, secrets, deployment URLs, or private account data.
          </div>
        </section>
${renderSourceDocumentSection(doc)}
`;
  return renderShell({
    title: `Looheru Research - ${doc.title}`,
    description: doc.summary,
    depth: "..",
    body
  });
}

function writeProposalPage() {
  if (fs.existsSync(claudeDesignExportPath)) {
    const html = sanitizeClaudeDesignProposal(fs.readFileSync(claudeDesignExportPath, "utf8"));
    fs.writeFileSync(path.join(docsDir, "proposal.html"), html);
    return;
  }

  const sourcePath = path.join(tamaraRoot, "proposal", "looheru-official-proposal.html");
  let html = fs.readFileSync(sourcePath, "utf8");
  html = html.replace(
    "</style>",
    `
    .repo-banner {
      max-width: 1180px;
      margin: 0 auto 18px;
      padding: 14px 18px;
      background: #111318;
      color: #fff;
      border: 1px solid rgba(255,255,255,0.14);
      box-shadow: var(--shadow);
      display: flex;
      gap: 14px;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .repo-banner a { color: #78dce8; font-weight: 800; }
    .repo-banner span { color: rgba(255,255,255,0.72); }
    </style>`
  );
  html = html.replace(
    "<body>",
    `<body>
<div class="repo-banner">
  <div><strong>Looheru Strategic Partnership Proposal</strong> <span>Published as a GitHub Pages proposal page for the February family coordination assistant repo.</span></div>
  <div><a href="./index.html">System guide</a> · <a href="./research/index.html">Research appendix</a> · <a href="./research/prompts-and-models.html">Prompts + models</a></div>
</div>`
  );
  fs.writeFileSync(path.join(docsDir, "proposal.html"), html);
}

function sanitizeClaudeDesignProposal(html) {
  return html
    .replace(/\n\.opt\.featured\{background:var\(--cream\)\}/g, "")
    .replace(/\n\.opt\.featured::before\{[^}]*\}/g, "")
    .replace(/\n\s*\.opt\.featured::before\{transform:translate\(-50%,-50%\)\}/g, "")
    .replaceAll('class="opt featured"', 'class="opt"');
}

ensureDir(researchDir);
writeProposalPage();
fs.writeFileSync(path.join(researchDir, "index.html"), renderResearchIndex());
fs.writeFileSync(path.join(researchDir, "prompts-and-models.html"), renderPromptsPage());
for (const doc of sourceDocs) {
  fs.writeFileSync(path.join(researchDir, `${slugFromFile(doc.file)}.html`), renderDocPage(doc));
}
fs.writeFileSync(
  path.join(researchDir, "manifest.json"),
  `${JSON.stringify({ traceId, issueUrl, sourceDocs, promptRuns }, null, 2)}\n`
);

console.log(`Generated proposal page and ${sourceDocs.length + 3} research appendix files.`);
