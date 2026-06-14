# Product Requirements Document
## AI Coding Agent Usage Monitoring Extension for VS Code

*Internal tool to observe and report how Claude Code and OpenCode are used across the engineering team. Monitoring and analytics only — no flagging, enforcement, or punitive action.*

**Version 1.1 — Draft · June 2026**

---

## 1. Overview

This document specifies a Visual Studio Code extension that gives engineering leadership visibility into how developers use the company's two AI coding agents. Its purpose is **observation and reporting only** — it does not flag individuals, enforce policy, or drive any punitive action.

The organization provides two agents to its engineers:

- **OpenCode** (running a Chinese-hosted model) is the suggested agent for routine, day-to-day coding.
- **Claude Code** is suggested for critical problems, complex reasoning, and high-stakes work.

Today there is no visibility into how this guidance plays out in practice. Leadership cannot tell, in aggregate, how often Claude Code is used for routine work or how often OpenCode handles complex changes. The extension provides that visibility by capturing each agent interaction, classifying the task, and reporting usage centrally as analytics. It surfaces *trends*, not individual verdicts. Every engineer works in VS Code, which makes a single extension the natural observation point.

---

## 2. Goals & Non-Goals

### 2.1 Goals

- Capture the prompts and commands engineers send to each agent inside VS Code.
- Record which agent (Claude Code or OpenCode) was used, where, and for what.
- Automatically classify each task by complexity (e.g., simple CRUD vs. complex reasoning) to support aggregate analysis.
- Detect, where possible, which model produced a given prompt or block of code.
- Provide leadership a central dashboard summarizing usage and cost signals as **trends across teams and time**.

### 2.2 Non-Goals

- **The extension does not flag, score, warn, block, or otherwise act against any individual engineer.** It observes and reports usage as analytics. There is no policy engine and no enforcement, in v1 or as a planned later phase.
- It does not surface per-engineer "violations" or push notices to engineers about their agent choice.
- It is not a general keylogger; only AI-agent interactions and related editor context are captured, not arbitrary typing.
- It does not replace existing code review, SAST, or secrets-scanning tooling.

---

## 3. Target Users

| Persona | Needs |
|---|---|
| Engineering Manager / Lead | Understand, in aggregate, how the team uses each agent and how that maps to task complexity over time. |
| Engineer (monitored) | Transparency about what is captured; trust that only agent interactions are recorded and that data is not used punitively. |
| Platform / DevTools Admin | Deploy and configure the extension fleet-wide; define classification rules; manage data retention and dashboard access. |
| Security / Compliance | Aggregate visibility into which model touched which kind of code, especially regarding the Chinese-hosted model and sensitive repositories. |

---

## 4. Functional Requirements

### 4.1 Agent Interaction Capture

- Detect when Claude Code or OpenCode is invoked within VS Code — via their extension APIs, terminal sessions, or output channels — and attach a session record.
- Capture the **prompt text** sent to the agent, the **commands/tools** the agent ran, the **files and workspace** in scope, a **timestamp**, and the **authenticated user**.
- Capture the agent's high-level response metadata (tokens, duration, success/error) without storing full proprietary source unless the admin enables full-context capture.
- Buffer events locally and sync to the backend; tolerate offline work and reconcile on reconnect.

### 4.2 Agent & Model Identification

- Record which agent handled each interaction (Claude Code vs. OpenCode) with high confidence from the invocation source.
- **Model detection for prompts and code:** attempt to identify the underlying model behind a prompt or a block of generated code. Approaches, in order of reliability: (1) read the agent/session metadata directly; (2) inspect API/CLI configuration the agent uses; (3) heuristic/stylometric classification on generated code as a best-effort fallback.
- Clearly label model detection as **authoritative** (from metadata) vs. **inferred** (heuristic) so leadership does not over-trust a guess. Inferred detection feeds **aggregate trends only** and is never attached to an individual as a determination.

### 4.3 Task Classification

Each interaction is scored for complexity so usage can be analyzed against task type in aggregate. Classification is descriptive — it labels the work, it does not judge the engineer's agent choice.

| Class | Examples | Typically suited to |
|---|---|---|
| Simple | CRUD endpoints, boilerplate, getters/setters, config edits, simple tests | OpenCode |
| Moderate | Refactors, multi-file changes, standard bug fixes | Either |
| Critical | Concurrency, security-sensitive logic, architecture, hard debugging, algorithms | Claude Code |

*Classification combines signals from the prompt text, the files touched, diff size, and keywords, and is configurable by the admin. v1 ships a rules-based classifier; a learned classifier is a later enhancement. The "typically suited to" column is reference context for reading the analytics, not a rule that is enforced.*

### 4.4 Aggregate Usage Analysis

- Cross-tabulate agent used against task class to show, in aggregate, how each agent is applied across the team and over time.
- Surface trends such as the share of Critical work handled by each agent, or the volume of sensitive-repository activity by model — reported as team/period rollups, not per-engineer determinations.
- No comparison produces a flag, warning, or notice against an individual. The output is analytics, consumed on the dashboard.

### 4.5 Reporting & Dashboard

- Central dashboard: usage by team, agent, model, and task class over time, presented as aggregate trends.
- Per-engineer breakdowns are available only to roles explicitly granted that access (see §7); the default view is team-level and aggregate.
- Drill-down to an individual interaction record for audit and data-subject access, gated by role.
- Exportable reports (CSV) and scheduled email summaries for managers, summarizing aggregate usage.

