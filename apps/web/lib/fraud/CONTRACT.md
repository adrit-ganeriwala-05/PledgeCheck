# Fraud checks: contract for the submission pipeline

Used by `POST /api/submissions`. All functions are server-only and import from
`@/lib/fraud/checks`. Every failure ends as `submissions.status = "rejected_fraud"` (or
`expired`, or no submission at all) and calls `recordFraudRejection(requestId, reason)` once.

The **server stamps the time**. Never pass a timestamp from the client.

## Order in the pipeline

Cheap checks come before any AI call:

1. `checkSessionForUpload(token)`, before inserting the submission row. The insert itself is
   the claim: a unique-violation (`23505`) on `request_id` means a concurrent upload won, and
   the result is `already_submitted`.
2. Both readers run (Grok and OpenCV).
3. `checkPhotoReuse(phash, { excludeSubmissionId })`, on the analyze service's phash.
4. `checkChallengeCode(expectedCode, grok.code_read)`, on Grok's read.

Failures 3 and 4 become the blocking flags `photo_already_used` and `code_missing_or_wrong`. The
rules engine then blocks, and the status is `rejected_fraud`. If the reuse check itself fails, the
pipeline adds the non-blocking flag `reuse_check_unavailable` for the prescriber.

## `checkSessionForUpload(token: string, now?: Date)`

```ts
Promise<
  | { ok: true; requestId: string; patientId: string; practiceId: string; expectedCode: string;
      setting: "home" | "clinic" }
  | { ok: false; reason: "invalid_link" | "session_not_started" | "session_expired" | "already_submitted";
      requestId: string | null }   // null only for invalid_link
>
```

An upload is accepted only while the session is **active**: the patient tapped Start
(`POST /api/t/:token/start`) less than `SESSION_MINUTES` (40) ago. The result is `already_submitted` as soon as any
`submissions` row exists for the request, so call this **before** inserting one.

| reason | meaning | pipeline answer |
|---|---|---|
| `invalid_link` | unknown token | 410, status `rejected_fraud` |
| `session_not_started` | Start never tapped (including links that expired unstarted) | 410, status `rejected_fraud` |
| `session_expired` | more than 40 min since Start; the patient needs a new link | 410, status `expired` |
| `already_submitted` | a submission exists for this link | 410, status `rejected_fraud` |

`now` exists for tests only. Throws on a database error; the pipeline answers 500.

## `checkChallengeCode(expected: string, codeRead: string | null)`

```ts
{ ok: true } | { ok: false; reason: "code_missing_or_wrong" }
```

Trims, uppercases and removes spaces, then compares exactly. A null or empty read fails.

## `checkPhotoReuse(phash: string, opts?: { excludeSubmissionId?: string })`

```ts
Promise<{ ok: true } | { ok: false; reason: "photo_already_used"; matchedSubmissionId: string; distance: number }>
```

- `phash` is the 16-hex pHash from the analyze service.
- A match means the Hamming distance to **any** earlier submission, in any practice, is **< 8** (`REUSE_DISTANCE`).
- Pass the current submission id as `excludeSubmissionId` when its row already holds the hash.
- Throws `PhashFormatError` on a malformed hash and a plain `Error` on a database error.

## `recordFraudRejection(requestId: string | null, reason: FraudReason)`

Writes the `submission.rejected_fraud` audit event with payload `{ reason }` only. It never contains the phash, the code or the token.

- `requestId` is `null` only for `invalid_link`.
- `reason` must be one of the six reasons above; any other string throws.
- It is best effort: it logs and returns `null` if the audit write fails, and the rejection still stands.

## Older interface (compatibility only)

Nothing in the app calls these any more. They keep the names and signatures from
`labib/p0-integrated`, and run in **strict mode** (`ALLOW_UPLOAD_WITHOUT_START = false` in `session.ts`).

- `checkToken(db, token, now)` (`@/lib/fraud/token`):
  - ok for a link that hasn't started (`ready`) or is `active`;
  - `expired` for a link or session past its time;
  - `already_used` once a photo was submitted;
  - `not_found` for an unknown token.
- `consumeRequest(db, requestId, now)`:
  - true once per link, when no submission row exists yet and the session is active;
  - with the flag set to `true`, also true for a never-started link, and it starts the session.
- `checkReuse(db, phash, excludeSubmissionId?)` (`@/lib/fraud/reuse`):
  - `{ reused, matchedSubmissionId?, distance? }` with the same `< 8` threshold;
  - a malformed hash or a failed read is logged and reported as not reused.
