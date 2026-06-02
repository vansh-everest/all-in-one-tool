# Scrap Scale (Accounting) — Full Build Design Spec

**Date:** 2026-06-02
**Status:** Approved for planning
**Depends on:** Platform shell v1 (auth, Accounting access guard, tool registry, Supabase RLS).
**Builds:** Phase A (reusable Google OAuth connection module) + Phase B (Scrap Scale tool).

---

## 1. Goal

A reconciliation tool. An Accounting user pastes a Google Sheet URL. The tool detects two columns,
downloads payment-screenshot images linked in the sheet, OCRs each with Gemini Flash, sums amounts per
row, compares against the expected per-row amount, flags mismatches and duplicate transactions, writes
results back as a **new dated tab** in the same spreadsheet, and saves the run as an instance with
history + comparison.

## 2. Key decisions (locked)

- **Processing model:** client-driven **chunk loop + status polling**. The Run button creates a job
  row; the browser repeatedly calls a `process-chunk` route that OCRs the next N images, persists
  results, and returns progress. Resumable (re-calling resumes unprocessed rows); stays under Vercel's
  per-invocation time limit. No background worker, no SSE.
- **Column detection:** deterministic **fuzzy header match + link-content heuristic** (free,
  reliable), not a Gemini call. User can override detected columns before running.
- **Gemini model:** `gemini-2.5-flash` via configurable `GEMINI_MODEL` env (free tier). Endpoint:
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=…`.
- **Excel export:** `exceljs` (new dependency). CSV built server-side without a dependency.
- **OAuth consent screen:** Internal to everestfleet.in Workspace — any org user can consent to the
  Sheets + Drive scopes without Google app verification.
- **One Google connection per department** (`google_connections` unique on `department_id`); reconnect
  updates it.

---

## 3. Phase A — Google connection module (reusable)

Designed so the later report-reshaping and Gmail tools can reuse it; scopes live in one config.

### Table `google_connections` (RLS)
```
id                     uuid pk default gen_random_uuid()
department_id          uuid not null references departments(id) on delete cascade, unique
connected_by           uuid references profiles(id)
google_email           text
refresh_token_encrypted text not null      -- AES-256-GCM, see below
scopes                 text[] not null
created_at, updated_at timestamptz
```
RLS: select/insert/update/delete allowed when `is_super_admin(auth.uid())` or
`is_member_of(department_id, auth.uid())`. (Mutations from server routes go through the user-scoped
client so RLS applies; the service-role client is not used for connection storage.)

### Encryption
- `lib/google/crypto.ts`: AES-256-GCM using a 32-byte key from `TOKEN_ENCRYPTION_KEY` (base64).
  Stored value = `base64(iv).base64(authTag).base64(ciphertext)`. Encrypt on store, decrypt on use.
  The refresh token is never sent to the client.

### Scope config (`lib/google/scopes.ts`)
```
SCOPES = {
  sheets: "https://www.googleapis.com/auth/spreadsheets",       // read + write (results tab)
  driveReadonly: "https://www.googleapis.com/auth/drive.readonly",
  // gmail: "..."  // added by a later tool
}
SCRAP_SCALE_SCOPES = [SCOPES.sheets, SCOPES.driveReadonly]
```

### Routes
- `GET /api/google/oauth/start?department=<slug>` — server builds the consent URL
  (`access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, scopes, state=signed
  department+nonce) and redirects to Google. Auth-guarded (must be a member of the department).
- `GET /api/google/oauth/callback` — exchanges `code` for tokens server-side, reads granted scopes +
  the connected account email (id_token / userinfo), upserts the encrypted refresh token into
  `google_connections`, redirects back to the tool with a success flag. (Path matches the existing
  OAuth client redirect URI `http://localhost:3000/api/google/oauth/callback`.)

