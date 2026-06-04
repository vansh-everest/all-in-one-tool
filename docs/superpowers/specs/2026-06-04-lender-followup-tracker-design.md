# Lender Follow-up Tracker — Design

**Date:** 2026-06-04
**Department:** Finance
**Status:** Approved (Phase 1)

## Goal

Read the user's UNREAD Gmail, match each relevant email to a bank/lender, and extract the list of
open pending items + status per bank — mirroring the user's "Pendencies with Lenders" sheet. Results
live in the tool (view + export). **Emails must NEVER be marked read.**

## Critical constraint: never mark emails read

Use the Gmail scope `https://www.googleapis.com/auth/gmail.readonly` only. Reading via the API does
not change read-state, and `readonly` makes label modification impossible at the API level.

## Decisions locked during brainstorming

- **Backlog/AI strategy: domains-first, AI on-demand.** Lender sender domains/emails are filled by
  the user up front. Backlog runs match deterministically; only matched-lender threads ever reach
  Gemini for extraction. Unmatched emails stay metadata-only and are NOT all dumped into the queue or
  sent to AI; a capped, throttled **"Classify queue"** button runs AI classification (subject+snippet)
  on the queue only when the user clicks it.
- **Scope: Phase 1 MVP first.** This build excludes `historyId`/`after:`-based true incremental sync
  and compare-two-instances diffing. Per-message caching + the ignore list already make re-runs cheap.
- **Queue learning: suppress rejected senders.** Marking an email "not a lender" stores the sender on a
  department-scoped ignore list so it never returns to the queue.
- **Lender delete = admin-only** (mirrors Scrap Scale run-delete). Add/edit open to department members.
- **Seed owners left blank** — user assigns Jaisen/Purvi/etc. in the UI.

## Architecture reconciliation with current platform

The original prompt assumed a custom OAuth module with `GOOGLE_REDIRECT_URI` / `TOKEN_ENCRYPTION_KEY`.
The platform actually uses **Clerk-held Google OAuth tokens** (Option Y): `lib/google/connection.ts`
reads the user's Google access token from Clerk via `clerkClient().users.getUserOauthAccessToken`.
Therefore:

- Adding Gmail = add `gmail.readonly` to `lib/google/scopes.ts` AND add that scope to the Google
  connection in the **Clerk dashboard**, then sign out/in to re-consent.
- `GOOGLE_REDIRECT_URI` / `TOKEN_ENCRYPTION_KEY` remain documented in `.env.example` but are not on the
  token path (Clerk mints/refreshes tokens).
- `gmail.readonly` is a Google *restricted* scope; for an internal everestfleet.in Workspace app this
  is acceptable.
- The `finance` department already exists in `supabase/seed.mjs` — no new department needed.

## Data model — migration `0006_lender_followup.sql`

All tables: `department_id uuid not null references departments(id) on delete cascade`, RLS enabled with
NO policies (service-role-only access, consistent with the post-`0004` pattern).

### `lenders`
| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| department_id | uuid fk | |
| name | text not null | |
| aliases | text[] not null default '{}' | |
| sender_domains | text[] not null default '{}' | e.g. `axisbank.com` |
| known_sender_emails | text[] not null default '{}' | learned + manual |
| owner | text | "Jaisen" / "Purvi" / null |
| active | bool not null default true | |
| created_at | timestamptz default now() | |

### `lender_ignored_senders`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| department_id | uuid fk | |
| email | text not null | lowercased |
| created_by_email | text | |
| created_at | timestamptz default now() | |
unique(department_id, email)

### `lender_message_cache`
Per-message Gemini cache (cost lever for re-runs).
| column | type | notes |
|---|---|---|
| message_id | text | part of pk |
| department_id | uuid fk | part of pk |
| lender_id | uuid null | matched lender |
| thread_id | text | |
| from_email | text | |
| subject | text | |
| internal_date | timestamptz | |
| snippet | text | |
| extraction | jsonb | `{ items: PendencyItem[], last_contact_date }` |
| extracted_at | timestamptz default now() | |
primary key (department_id, message_id)