### 4.6 Agent Suggestion (non-binding, optional)

A lightweight, advisory hint that recommends an agent at prompt time. It assists the engineer's choice; it never makes or enforces it.

- When the engineer submits a prompt, the classifier runs on the **prompt text** and the extension may show a non-blocking hint (e.g., *"This looks like Critical work — Claude Code is suggested"*) with a short reason.
- The hint is purely advisory: the engineer chooses freely, the suggestion is always dismissible, and a choice that differs from the suggestion is **not** recorded as a violation or treated punitively. It feeds analytics only as ordinary usage.
- **Disable toggle:** this feature is configurable and can be turned off — by the admin fleet-wide and, where the admin allows, by the individual engineer. **It defaults to off**, since it is the only feature that interacts with the engineer's workflow rather than observing silently.
- **Accuracy caveat:** prompt-time classification is weaker than the post-hoc classification in §4.3, because the diff and files touched do not yet exist. Suggestions are framed as soft hints, and a low-confidence classification suppresses the hint rather than guessing.

---

## 5. High-Level Architecture

| Component | Responsibility |
|---|---|
| VS Code extension (client) | Hook agent invocations, capture prompts/commands/context, run lightweight local classification, buffer and sync. |
| Ingestion API | Authenticated endpoint receiving interaction events; validation and rate limiting. |
| Classification & detection service | Server-side task classification and model identification, including heavier heuristics not run on the client. |
| Analytics & aggregation service | Rolls interaction records up into team/period trends and cross-tabulations for the dashboard. |
| Data store | Stores interaction records and classifications with retention and access controls. |
| Dashboard (web) | Leadership and admin UI for aggregate reporting, role-gated drill-down, and configuration. |

---

## 6. Data Captured per Interaction

| Field | Description |
|---|---|
| `interaction_id` | Unique identifier. |
| `user` | Authenticated engineer (SSO identity). |
| `agent` | `claude_code` \| `opencode`. |
| `model` | Detected model + confidence (authoritative / inferred). |
| `prompt` | Prompt text sent to the agent. |
| `commands` | Commands/tools the agent executed. |
| `workspace / files` | Repo, branch, files in scope. |
| `task_class` | `simple` \| `moderate` \| `critical` + score (descriptive label only). |
| `suggestion` | If §4.6 is enabled: suggested agent, prompt-time class/confidence, and whether the engineer followed it. Empty when disabled. |
| `timestamps / metrics` | Start, end, duration, token counts, status. |

---

## 7. Privacy, Security & Compliance

- **Purpose limitation:** the captured data is used for usage analytics only. It is not used to flag, discipline, rank, or act against any individual engineer. This constraint is a product requirement, not just a policy statement. The optional agent suggestion (§4.6) is advisory only and does not change this — following or ignoring a suggestion is never treated as compliance or violation.
- **Transparency:** engineers are informed that agent interactions are monitored and for what purpose; the extension surfaces its monitoring state in the status bar. Confirm the monitoring is disclosed and lawful in every jurisdiction where monitored engineers work before deployment.
- **Scope limiting:** only AI-agent interactions and directly related editor context are captured — not unrelated keystrokes, browsing, or local files.
- **Sensitive code with the Chinese-hosted model:** allow admins to define repositories or paths that should not use OpenCode, and report such usage in aggregate to security. (This is a reporting control, not a per-engineer flag.)
- **Access control:** encryption in transit and at rest; dashboards restricted by role. Per-engineer breakdowns and interaction drill-down are gated to explicitly authorized roles; the default dashboard view is aggregate. Access to the monitoring data is itself logged.
- **Retention:** default retention window of **90 days**, configurable, with automatic deletion thereafter. Full-prompt capture is an explicit admin opt-in and defaults off.
- **Secrets:** redact obvious credentials/keys from captured prompts before storage.

---

## 8. Success Metrics

- Coverage: % of agent interactions captured across the fleet (target > 95%).
- Model-detection accuracy: authoritative coverage % and inferred precision.
- Classifier agreement with manual lead review (target > 85%).
- Extension overhead: < 50 ms added latency per interaction and < 1% sustained CPU; no perceptible editor lag.
- Dashboard adoption: leadership actively using aggregate trend reports.

---

## 9. Delivery Phases

| Phase | Scope |
|---|---|
| Phase 1 — Capture | Agent detection, prompt/command capture, authoritative model ID, central ingestion, basic aggregate dashboard. |
| Phase 2 — Classify & analyze | Rules-based task classification, agent-vs-class cross-tabulation, team/period trend views, role-gated access. |
| Phase 3 — Intelligence | Heuristic/stylometric model inference (aggregate-only), learned classifier, scheduled reports, sensitive-repo reporting, optional non-binding agent suggestion (§4.6, defaults off). |

*There is no enforcement phase. Flagging, blocking, and per-engineer policy action are explicitly out of scope for this product. The agent suggestion in Phase 3 is advisory and disableable, not enforcement.*

---

## 10. Open Questions

1. Do Claude Code and OpenCode expose stable APIs/output channels the extension can hook, or is terminal/log parsing required? *(Highest technical risk — warrants a feasibility spike before Phase 1.)*
2. What is the acceptable level of full-prompt storage given the proprietary code involved, and should it default to metadata-only?
3. Should engineers be able to view their own captured data (data-subject access), and through what surface?
4. Which repositories should be reported as sensitive when used with the Chinese-hosted model?
5. Which roles may view per-engineer breakdowns versus aggregate-only?
