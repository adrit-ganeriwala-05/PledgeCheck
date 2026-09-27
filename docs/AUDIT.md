# Audit log and Solana anchor

PledgeCheck writes every clinic action to a hash-chained audit log in Supabase. From time to
time it publishes the latest chain hash (the **head**) to Solana devnet. Verification
recomputes the whole chain and compares it with what is on Solana. If anyone edits the log
before an anchor, verification catches it, even a database insider who rewrites every
later hash.

Code: [`apps/web/lib/audit/`](../apps/web/lib/audit/). Screen: `/audit`. Owner: Nihalika (N4, N7, N8).

## What it proves, and what it doesn't

| It proves | It does not prove |
|---|---|
| The log has not been changed since it was anchored. | That a test photo was genuine, or that a result was true. The fraud checks and the prescriber's review do that. |
| An edit made before an anchor is detectable, even if every later hash was recomputed. | Anything about events after the latest anchor. The screen shows these as "N events not yet anchored". |
| The anchor was published by PledgeCheck's wallet at a public, timestamped moment. | Who made an edit. Only that the log differs from what was anchored. |

**What goes on-chain:** one memo per anchor, holding only the head's sequence number and its
32-byte hash. No patient, result, practice or event detail ever leaves the database.

## Hash chain spec (v1)

This is the contract. The writer (`append.ts`), the verifier (`verify-chain.ts`) and any
independent re-implementation must match it exactly.

```
hash(row) = lowercase_hex( sha256( prev_hash || canonicalJson(fields) ) )
```

- **`prev_hash`** is the previous row's hash. For `seq = 1` it is 64 zeros. It is concatenated
  as its 64-character ASCII hex string, not as raw bytes.
- **`fields`** are exactly `{ seq, actor, action, ref_id, payload, created_at }`:

  | Field | Encoding |
  |---|---|
  | `seq` | JSON integer, contiguous from 1 |
  | `actor` | string: `clinician:<uuid>`, `patient:<uuid>`, `patient` or `system` |
  | `action` | string from `events.ts` |
  | `ref_id` | lowercase uuid string, or `null` |
  | `payload` | the jsonb object (`{}` when absent) |
  | `created_at` | ISO 8601 UTC with milliseconds and `Z`, i.e. `new Date(t).toISOString()`. Postgres's `+00:00` output normalizes to the same string. |

- **`canonicalJson`**:
  - object keys are sorted by UTF-16 code unit (the default JS sort), recursively;
  - arrays keep their order;
  - there is no whitespace, and strings are encoded with `JSON.stringify`;
  - numbers must be safe integers. Floats are rejected at write time, because a Postgres
    `jsonb` round trip can reformat them.
- The stored `prev_hash` and `hash` columns are not hashed.
- **Test vector:** the row in `lib/audit/hash.test.ts` hashes to
  `5a1501da40a473e3884a829ee7f8270e04e54b02cbacd4aeb984ef3fb00ab3ac` (a test vector, not a secret).

**Re-verify independently.** Export `audit_events` ordered by `seq` (for example as JSON from
the Supabase table editor) and run this. It uses only `node:crypto`:

```js
import { createHash } from "node:crypto";

const canon = (v) =>
  Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : v !== null && typeof v === "object"
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
    : JSON.stringify(v);

const hashRow = (prev, r) =>
  createHash("sha256").update(prev + canon({
    seq: Number(r.seq), actor: r.actor, action: r.action, ref_id: r.ref_id ?? null,
    payload: r.payload ?? {}, created_at: new Date(r.created_at).toISOString(),
  }), "utf8").digest("hex");

let prev = "0".repeat(64);
for (const r of rows) {           // rows sorted by seq, starting at 1
  const h = hashRow(prev, r);
  if (r.prev_hash !== prev || r.hash !== h) console.log("break at seq", r.seq);
  prev = h;                       // recomputed, not stored
}
console.log("recomputed head:", prev); // compare with the memo on Solana
```

## Writing events

- **One writer.** `appendAuditEvent({ actor, action, refId?, payload? })` in `append.ts`, which
  returns `{ seq, hash }`.
  - It reads the head, computes the hash in TypeScript, and inserts through the database
    function `audit_append` (`db/audit.sql`, service role only).
  - The function rejects a stale head or a lost insert race with SQLSTATE `PT409`. The writer
    then re-reads the head and retries, up to 5 times.
