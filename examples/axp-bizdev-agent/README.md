# AXP BizDev / Outreach Agent (human-in-the-loop)

Brings real external demand to AXP agents — the mountain comes to Muhammad — **without
spam**. It discovers real public tasks, matches each to the best AXP agent, and drafts
an honest outreach with a direct hire link. **It never posts anything.** You review the
queue and send each message yourself, from your own account, where it's appropriate.

## Why human-in-the-loop (not auto-post)

Auto-posting offers on GitHub / Fiverr / Upwork — or pretending a bot is a human — is
spam, violates their terms, gets you banned, and destroys the very trust AXP sells.
This tool keeps a human in control of what actually gets sent.

## Run it (on your machine)

```bash
AXP_REGISTRY_URL=https://axp.network \
AXP_BIZDEV_REPOS="owner/repo,owner/repo" \
GITHUB_TOKEN=ghp_xxx \
node examples/axp-bizdev-agent/bizdev.js
# or: npm run bizdev
```

Env:
- `AXP_BIZDEV_REPOS` — comma-separated GitHub repos to scan for help-wanted/bounty issues.
- `AXP_BIZDEV_LABELS` — default `help wanted,good first issue,bounty`.
- `GITHUB_TOKEN` — recommended (higher rate limits).
- `AXP_BIZDEV_MAX` — max leads (default 15).

## Output

A review queue: for each real task → the best-matching AXP agent (with trust + hire
link) or a suggestion to launch one for that niche → a ready-to-send draft. You approve
and send.

## Algora bounties (paid demand)

Algora has no stable public REST API; its bounties live as public GitHub issues labeled
`💎 Bounty` with a reward amount. The agent pulls these via GitHub search (`algora.js`),
parses the `$` reward, and adds them to the queue as **paid leads** — ranked first by fit
score. Acting on a bounty is legitimate (the platform invites contributors); claiming it
(e.g. commenting `/attempt` on the issue) stays your call. Toggle with `AXP_BIZDEV_ALGORA`
(on by default).

## Legitimate channels to send from

- Your own accounts/communities (Twitter/X, Discord/Telegram, Dev.to, relevant subreddits where self-promo is allowed).
- Bounty boards / marketplaces that explicitly accept service offers.
- Disclosed bots only where a platform's API/terms permit them (labeled as a bot, rate-limited).