### `lib/google/connection.ts`
- `getConnection(departmentId)` → row or null.
- `getAccessToken(departmentId)` → mints a fresh access token from the stored refresh token (token
  endpoint), returns `{ accessToken, scopes }`. Throws a typed `ReconsentRequired` error if no
  connection or if required scopes are missing, so the UI can prompt re-consent.

---

## 4. Phase B — Scrap Scale tool

### New tables (all Accounting-scoped RLS via `is_member_of(department_id, …)` + super_admin)
```
ocr_cache (
  file_id     text primary key,        -- Drive file id
  department_id uuid not null references departments(id),
  amount      numeric, currency text, txn_id text, date text,
  confidence  numeric, raw_json jsonb, fetched_at timestamptz default now()
)

scrap_scale_runs (
  id uuid pk, department_id uuid not null, created_by uuid,
  spreadsheet_id text not null, sheet_title text,
  detected_columns jsonb,             -- {link:{index,header}, expected:{index,header}, name:{index,header}}
  status text check (status in ('pending','reading','processing','writing','done','error')),
  total_rows int default 0, processed_rows int default 0,
  summary jsonb,                      -- aggregates (see §4.5)
  results_tab_name text, error text,
  created_at timestamptz default now()
)

scrap_scale_run_rows (
  id uuid pk, run_id uuid not null references scrap_scale_runs(id) on delete cascade,
  row_index int not null,             -- 1-based row in source sheet
  submitted_by text, links text[],
  expected_amount numeric, extracted_amount numeric, difference numeric,
  flagged bool, duplicate bool,
  status text check (status in ('ok','needs-review','note-row','pending')),
  ocr_details jsonb,                  -- per-link: {file_id, amount, txn_id, confidence, notes, thumb}
  unique (run_id, row_index)
)
```

### 4.1 Input & column detection
- UI field: paste Google Sheet URL + Run. Extract spreadsheet id from URL
  (`/spreadsheets/d/<ID>/`). `gid` (tab) optional; default first sheet, user can pick the tab.
- `detect-columns` route: reads header row + a sample of data rows via Sheets API.
  - Normalize headers (lowercase, strip non-alphanumerics).
  - Link column ≈ `uploadtransactiondetails`; expected column ≈ `totalfundcollection`; name column
    optional (≈ `name`/`submittedby`).
  - If multiple link-header matches: pick the one whose sampled cells contain Drive links; if both do,
    return `ambiguous` so the UI asks the user to choose.
  - Response includes all headers + indices so the user can **override** any detection before running.

### 4.2 Reading screenshots
- A link cell may contain **multiple** Drive links (comma/newline/space separated). Split; parse file
  ids from both `open?id=<ID>` and `/file/d/<ID>/` forms. `lib/scrap-scale/links.ts` (pure, unit
  tested).
- Download each image via Drive `files.get?alt=media` using the access token from Phase A.
- Rows with no valid Drive link → `note-row`, excluded from math, surfaced in results.