### `lender_runs` (instances)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| department_id | uuid fk | |
| created_by_email | text | |
| status | text | running / done / error |
| worklist | jsonb not null default '[]' | unread message ids to process |
| cursor | int not null default 0 | next worklist index |
| counts | jsonb not null default '{}' | unread_total, matched, queued, lenders_with_items, open_items |
| summary | jsonb | |
| activities | jsonb not null default '[]' | lifecycle log |
| last_internal_date | timestamptz | newest processed msg (Phase 2 incremental) |
| created_at | timestamptz default now() | |

### `lender_run_items` (immutable per-run snapshot)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| run_id | uuid fk on delete cascade | |
| lender_id | uuid null | |
| lender_name | text | |
| owner | text | |
| item | text | |
| status | text | |
| last_update_date | text | |
| direction | text | awaiting_lender / action_on_us / unclear |
| source_message_id | text | |
| thread_id | text | |
index on (run_id)

### Seed lenders (domains blank, owners blank)
Aditya Birla Capital Ltd, Axis Bank Limited (Commercial), Bank of Maharashtra, Bank of Baroda,
Cholamandalam Finance, CSB Bank Limited, Cosmos Co-operative Bank Ltd, DNSB Sahakari Bank Ltd,
Federal Bank Limited. Inserted via `supabase/seed.mjs` (idempotent upsert by department_id+name) — only
when the finance department exists.

## Scopes — `lib/google/scopes.ts`

```ts
export const SCOPES = {
  sheets: "https://www.googleapis.com/auth/spreadsheets",
  driveReadonly: "https://www.googleapis.com/auth/drive.readonly",
  gmailReadonly: "https://www.googleapis.com/auth/gmail.readonly",
} as const;
export const SCRAP_SCALE_SCOPES = [SCOPES.sheets, SCOPES.driveReadonly];
export const LENDER_FOLLOWUP_SCOPES = [SCOPES.gmailReadonly];
```

`getConnection` is generalized to `getConnection(clerkUserId, requiredScopes)` returning the connection
when those scopes are present; the Scrap Scale page passes `SCRAP_SCALE_SCOPES`, the Lender page passes
`LENDER_FOLLOWUP_SCOPES`.

## Pure modules (`lib/lender/`)

- **`match.ts`** — `normalizeEmail`, `emailDomain`, `matchLender(fromEmail, lenders): lenderId | null`
  (known_sender_emails exact match first, then sender_domains suffix). Pure, unit-tested.
- **`ocr`/extraction parsing `extract.ts`** — `parseExtraction(text): { items: PendencyItem[],
  last_contact_date: string | null }` tolerating valid JSON / fenced JSON / garbage (returns empty).
  `PendencyItem = { item, status, last_update_date: string|null, direction:
  "awaiting_lender"|"action_on_us"|"unclear", source_message_id }`.
- **`classify.ts`** — `parseClassification(text, threshold): { lenderId: string|null, confidence:
  number }` and threshold gating.
- **`aggregate.ts`** — group cached extractions by lender → tracker structure; compute counts.
- **`ignore.ts`** — `filterIgnored(messages, ignoredSet)`.
- **`exportRows.ts`** — build CSV rows / xlsx AOA from tracker.

## Gemini throttle/rotation (`lib/gemini/`)

Reuse existing rotation logic from `lib/scrap-scale/gemini-keys.ts` (`parseGeminiKeys`,
`isRateLimitStatus`, `nextStartIndex`; handles `GEMINI_API_KEY` / `_2` / `_3`). Wrap calls in a
concurrency-limited queue with exponential backoff on 429/quota, rotating to the next key on rate-limit.
Two call shapes: `classifyEmail(subjectSnippet, activeLenders)` and `extractThread(messages)`.

## Gmail client (`lib/google/gmail.ts`)

- `listUnreadIds(token, { pageToken }): { ids: string[], nextPageToken }` — `messages.list?q=is:unread`,
  ids only.
