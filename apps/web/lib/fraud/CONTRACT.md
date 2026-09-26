# Fraud checks: contract for the submission pipeline

For `POST /api/submissions` (Labib). All functions are server-only and import from
`@/lib/fraud/checks`. Every failure below should set `submissions.status = "rejected_fraud"`
(or create no submission at all) and call `recordFraudRejection(requestId, reason)` once, when a
request id is known.

The **server stamps the time**. Never pass a timestamp from the client.

## Order

1. `checkSessionForUpload(token)`: before inserting the submission row.
2. `checkPhotoReuse(phash, { excludeSubmissionId })`: once the analyze service returns a phash.
3. `checkChallengeCode(expectedCode, grok.code_read)`: once Grok has read the photo.

## `checkSessionForUpload(token: string, now?: Date)`

```ts
Promise<
  | { ok: true; requestId: string; patientId: string; practiceId: string; expectedCode: string }
  | { ok: false; reason: "invalid_link" | "session_not_started" | "session_expired" | "already_submitted" }
>
```

An upload is accepted only while the session is **active**: the patient tapped Start
(`POST /api/t/:token/start`) less than `SESSION_MINUTES` (40) ago. The result is `already_submitted` as soon as any
`submissions` row exists for the request, so call this **before** inserting one.

| reason | meaning | HTTP suggestion |
|---|---|---|
| `invalid_link` | unknown token | 410 |
| `session_not_started` | Start never tapped (including links that expired unstarted) | 409 |
| `session_expired` | more than 40 min since Start; the patient needs a new link | 410 |
| `already_submitted` | a submission exists for this link | 410 |

`now` exists for tests only. Throws on a database error; answer 500.

## `checkChallengeCode(expected: string, codeRead: string | null)`

```ts
{ ok: true } | { ok: false; reason: "code_missing_or_wrong" }
```

Trims, uppercases and removes spaces, then compares exactly. A null or empty read fails. The rules
engine already blocks on a wrong code; this is the same comparison and can replace it.

## `checkPhotoReuse(phash: string, opts?: { excludeSubmissionId?: string })`

```ts
Promise<{ ok: true } | { ok: false; reason: "photo_already_used"; matchedSubmissionId: string; distance: number }>
```

- `phash` is the 16-hex pHash from the analyze service.
- A match means the Hamming distance to **any** earlier submission, in any practice, is **< 8** (`REUSE_DISTANCE`).
- Pass the current submission id as `excludeSubmissionId` when its row already holds the hash.
- Throws `PhashFormatError` on a malformed hash and a plain `Error` on a database error.

## `recordFraudRejection(requestId: string, reason: FraudReason)`

Writes the `submission.rejected_fraud` audit event with payload `{ reason }` only. It never contains the phash, the code or the token.

- `reason` must be one of the six reasons above; any other string throws.
- It is best effort: it logs and returns `null` if the audit write fails, and the rejection still stands.

## Interim interface (kept so the current pipeline runs unchanged)

These keep the names and signatures from `labib/p0-integrated`. They are in **lenient mode**
(`ALLOW_UPLOAD_WITHOUT_START = true` in `session.ts`) until the capture page has a Start button.

- `checkToken(db, token, now)` (`@/lib/fraud/token`):
  - ok for a link that hasn't started (`ready`) or is `active`;
  - `expired` for a link or session past its time;
  - `already_used` once a photo was submitted;
  - `not_found` for an unknown token.
- `consumeRequest(db, requestId, now)`:
  - true once per link, when no submission row exists yet and the session is active;
  - in lenient mode, also true for a link whose session never started, and it starts the session now.
- `checkReuse(db, phash, excludeSubmissionId?)` (`@/lib/fraud/reuse`):
  - `{ reused, matchedSubmissionId?, distance? }` with the same `< 8` threshold;
  - a malformed hash or a failed read is logged and reported as not reused.

When the capture page switches to `POST /api/t/:token/start`, set `ALLOW_UPLOAD_WITHOUT_START`
to `false` and, preferably, move the pipeline to the functions above.