### 4.3 OCR (Gemini Flash)
- `lib/scrap-scale/ocr.ts`: POST image (base64 inline) + a strict prompt to Gemini, requesting
  **JSON only**: `{ amount:number|null, currency:string, txn_id:string|null, date:string|null,
  confidence:number, notes:string }`. Prompt: read Indian UPI/bank-app screenshots (GPay, PhonePe,
  Paytm, banks), return the actual paid/transaction amount when multiple numbers appear, `amount:null`
  + reason if unreadable. Parse defensively (strip ```` ``` ```` fences, validate shape).
- Results cached in `ocr_cache` keyed by file id; cached ids skipped unless **force re-scan**.

### 4.4 Processing engine (chunked, throttled, resumable)
- `process-chunk` route handles the next batch of unprocessed (run_row, link) units for a run.
- Concurrency-limited queue (≈5 concurrent) + per-minute cap; **exponential backoff** on HTTP 429 /
  quota for both Gemini and Drive. `lib/scrap-scale/queue.ts` (pure-ish, unit tested for limit/backoff).
- After each chunk: persist row results, bump `processed_rows`, return `{processed, total, subtotal,
  done}`. Browser loops until `done`, rendering a progress bar + running subtotal.
- Resumable: state lives in Supabase; re-invoking `process-chunk` continues from unprocessed rows.

### 4.5 Computation & flags (per row)
- `extracted_amount = Σ valid OCR amounts among the row's links`.
- `difference = round(extracted - expected, 2)`.
- `flagged = difference !== 0.00` (strict, no tolerance).
- Any unreadable link in a row → row `status = needs-review` (not silently 0).
- Pure functions in `lib/scrap-scale/compute.ts` (unit tested), incl. rounding to avoid float noise.

### 4.6 Duplicate detection
- After processing, group all rows by **normalized non-null `txn_id`** (trim, uppercase, strip
  spaces). Any group with >1 member → mark every member `duplicate = true`. Pure + unit tested.

### 4.7 Outputs
1. **Results table**: row#, submitted-by, link(s), Expected (Total Fund Collection), Extracted,
   Difference, Flag, Duplicate?, status. Clicking a row reveals the source screenshot(s) (Drive
   thumbnail/served via a server image proxy route) + what OCR read.
2. **Reconciliation summary** (top): total rows, reconciled (diff=0), flagged (diff≠0), duplicates,
   needs-review, note rows; Σ Extracted, Σ Expected, net difference.
3. **Write-back**: `writeResultsTab` adds a new sheet named `ScrapScale YYYY-MM-DD HHMM` via Sheets
   `batchUpdate addSheet`, then writes original rows + 3 appended columns (Extracted Values,
   Difference, Flag). **Never** modifies/overwrites the original tab.
4. **Export**: CSV (server-built) + Excel (`exceljs`) download of the instance.

### 4.8 Instances & history
- Every run persisted (runs + run_rows + summary). **History view** lists past instances for a
  spreadsheet id. **Compare two instances**: rows whose status/flag changed + totals delta.

---

## 5. Constraints & security

- All Google + Gemini calls server-side (route handlers). No tokens/keys in the client bundle.
- Reuse the Phase-A connection module + the Accounting access guard (`requireDepartmentAccess('accounting')`).
- `.env.example` adds: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`.
- Registry entry for Scrap Scale swapped from stub to the real component.
- README updated: scopes note, internal-account guidance, usage.

## 6. Out of scope

Tesseract fallback (the earlier prompt mentioned it; the user opted to provide a Gemini key, so the
fallback is deferred — `amount:null` + reason is the unreadable path). Report reshaping and Gmail tools
(later prompts) — but Phase A is built to be reused by them.

## 7. Testing & verification

- **Unit (Vitest):** link parsing (multi-link, both URL forms, junk), compute (sum/round/flag,
  needs-review), duplicate grouping (txn_id normalization), AES-GCM round-trip, queue limit/backoff,
  column-detection normalization + ambiguity.
- **End-to-end:** connect Google as `vansh.sood@everestfleet.in` (Internal app) → paste a real sheet
  URL → detect columns → Run → live progress → results table + summary → verify a new
  `ScrapScale …` tab appears in the sheet with the 3 appended columns and the original tab untouched →
  re-run is fast (cache hits) → CSV/Excel download → history shows the instance.

## 8. Build order (for the plan)

1. Env + `google_connections` migration + AES-GCM crypto (+ unit test).
2. OAuth start/callback routes + `connection.ts` (token mint, ReconsentRequired).
3. Scrap Scale migrations (ocr_cache, runs, run_rows).
4. Pure libs: links, compute, duplicates, queue (+ unit tests) — TDD.
5. Sheets/Drive read layer + column detection route.
6. Gemini OCR client + cache.
7. `process-chunk` engine (throttle/backoff/resume).
8. Write-back tab.
9. UI: connect state, paste+detect+override, Run+progress, results table+drill-down, summary, exports.
10. Instances history + compare view.
11. Registry swap, `.env.example`, README. End-to-end verification.