- `getMetadata(token, id): { id, threadId, from, subject, date, snippet }` — `messages.get?format=metadata`.
- `getFull(token, id): { id, threadId, from, subject, date, bodyText }` — `messages.get?format=full`,
  prefer text/plain, fallback stripped HTML; base64url-decode parts.
- All calls run through a concurrency limiter shared with the run pipeline.

## API routes (`app/api/tools/lender-followup/`)

- `POST /run` — guard finance; `getAccessToken(userId, LENDER_FOLLOWUP_SCOPES)`; page through unread ids;
  create `lender_runs` row with worklist; seed activities; return `{ runId, total }`.
- `POST /run/[runId]/process-chunk` — process next K (e.g. 25) worklist ids: metadata get → drop ignored
  → deterministic match → matched: full get + thread-grouped extract (cache by message_id) → unmatched
  non-ignored: queue. Advance cursor; persist partial counts. On final chunk: aggregate
  `lender_run_items`, finalize counts/summary, status=done. Return `{ processed, total, matched, queued,
  done }`.
- `GET /run/[runId]` — run + aggregated tracker (lenders→items) + review queue (queued metadata).
- `POST /run/[runId]/classify-queue` — capped (e.g. 50/click), throttled AI classification of queued
  emails; confident matches → full+extract → tracker; returns updated counts.
- `POST /run/[runId]/assign` — `{ messageId, lenderId }` appends sender to lender.known_sender_emails,
  fetches full + extracts, adds to tracker; `{ messageId, action: "ignore" }` adds sender to
  `lender_ignored_senders` and removes from queue.
- `GET /run/[runId]/export?format=csv|xlsx` — tracker export.
- Lender CRUD: `GET/POST /api/tools/lender-followup/lenders`, `PATCH/DELETE
  /api/tools/lender-followup/lenders/[id]` (DELETE admin-only).
- `GET /api/tools/lender-followup/message/[messageId]` — cached full content for the read-only modal.

## UI (`components/lender/`, reusing Scrap Scale design tokens)

- **Page** `app/(app)/finance/lender-followup/page.tsx` (server): `requireDepartmentAccess("finance")`,
  `getConnection(user.id, LENDER_FOLLOWUP_SCOPES)`, load lenders + latest run + run history.
- **Tabs:** *Tracker* / *Manage lenders*.
- **`LenderManager.tsx`** — CRUD table: name, owner, aliases, sender_domains, known_sender_emails,
  active toggle; delete button shown only when `canManage` (admin).
- **`LenderFollowupApp.tsx`** — connect-state (SignOutButton if Gmail scope missing) → Run button →
  live progress (process-chunk loop, progress bar) → per-lender tracker groups (owner shown) of open
  items (item, status, last update, direction, source link) → filter by owner → counts
  (lenders-with-items / total-open-items / matched / queued) → review queue (assign to lender / ignore /
  "Classify queue") → CSV + Excel export. Persistent **privacy banner**. Item click → read-only email
  modal.
- **`LenderRunHistory.tsx`** — list saved instances (compare deferred to Phase 2).

## Privacy / data minimization

UI banner (verbatim intent): "Only emails matched to a lender have their full content fetched and sent
to Gemini. All other unread mail is read as metadata only (sender, subject, date) and is never sent
anywhere. Email is never marked read."

## Env (`.env.example`)

Ensure present: `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` (note: Google/token vars are
Clerk-managed in this deployment; documented for completeness).

## Testing (vitest, pure modules only)

`match.ts`, `extract.ts` parse (valid/fenced/garbage), `classify.ts` threshold gating, Gemini
queue backoff + key-rotation index selection, `ignore.ts` filtering, `aggregate.ts` grouping/counts,
`exportRows.ts` CSV/xlsx rows.

## Registry & README

- Add `lender-followup` to `lib/tools/registry.ts` under `finance`.
- README: usage, the `gmail.readonly` note (+ Clerk scope step), and the matching/learning behavior.

## Deferred (Phase 2, explicitly out of scope here)

- `historyId` / `after:`-based true incremental sync.
- Compare two instances: new items / resolved (disappeared) / status changes. (`lender_run_items`
  snapshots are stored now to make this straightforward later.)
