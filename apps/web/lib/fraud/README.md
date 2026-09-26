# lib/fraud: links, sessions, challenge codes and photo reuse

These modules stop a patient from submitting a test they didn't take, or one taken before this
month's link. They cover tickets N1 (links), N2 (session and code) and N3 (reuse). Function
signatures for the upload pipeline are in [`CONTRACT.md`](./CONTRACT.md).

| File | What it does |
|---|---|
| `token.ts` | Generates and hashes link tokens. Also holds the interim `checkToken` / `consumeRequest`. |
| `code.ts` | Generates and compares the challenge code. |
| `session.ts` | Link and session states, `startSession`, and the status the patient's phone sees. |
| `checks.ts` | Fraud checks for `POST /api/submissions`, and `recordFraudRejection`. |
| `reuse.ts` | pHash Hamming distance and the reuse scan. Also holds the interim `checkReuse`. |
| `home-guards.ts` | The three refusals for home links. |
| `rate-limit.ts` | Best-effort per-IP limit on the public link routes. |

## Patient flow

1. **Issue.** Staff click **Home link** or **Clinic link** on `/patients`, which calls `POST /api/requests`.
   - The server makes a 32-byte random token and a 4-character code, and stores `sha256(token)` and the code in `test_requests`.
   - It returns the link once; the plain token is never stored.
   - It writes the audit event `request.issued`, with payload `{ setting }`.
2. **Open.** The patient opens `/t/<token>`. `GET /api/t/:token` returns the state and language. It returns **no code** before Start.
3. **Start.** The patient taps Start, which calls `POST /api/t/:token/start`.
   - `used_at` is set once, with a conditional update, and the audit event `session.started` is written.
   - The response reveals the code and `sessionEndsAt`.
   - Reopening the link mid-session returns the same code and deadline.
4. **Capture.** The patient writes the code on the test, takes the photo and uploads it. The pipeline runs the checks in
   `CONTRACT.md`: session active, code matches, photo not reused.
5. **Review.** Reviewable submissions go to the prescriber's queue.

## Link and session states

`used_at` means "session started". No schema change was needed.

| State | Condition |
|---|---|
| `ready` | Not started, and now < `expires_at` (issue time + `LINK_TTL_HOURS` = 24 h) |
| `active` | Started, and now < `used_at` + `SESSION_MINUTES` |
| `session_expired` | Started, and now ≥ `used_at` + `SESSION_MINUTES` |
| `link_expired` | Not started, and now ≥ `expires_at` |
| `submitted` | A submission with a photo exists (checked first) |

Both boundaries are exclusive: at exactly `expires_at` or the deadline, the link or session has
expired. **`SESSION_MINUTES` = 40** by default. It's a single constant in `session.ts`, meant to cover
the test's development time plus the photo.

## Why the code is secret until Start

The schema requires `challenge_code NOT NULL`, so the code is generated with the link. But no
response contains it until the session is active:
- not `POST /api/requests`;
- not the staff dialog;
- not `GET /api/t/:token` before Start;
- never an audit payload.

A photo taken before Start can't show the code. This is as strong as generating it at Start, and
needs no schema change. The alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` leaves out `0 O 1 I L`,
which are easy to misread in handwriting.

A future ID-verification step (Persona) belongs at the top of `startSession`, before `used_at`
is set.

## Photo reuse

The analyze service returns a 64-bit pHash as 16 hex characters. A new photo is a reuse when its Hamming
distance to **any earlier submission, in any practice**, is **< 8** (`REUSE_DISTANCE`, from the PRD).
- The scan is linear, in pages of 1000. That's fine at hackathon scale; replace it with bucketing or a BK-tree at volume.
- Tune the threshold on real test photos.

## Interim compatibility (lenient mode)

The merged pipeline and capture page still call the interim `checkToken`, `consumeRequest` and
`checkReuse`. These keep their original signatures:
- **Capture page:** it reveals the code on load, and has no Start button.
- **Lenient mode:** until the page changes, `ALLOW_UPLOAD_WITHOUT_START = true` lets an upload on a
  never-started link start the session at upload time. This is the same guarantee as before the
  merge, not a regression.
- **Switching to strict:** once the page calls `POST /api/t/:token/start`, set the flag to `false`,
  so uploads need an active session, and move the pipeline to `checks.ts`.

## Threat model rows covered

| Threat | Blocked by |
|---|---|
| A link is shared, forwarded or reused | Single use (one submission per request), a 24 h window to start, and a 40 min session. Only the token's hash is stored, and the public link routes are rate-limited. |
| An old photo, taken before this link | The code is revealed only at Start and must appear on the test. The server stamps capture time; client timestamps are never trusted. |
| The same photo resubmitted, even cropped or brightened | Perceptual hash, Hamming distance < 8 against every earlier photo |

Fraud rejections are audited as `submission.rejected_fraud`, with payload `{ reason }` only. No phash, code
or token enters the audit log.

## Known gaps

- **Someone else's negative test:** another person takes the test and writes the code on it. The
  code proves when, not who. ID verification (Persona) is planned for the Start step.
- **A screen re-photographed with the code:** a patient displays an old test photo on a screen and
  writes or overlays the code. pHash catches identical images, but not a new shot of a new
  composition. Screen and moiré detection isn't built.
- **Rate limit:** it's per instance and in memory, so on serverless it's best effort.
- **Lenient mode:** until the capture page has a Start button, the code is visible when the link is
  opened, not when the session starts.

## Open decisions

- `SESSION_MINUTES`: 40 by default.
- Whether staff, or only prescribers, may toggle home testing. Today both may.
- Reuse matching across practices is on. Confirm with the team.
