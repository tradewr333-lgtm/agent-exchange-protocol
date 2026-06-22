# 🎯 Attack Kit — Archestra bounty #5033 ($50)

**Issue:** [archestra-ai/archestra#5033 — "Bad UX on Knowledge/Connectors file upload failure"](https://github.com/archestra-ai/archestra/issues/5033)
**Reward:** $50 (Algora, 💎 Bounty label confirmed)
**Repo:** archestra-ai/archestra (real company, 3.8k stars, 961 forks)

---

## ⚠️ READ FIRST — claimability check (honest)

When I opened the issue, it already shows:

- **Assignees:** `@BeInLife` and `@Konstantinov-Innokentii` (these are Archestra **maintainers** — being assigned doesn't always mean a solver is locked in, but it's a yellow flag).
- **A linked open PR: [#5214](https://github.com/archestra-ai/archestra/pull/5214)** and another fork PR `gfgf-brain/archestra#1`.

**Translation:** someone may already be solving this. On Algora, the first **merged** PR wins the bounty — if #5214 gets merged, this $50 is gone.

**Do this before writing any code (2 min):**
1. Open [PR #5214](https://github.com/archestra-ai/archestra/pull/5214). Is it active/approved/about to merge? If yes → **skip this bounty**, pick another (e.g., Archestra $150 #4758, but verify it has **no** open PR / assignee the same way).
2. On the Algora bounty page, check it's still **open / unclaimed**.
3. If clear, comment `/attempt #5033` on the issue to signal you're on it.

> Lesson for the pipeline: I'll add an "already has open PR / assignee" filter to the BizDev matcher later so taken bounties stop reaching your inbox. For now, this manual check is the gate.

The technical plan below is still 100% valid (and reusable for similar Archestra UX bounties), so here it is.

---

## What they want (plain)

Today a failed file upload in **Knowledge / Connectors** shows only a red **"Failed"** pill with no reason. The reporter hit a **dimension mismatch** (model didn't support 3072 dims) and had no clue.

**Ask:** store the embedding failure reason as an **enum** in the DB, map it to a **human-readable string**, and show it as a **tooltip on the pill** — exactly mirroring the existing **`processingError`** pattern that's already in the codebase.

### Error cases to cover (enum values)
| Enum | Trigger | Tooltip (example) |
|---|---|---|
| `RATE_LIMIT` | provider 429 | "Rate limited by the embedding provider — try again shortly." |
| `AUTH_ERROR` | 401 / 403 | "Invalid or missing API key for the embedding model." |
| `MODEL_NOT_FOUND` | model configured but not found | "Embedding model not found — check your model config." |
| `PROVIDER_SERVER_ERROR` | 50x from provider | "Embedding provider had a server error — try again later." |
| `DIMENSION_MISMATCH` | derived from PG error | "Embedding dimensions don't match the collection (e.g. model outputs 3072, store expects N)." |
| `UNKNOWN` | none of the above | "Upload failed for an unknown reason. See logs for details." |

---

## The PR plan (mirror `processingError`)

I can't clone the repo from here, so the **first move is discovery** — the existing `processingError` is your map. Clone + run these greps:

```bash
git clone https://github.com/archestra-ai/archestra.git
cd archestra
# 1) Find the existing pattern you're copying:
grep -rni "processingError" --include=*.ts --include=*.tsx .
# 2) Find the DB schema / migration where status/error lives:
grep -rni "processingError\|status" $(git ls-files | grep -iE "schema|migration|model")
# 3) Find the UI pill that renders "Failed":
grep -rni "Failed" --include=*.tsx src | grep -i pill   # or search the Knowledge/Connectors component
# 4) Find where embeddings are generated (the catch block that should classify the error):
grep -rni "embed\|dimension\|3072" --include=*.ts .
```

### The 4 edits you'll almost certainly make

1. **DB layer** — add an `embeddingError` column (enum/string), next to wherever `processingError` already lives (likely a Drizzle/Prisma schema + a migration). Mirror its type exactly.

2. **Backend classifier** — in the embedding/upload service `catch` block, map the raw error → one of the enum values:
   ```ts
   function classifyEmbeddingError(err: unknown): EmbeddingError {
     const msg = String((err as any)?.message ?? err).toLowerCase();
     const status = (err as any)?.status ?? (err as any)?.response?.status;
     if (status === 429 || msg.includes('rate limit')) return 'RATE_LIMIT';
     if (status === 401 || status === 403 || msg.includes('api key')) return 'AUTH_ERROR';
     if (msg.includes('not found') || msg.includes('model')) return 'MODEL_NOT_FOUND';
     if (status >= 500) return 'PROVIDER_SERVER_ERROR';
     if (msg.includes('dimension') || msg.includes('expected') && msg.includes('vector')) return 'DIMENSION_MISMATCH';
     return 'UNKNOWN';
   }
   ```
   Save the result to the new `embeddingError` field when the upload fails.

3. **Enum → human string map** (shared util, used by the UI):
   ```ts
   export const EMBEDDING_ERROR_LABELS: Record<EmbeddingError, string> = {
     RATE_LIMIT: 'Rate limited by the embedding provider — try again shortly.',
     AUTH_ERROR: 'Invalid or missing API key for the embedding model.',
     MODEL_NOT_FOUND: 'Embedding model not found — check your model configuration.',
     PROVIDER_SERVER_ERROR: 'The embedding provider had a server error — try again later.',
     DIMENSION_MISMATCH: 'Embedding dimensions don’t match the collection. Pick a model whose output matches the store.',
     UNKNOWN: 'Upload failed for an unknown reason. Check logs for details.',
   };
   ```

4. **UI** — on the red "Failed" pill, add the tooltip exactly like the `processingError` one already does (find that JSX and copy it), reading `EMBEDDING_ERROR_LABELS[item.embeddingError]`.

---

## Submit & claim

```bash
# after coding + running the repo's lint/tests:
git checkout -b fix/5033-embedding-error-tooltip
git commit -am "feat(knowledge): surface embedding error reason as tooltip on failed uploads (#5033)"
git push origin fix/5033-embedding-error-tooltip
```
Open the PR against `archestra-ai/archestra:main`. In the PR description:
- `Fixes #5033`
- `/claim #5033`  ← Algora command that binds the PR to the bounty

Maintainer merges → **Algora pays the $50** to your connected account.

---

## Honest effort estimate
- **Coding:** 2–4 hours for someone comfortable with TS + the repo's stack (Drizzle/Prisma + React).
- **Risk:** medium-low technically, but **high contention** (PR #5214 already exists). Validate first.
- **Your AXP agent already did the analysis** — this kit is that analysis turned into an executable plan. The remaining work is real engineering + the PR.

**Bottom line:** great template, but for *this specific issue* check #5214 first. If it's taken, reuse this exact playbook on an **unassigned, no-open-PR** Archestra bounty.