- **Append-only.** The trigger `audit_events_no_update_delete` (`db/policies.sql`) blocks
  UPDATE and DELETE, even for the service role.
- **Payload privacy.** Payloads carry decisions, reasons, statuses and IDs only. Any key
  containing `photo`, `image`, `token`, `challenge` or `phash` is rejected.
- **Anchoring is not an audit event.** Anchors live in the `anchors` table. Logging each one as
  an event would move the head every time it was anchored.

## Anchoring

**Memo format**, one per anchor transaction, sent to the Memo program
(`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`):

```
pledgecheck:v1:<headSeq>:<headHash>
```

For example, `pledgecheck:v1:42:<64 lowercase hex characters>`.

**When it happens:**
- **Anchor now** on `/audit`, or `POST /api/anchors`. Any signed-in clinician can do this.
  - If the head hasn't changed since the last anchor, it returns that anchor with
    `reused: true` and sends nothing.
- **Automatically** after every 10th audit event. It runs after the response is sent, via
  `after()` from `next/server`.
  - If Solana isn't configured, it skips with one `[auto-anchor]` warning.
  - A Solana failure is logged and never breaks the clinic flow.

**The record:** each anchor is a row in `anchors`: `head_seq`, `head_hash`,
`solana_signature`, `cluster = 'devnet'` and `created_at`. `getLatestAnchor()` in `anchor.ts`
returns the newest one; it is exported for the audit PDF (A7).

**Safety:**
- `lib/audit/solana.ts` refuses any RPC URL whose host isn't devnet (or localhost, for a local
  validator).
- It reads its env only at call time, so builds work without it.
- It never puts key material in an error or a log line.

**SDK:** `@solana/web3.js`, pinned at 1.99.0. That is the legacy 1.x SDK, chosen because it is
the best-documented path to a devnet memo. No other Solana packages are used.

### `POST /api/anchors` responses

| Status | Body |
|---|---|
| 200 | `{ signature, explorerUrl, headSeq, headHash, reused }` |
| 401 / 403 | `unauthenticated` / `not_a_clinician` |
| 409 | `nothing_to_anchor`: the log is empty |
| 500 | `solana_not_configured`: env missing, malformed, or not a devnet RPC |
| 502 | `wallet_needs_devnet_sol`: fund the wallet (see setup) |
| 502 | `solana_unavailable`: RPC error or 30 s timeout |
| 500 | `anchor_not_recorded` + `signature`, `explorerUrl`: the transaction confirmed but the row wasn't saved. Insert it by hand from the logged `[anchor] ANCHOR NOT RECORDED` line. |

## Verifying

`GET /api/audit/verify` (the **Verify** button) does the following:

1. It reads every audit row in pages of 1000 and recomputes the chain.
2. It checks the newest 20 anchors against Solana, 5 at a time, with a 10 s cap each. For each
   anchor:
   - it fetches the transaction and requires that **our wallet paid for it**, because a memo
     posted by any other wallet proves nothing;
   - it parses the memo and requires that the memo's seq matches the row;
   - it compares the **recomputed** hash at that seq with the **on-chain** hash.
3. **The on-chain memo is the source of truth.** `anchors.head_hash` is only a database copy,
   so an edit to it is reported as `dbCopyMatches: false` and never decides the result.

Reads run as the signed-in clinician, under RLS. No service role is used.

| Status | Screen | Meaning |
|---|---|---|
| `intact` | green: "Log unchanged since last anchor (seq N)" | The chain recomputes cleanly and every checked anchor matches Solana. |
| `tampered` | red: "Tampering detected at seq N" | The stored chain is broken (`hash_mismatch`, `broken_link`, `missing_row`, `duplicate_seq`). |
| `tampered` | red: "Tampering detected between seq A and B" | The stored chain looks intact but disagrees with Solana (`anchor_mismatch`): someone rewrote the hashes. The edit lies after the newest earlier anchor that still matches. |
| `tampered` | red | `anchored_row_missing`: Solana proves a seq was anchored, but that row is gone. |
| `unverifiable` | amber: "Could not reach Solana — log not verified" | The RPC is down or Solana isn't configured, a transaction is missing, the memo is missing or malformed, the fee payer is wrong, or the memo's seq disagrees. **An unreachable Solana is never reported as tampering.** |
| `no_anchor` | grey: "Not anchored yet" | The chain is intact but nothing has been anchored. A broken chain is `tampered` even with no anchor. |

