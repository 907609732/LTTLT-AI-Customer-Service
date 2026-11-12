# Managed usage API

`GET /api/lingtu/admin/usage-daily?days=7&model=<selection>` uses the existing native administrator authentication and cache-disabled admin group. It is read-only. It never sends provider requests or buyer messages. The existing `/usage` request details and `/usage-summary` account summary responses are unchanged.

## Parameters

| Query | Contract |
| --- | --- |
| `days` | Optional; defaults to `7`. Only the literal values `7` and `30` are accepted. The range includes today. |
| `model` | Optional exact, case-sensitive stable client model selection from `model_options`. Omit to include all models, including records with an unknown selection. A nonempty selection with no matching records returns zero totals and empty days. |

Duplicate `days` or `model` parameters are rejected, even if their values match. An explicit empty model, a model longer than 128 UTF-8 bytes, invalid UTF-8, surrounding whitespace, control characters, or a malformed encoded query is rejected. Invalid parameters return HTTP 400 with `{"error":"invalid_request"}`. Database read failures return HTTP 503 with `{"error":"usage_unavailable"}`. Authentication failures retain the native administrator middleware's response.

## Exact success DTO

All counters are nonnegative JSON integers; token values are provider-reported counts only. A successful empty response contains arrays (`[]`), never `null`.

```ts
type UsageTotals = {
  requests: number;
  successes: number;
  failed: number;
  uncertain: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  unknown_usage: number;
};

type DailyUsageItem = UsageTotals & {
  date: string;            // YYYY-MM-DD, Beijing natural day
  model: string;           // stable client selection; empty when unknown
  channel_id: number;      // actual native API/channel ID at request time; 0 if unknown
  channel_name: string;    // API name snapshot at request time; empty if unknown
  upstream_model: string;  // actual upstream model snapshot; empty if unknown
};

type DailyUsageResponse = {
  scope: 'clients_only';
  timezone: 'Asia/Shanghai';
  days: 7 | 30;
  model: string;           // requested filter, or empty when omitted
  today: UsageTotals;      // Beijing today, with the same model filter
  totals: UsageTotals;     // complete selected range, with the same model filter
  items: DailyUsageItem[];
  model_options: string[]; // sorted unique nonempty selections in the range,
                          // BEFORE the model filter; excludes current configuration
};
```

`items` groups requests by `(date, model, channel_id, channel_name, upstream_model)`. The same selection can therefore have multiple rows on a day when it used different APIs or upstream models. Items sort ascending by date, model, channel ID, channel name, then upstream model. Sum rows with the same date for a daily chart, and sum rows with the same model for model distribution. Do not treat each row as a complete day. `totals` equals the sum of all item counters; `today` equals the sum of items for today's date. Pending requests count toward `requests` without incrementing the three final-state counters.

Each date with no matching requests has exactly one placeholder item: its date, all counters zero, `model`, `channel_name`, and `upstream_model` empty, and `channel_id: 0`. Placeholder rows are not unknown calls: their `requests` and `unknown_usage` are both zero. An empty filtered range has 7 or 30 such rows. An actual legacy request may also have an empty model and channel snapshot, but its request count is positive. The UI should label unavailable historical model/API values as unknown rather than use current configuration.

## Accounting and history

- The request ledger's `created_at` determines the day, including when the usage snapshot was saved later. UTC+8 day boundaries apply independently of the server's local timezone. The SQL query reads only `[first-day 00:00, tomorrow 00:00)` in Beijing time. It streams this bounded range and groups in Go for SQLite, MySQL, and PostgreSQL portability; it does not load all retained history. Exact Go string comparisons avoid MySQL's default case-insensitive model collation.
- Call counts come from actual client request ledger entries joined to usage by user ID and request ID. Standalone connection probes or orphan usage rows are excluded. Retries of the same request do not create extra rows because the existing ledger identity is unique.
- A complete explicit provider usage object containing zero input/output counts is known usage. It contributes a request, zero tokens, and zero unknown calls. Missing usage snapshots or `usage_known: false` contribute one unknown call and zero tokens even if legacy numeric columns are nonzero. Unknown usage is never estimated.
- `model` is the stable selection stored with the request. API ID, API name, and upstream model are snapshots already recorded by the managed request path. There is no join to current channels or model connections. Editing/deleting/reusing a channel cannot rewrite historic API identity. Older snapshots retain zero/empty values.
- `model_options` includes only models observed during this requested range, with no empty/unknown option. It stays available while a model filter is selected. It excludes models seen only outside the range or in probes, and models merely configured but never used.

## Verification

From `managed-server/.upstream` after `node scripts/prepare-managed-server.mjs` at the repository root:

```powershell
go test ./lingtuhost -run TestLingtuAdminUsageDaily -count=1
go test ./lingtuhost ./lingtu -count=1
```

The tests use isolated fixture databases and a fixed Beijing-midnight clock; no provider or buyer call is made. The existing `LINGTU_TEST_ENGINE` / `LINGTU_TEST_DSN` test harness supports dedicated MySQL and PostgreSQL databases named `lingtu_test`; portability is implemented without dialect-specific date functions. Actual engine runs must be reported separately from SQLite verification.
