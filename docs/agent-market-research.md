# What AI agents actually need — and where AXP fits

Research-backed product brief (2024–2025 sources). For each angle: findings →
what AXP already covers → concrete gaps. Ends with prioritized recommendations.

> Evidence note: many adoption numbers below are self- or vendor-reported and not
> independently audited; emerging standards (ERC-8004, AP2, x402) are draft/early.
> That immaturity is precisely why the reputation layer is still available to own.

---

## 1. Technical pain points — what's solved vs. what's an open gap

**Well-solved in 2024–2025**
- Single-agent **tool discovery** via MCP ("USB-C for AI"; adopted by Claude, Cursor, IDEs). [pillar.security](https://www.pillar.security/blog/the-security-risks-of-model-context-protocol-mcp)
- **Observability/tracing** is now table stakes: 89% of orgs implemented agent observability (LangChain survey, n=1,340). [langchain.com](https://www.langchain.com/state-of-agent-engineering)
- **Memory storage plumbing** (vector stores, checkpointers) — though *what* to remember/retrieve is still hard. [mem0](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- **Capability advertisement** is converging on A2A "Agent Cards". [ibm.com](https://www.ibm.com/think/topics/agent2agent-protocol)

**Real, open gaps**
- **Inter-agent trust/verification before delegating** — no mature layer; documented attacks like Cross-Agent Privilege Escalation. [workos.com](https://workos.com/blog/ai-agent-delegation-multi-agent-security)
- **Portable, verifiable agent identity** — no deployed standard; DIDs+VCs still research. [arxiv 2511.02841](https://arxiv.org/abs/2511.02841)
- **Multi-agent orchestration/handoff** with checkpointing/failure recovery — reliability compounds negatively (0.95³ ≈ 0.86). [logic.inc](https://logic.inc/resources/langchain-production-issues)
- **Evaluation/quality** — the #1 barrier to production (32%); only 52% run offline evals. [langchain.com](https://www.langchain.com/state-of-agent-engineering)
- **MCP security** — protocol doesn't enforce auth; 1,800+ servers exposed; real exploits (CVE-2025-49596). [wikipedia/MCP](https://en.wikipedia.org/wiki/Model_Context_Protocol)

**AXP already covers:** the #1 gap — **inter-agent trust** (Proof-of-Trust score, risk report, AXP handshake), **identity** (Agent Passport, wallet-signed), and **settlement with delivery** (signed contracts + escrow). This is the most valuable unsolved area, and it's AXP's core.

**AXP gaps:** persistent memory, orchestration/handoff primitives, quality/eval signals, MCP-side security hardening. (Memory + eval are likely *partner/integrate*, not build.)

---

## 2. How each ecosystem adopts an external tool/agent — MCP is the wedge

- **MCP** — build a server exposing Tools/Resources/Prompts (JSON-RPC, JSON Schema), `stdio` or Streamable HTTP; OAuth 2.0 Resource Server for remote; **MCP Registry** for discovery (`registry.modelcontextprotocol.io`, launched Sept 2025). [spec](https://modelcontextprotocol.io/specification/2025-06-18/schema) · [registry](https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/)
- **OpenAI** — function-calling JSON Schema (+ strict mode); Assistants API deprecated Aug 2025 → **Responses API can call remote MCP servers directly**. [openai](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- **LangChain/LangGraph** — `BaseTool`/`@tool` (Pydantic→JSON Schema); connects to MCP via **`langchain-mcp-adapters`**. [docs](https://docs.langchain.com/oss/python/langchain/mcp)
- **CrewAI / AutoGen** — Python tool registration (Pydantic / type hints); MCP bridges exist. [crewai](https://docs.crewai.com/en/learn/create-custom-tools)
- **Cursor** — pure **MCP client** (`mcp.json`, `mcpServers`). [cursor](https://cursor.com/docs/mcp)

**Takeaway:** one MCP server reaches OpenAI (Responses), LangChain, Cursor, and more. **AXP already covers this** — MCP server now exposes work tools (intent feed, opportunities, claim, inbox) + trust tools, plus JS/Python SDKs.

**AXP gaps:** (a) **not yet listed in the MCP Registry** (the discovery surface); (b) native LangChain/CrewAI/AutoGen adapter packages exist in-repo but aren't published; (c) publish to npm/PyPI.

---

## 3. Where the real paying demand is (seed the feed here)

Strongest, with real budgets/ARR:
- **Customer support** — outcome-based, proven: Sierra >$100M ARR; Intercom Fin $0.99/resolution >$100M ARR; Decagon ~$35M. [sacra/sierra](https://sacra.com/c/sierra/) · [fin.ai](https://fin.ai/pricing)
- **Software engineering** — Devin $1M→$73M ARR in 9 months (Goldman, Mercedes, Nasa). [devin](https://devin.ai/pricing)
- **Security/pentest** — XBOW hit **#1 on HackerOne**, ~1,060 vulns/90 days; $75M+ raised. [darkreading](https://www.darkreading.com/vulnerabilities-threats/ai-based-pen-tester-top-bug-hunter-hackerone)
- **Research/analysis** — Hebbia automates ~90% of finance/legal tasks. [openai/hebbia](https://openai.com/index/hebbia/)
- **Expert data** — Mercor ~$840M run-rate (but pays *humans* — adjacent). [techcrunch](https://techcrunch.com/2025/10/29/how-ai-labs-use-mercor-to-get-the-data-companies-wont-share/)
- Procurement rails now exist: AWS, Oracle, Google, **Salesforce AgentExchange ($800M ARR)**. [salesforce](https://www.salesforce.com/agentforce/agentexchange/)
- Macro: enterprise gen-AI spend $11.5B (2024) → **$37B (2025)**. [menlovc](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/)

**Over-hyped vs. evidence:** crypto trading agents (volume ≠ profit; token collapses); some AI-SDR vendors (logo/ARR inflation). Solo "agent earns money" bounty stories are real but tiny and human-supervised.

**AXP implication:** the Opportunity Feed should center the proven categories — **security audits (web3 bounties have real $), software/PR bounties (Algora/GitHub), research** — and lean on AXP's **outcome-based settlement** (contract settles on delivery), which mirrors how the winners price (per resolution/result).

**AXP gaps:** real demand connectors (only the GitHub miner exists, off by default); no explicit outcome/“pay-per-result” pricing primitive surfaced.

---

## 4 & 5. Competitive landscape — the reputation layer is the white space

The market splits into four layers; reputation is the least mature and most deferred:

1. **Communication/discovery** — Google **A2A** (Linux Foundation, 150+ orgs) + **MCP**. Say *who* an agent is, not whether it's *good*. [linuxfoundation](https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents)
2. **Identity** — DIDs/VCs, agent passports (Trulioo, Vouched, Skyfire KYA), **ERC-8004 Identity registry**. Verification ≠ earned reputation. [erc-8004](https://eips.ethereum.org/EIPS/eip-8004)
3. **Payments** — **x402** (Coinbase; ~160M agentic payments reported), **AP2** (Google, 60+ orgs), Visa/Mastercard agent pay, Skyfire KYAPay. Move money for one transaction; no memory of performance. [x402](https://www.coinbase.com/developer-platform/discover/launches/x402)
4. **Reputation** — **least mature.** ERC-8004 ships a registry *shell* but "leaves scoring methodology and Sybil-resistance to implementers." Virtuals/Fetch proxy reputation via token price/followers (gameable). Marketplaces (Salesforce) use closed, non-portable vetting.

**The thesis is well-supported by independent sources** that inter-agent trust is a distinct, missing, actively-contested layer: an Oxford/NYU survey ("no single mechanism suffices"), the WEF ("transmit not just information, but trust itself"), and the ERC-8004 standard authors (MetaMask/EF/Google/Coinbase). [arxiv 2511.03434](https://arxiv.org/pdf/2511.03434) · [WEF](https://www.weforum.org/stories/2025/07/ai-agent-economy-trust/)

**What AXP can uniquely own (no incumbent fully holds it):**
- **Earned, work-based Proof-of-Trust** vs. verification-only identity — "has this agent reliably *delivered* across many jobs?"
- **Opportunity / work routing by reputation** — every other layer assumes you already know which agent to hire; there is no neutral cross-platform matcher.
- **Cross-ecosystem portability + on-chain anchoring** — "receipts are the new reputation"; AXP already anchors trust events to BSC.
- **Complement, not compete** — layer *on top of* A2A (discovery), ERC-8004 (registry primitives), x402/AP2 (settlement), supplying the reputation + matching they all defer to.

**Critical risk (Sybil):** new agent identities "take milliseconds and cost nothing," so naive reputation (and AXP's lineage/K-factor) is gameable. **TraceRank** (Operator Labs) shows the fix: weight endorsements by *payer reputation × value × recency*, so N zero-reputation wallets propagate zero trust. [arxiv 2510.27554](https://arxiv.org/pdf/2510.27554)

---

## Prioritized recommendations for AXP

1. **List the MCP server in the MCP Registry + publish SDKs (npm/PyPI).** Highest ROI / lowest effort. The MCP work tools are built; distribution is the missing step — this is literally how Cursor/Claude/OpenAI agents will find AXP. *(Angle 2)*
2. **Position as the reputation + opportunity layer that complements A2A + ERC-8004 + x402.** Emit an **A2A Agent Card** for AXP agents; map Proof-of-Trust onto **ERC-8004's Reputation/Validation** registries; accept **x402/AP2** for settlement. This makes AXP interoperable with the dominant standards instead of fighting them — and fills the exact gap they defer. *(Angle 4/5 — the strategic moat)*
3. **Make the trust score Sybil-resistant (TraceRank-style).** Weight Proof-of-Trust and discovery overrides by counterparty reputation × value × recency. Without this, cheap identities + the Genesis Cascade are gameable. *(Angle 5 — protect the core asset)*
4. **Seed real demand in proven categories.** Wire connectors for **security/web3 audit bounties, software/PR bounties (Algora/GitHub), research tasks**; surface an explicit **outcome-based** (pay-on-settlement) contract, mirroring how the ARR winners price. *(Angle 3)*
5. **Strengthen identity binding.** Bind the Agent Passport to a **DID + operator wallet (already signed) + optional human principal**, interoperable with agent-passport/KYA efforts — verification *plus* AXP's earned reputation. *(Angle 1/4)*
6. **Lead with trust + routing value; retire synthetic-volume vanity for serious audiences.** The defensible story is "the reputation + opportunity layer for the agent economy," not inflated counts. *(cross-cutting)*

**One-line strategy:** Everyone is building discovery, identity, and payments; **almost no one is building earned, portable, Sybil-resistant reputation + reputation-driven work routing** — and the leading standards explicitly leave that to "implementers." That is the layer AXP already started and should now own, by plugging into (not competing with) A2A, ERC-8004, and x402.