Response fields: `ok`, `headSeq`, `headHash` (recomputed), `anchoredHash` (from the memo),
`match`, `status`, `reason`, `firstBrokenSeq`, `tamperedWithin`, `checkedRows`,
`unanchoredCount`, `dbCopyMatches`, `anchor`, `anchorsChecked[]`.

## Setup (human steps)

The wallet is created by a person, never by code or by an assistant.

1. **Install the Solana CLI and create a throwaway devnet wallet:**
   ```bash
   solana-keygen new --no-bip39-passphrase --outfile ~/devnet-anchor.json
   solana airdrop 2 $(solana-keygen pubkey ~/devnet-anchor.json) --url devnet
   ```
   If the airdrop is rate-limited, use the web faucet at <https://faucet.solana.com> with the public key.
2. **Set two server-only variables**, never `NEXT_PUBLIC_`:
   - `SOLANA_RPC_URL=https://api.devnet.solana.com`
   - `SOLANA_SECRET_KEY`: the contents of `~/devnet-anchor.json`, a JSON array of 64 numbers.

   Put them in `apps/web/.env.local` for local dev (git-ignored) and in Vercel for production.
   Never commit the wallet file.
3. **Run the database functions:** apply `db/audit.sql` in Supabase after the schema and
   policies. Locally, `npx supabase@2.118.0 db reset` applies it from `supabase/migrations/`.
4. **Optional live check.** From `apps/web` in Git Bash, run:
   ```bash
   RUN_DEVNET_TESTS=1 corepack pnpm exec vitest run lib/audit/anchor.devnet.test.ts
   ```
   - The test loads `apps/web/.env.local` itself.
   - It sends one memo, `pledgecheck:devnet-test:<time>`, which deliberately isn't in the anchor
     format, and reads it back.
   - It prints only the explorer link.
5. **After the hackathon**, delete the wallet file. It only ever holds test SOL.

## Demo script: "Break it"

Run this on the deployed app (Supabase SQL editor) or locally (Supabase Studio, usually
<http://127.0.0.1:54323>).

1. **Approve a test** in `/queue`, then open `/audit` and click **Anchor now**. Open the
   explorer link: the memo shows `pledgecheck:v1:<seq>:<hash>`.
2. **Click Verify.** The result is green: "Log unchanged since last anchor (seq N)".
3. **Play the insider.** In the SQL editor, bypass the append-only trigger and edit an anchored
   row:
   ```sql
   alter table public.audit_events disable trigger audit_events_no_update_delete;
   update public.audit_events set payload = '{"decision":"rejected"}' where seq = <n>;
   alter table public.audit_events enable trigger audit_events_no_update_delete;
   ```
   - This disables one named trigger, which the table owner (the `postgres` role in the SQL
     editor) may do.
   - Avoid `disable trigger all`: it also covers system triggers and needs superuser, which
     Supabase's `postgres` role isn't.
4. **Click Verify.** The result is red: "Tampering detected at seq <n>". The row is highlighted
   in the table, and the explorer link to the original anchor is right there.
5. **Optional, the sophisticated insider.** An insider could also recompute and rewrite every
   hash from `<n>` onward, so the stored chain looks perfect. Verify still goes red,
   "Tampering detected between seq A and B", because the recomputed head no longer matches the
   hash on Solana.
   - This case is covered by the automated tests (`verify.test.ts`, `sophisticatedInsider`).
   - Rewriting the hashes by hand in SQL isn't practical live, so demo step 3 instead.

**Narration:** "Even an insider who bypasses our database protections gets caught, because the
fingerprint is on a public ledger we can't rewrite."

**Reset afterwards.**
- Locally: `npx supabase@2.118.0 db reset`.
- On the deployed database, restore the edited payload the same way. The anchor still proves
  what the row said, so Verify goes green again once the original bytes are back.

## Devpost checklist

- [ ] The explorer link to a real devnet anchor transaction (from **Anchor now** on the
      deployed app), for example `https://explorer.solana.com/tx/<signature>?cluster=devnet`.
- [ ] A screenshot of `/audit` green, then red after the edit.
- [ ] The one-line honesty statement: the anchor proves the log wasn't changed after
      anchoring. It does not validate photos, and only a hash goes on-chain.
