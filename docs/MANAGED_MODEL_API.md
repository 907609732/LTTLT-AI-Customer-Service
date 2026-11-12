# Managed model configuration API

The native New API checkout is pinned in `managed-server/upstream.lock.json` (AGPL-3.0-or-later). The 28 provider IDs match approved clear-v10. Real native adapters handle the upstream protocol. Configuration support is not a claim of live provider credential acceptance.

## Read

`GET /api/lingtu/admin/config` retains `policy`, `model_providers`, `login_providers`, and `smtp`, and adds:

```ts
type ModelProvider = {
  provider: string; name: string;
  category: 'domestic' | 'global' | 'platform' | 'selfhost';
  channel_type: number;
  base_url: string; upstream_model: string;
  credential_format: string; required_fields: string[]; setup_url: string;
}
type ModelConnection = {
  connection_id: number; provider: string; name: string;
  model_id: string; // stable managed selection, not upstream model name
  base_url: string; upstream_model: string;
  api_version: string; region: string; account_id: string;
  configured: boolean; // selfhost needs no credential; otherwise stored key present
  enabled: boolean; // administrator's desired enabled state
  ready: boolean; // actual native channel enabled, current fingerprint, configured
  is_default: boolean; // exact policy.default_model match
  revision: number;
  test_status: 'never' | 'success' | 'failed' | 'stale';
  tested_at: number; // Unix seconds; 0 when never/stale
}
// response.model_catalog: ModelProvider[]
// response.model_connections: ModelConnection[]
```

Catalog endpoints/models are form suggestions only. The client must send the displayed endpoint/model explicitly. Empty strings are not silently replaced by suggestions. Azure deployment, Bedrock region and Vertex region cannot be inferred. Native selfhost providers may use HTTP/private endpoints; all other configurable endpoints require public HTTPS, prohibit URL credentials/query/fragment, and are checked against private DNS addresses before test/routing. Spark's native WebSocket adapter uses its fixed official endpoint. Bedrock's native SDK derives the endpoint from the credential region; its base_url must remain empty.

## Write

`POST /api/lingtu/admin/config` uses the existing interactive administrator session, `admin.user.managed_config` verification operation and `X-Security-Proof`. The operation context is `{section:'model_connection',request_hash:sha256(exactBodyBytes)}`. Serialize once, hash those same bytes and submit them unchanged. Never log the body, credential, proof or provider error.

```ts
type ModelConnectionRequest = {
  section: 'model_connection';
  action: 'save' | 'test' | 'select' | 'delete';
  provider: string;
  connection_id: number; // 0 for new save; existing native channel ID otherwise
  revision?: number; // optimistic expected revision, strongly recommended
  name?: string; secret?: string; clear_secret?: boolean;
  base_url?: string; upstream_model?: string; enabled?: boolean;
  api_version?: string; region?: string; account_id?: string;
  make_default?: boolean;
}
```

Save sends the complete editable form (`name`, endpoint, upstream model, enabled and applicable platform fields). Blank/omitted `secret` retains the current encrypted credential. `clear_secret:true` clears it; it is mutually exclusive with a nonempty secret. Clearing while enabling fails for providers that require credentials. Selfhost keys are optional. Changed saved configuration invalidates the prior test, disables its native channel and increments revision. Save is persistent without a network call and never changes the default. `make_default:true` on save is rejected: save, test and explicitly select are separate operations.

Test sends `connection_id`, `provider`, optional expected `revision`, and action only. It tests the saved configuration with the native adapter. It never saves unsaved form edits, routes another connection, enables a different connection, changes defaults, counts as a customer call or exposes upstream error text. A successful current test enables the native channel only when `enabled` is true. A failed test leaves the saved configuration present and marks the test failed. A configuration changed during the probe cannot receive the result for an earlier revision.

Select explicitly updates `policy.default_model` to this connection's stable model_id. It requires the current saved configuration to have tested successfully and be enabled. Other trial limits/grants and account-specific model choices are preserved. There is one global default. Each account can also explicitly select a connection's model_id; an empty account model follows the global default. Saving or testing another API never switches that selection.

Delete removes only the selected connection metadata, its native Channel and abilities in a transaction. The current global default and any connection explicitly assigned to an account cannot be deleted. There is no automatic substitute/fallback.

Success returns `{saved:true,tested:action==='test',policy,model_connections}` (sanitized). Refresh this state after every action. Validation/selection errors are HTTP 400 `configuration_update_failed`; no raw provider error is returned. A failed saved-connection test returns HTTP 400 `{saved:true,tested:false,error:'model_connection_test_failed',policy,model_connections}`; `saved` is false if that connection does not exist. A network test failure is a failed test of the previously saved configuration, not evidence that the earlier save failed. Fetch config after any unconfirmed response.

## Specialized credentials

These are native formats, shown in `credential_format`, not fabricated single API keys:

| Provider | Required input | Native location |
| --- | --- | --- |
| azure | API Key; resource base_url; deployment in upstream_model; api_version | encrypted Channel.Key; Channel.Other version |
| bedrock | `APIKey\|Region` or `AccessKeyID\|SecretAccessKey\|Region`; explicit model ID; empty base_url | complete native credential encrypted in Channel.Key |
| vertex | service account JSON with type/project_id/client_email/PKCS8 private_key; region; explicit model ID | full JSON encrypted in Channel.Key; Channel.Other region; fixed Google token endpoint |
| hunyuan | `AppID\|SecretID\|SecretKey` | encrypted Channel.Key, native TC3 adapter |
| spark | `AppID\|APISecret\|APIKey`; native model/domain | encrypted Channel.Key, native WebSocket adapter |
| cloudflare | API token; account_id (32 hexadecimal characters); model ID | encrypted Channel.Key; Channel.Other account ID |

Service account JSON is accepted as an encrypted credential; it is never returned. No specialized provider can be represented as ready solely by saving arbitrary text. Test it with valid credentials before selection. These flows do not claim every provider/model supports every modality. Existing qwen3-vl-plus image requests remain preserved.

## Migration, routing and ledger

Startup idempotently binds existing `lingtu-deepseek`, `lingtu-qwen`, `lingtu-qwen-vision` channels to their exact old `deepseek-flash`, `qwen-plus`, `qwen3-vl-plus` model IDs. IDs, keys, native adapter type, model parameters, abilities, grants and selected policy are preserved. Existing old save sections remain supported. Legacy channels without historical test time remain usable if previously enabled; selecting one through the new API requires an explicit current test.

New connections use stable `managed-<nativeChannelID>` model IDs. Native relay receives the actual upstream model and is pinned to the exact Channel ID using the existing server-only internal token mechanism. The persistent internal token keeps its legacy allowlist; the managed request's per-request native model allowlist is narrowed to that exact upstream model. There is no random provider choice, fallback or managed retry.

`lingtu_model_connections` stores only binding metadata, desired enabled state, revision and test/config fingerprints. Credentials remain in native encrypted `channels.key`. Native channel/abilities/binding/default updates commit together, and native cache refresh occurs only after commit. Test hashes never leave the server. Existing unmanaged native channels are not exposed as managed connections.

Customer usage rows now snapshot `channel_id`, `channel_name` and `upstream_model` at preparation time, alongside the stable selected `model`. Existing historical rows migrate with channel_id=0 and empty name/upstream model: unknown, never reconstructed from today's routing. Probes write no managed customer usage. Missing actual upstream usage remains unknown; no token estimates are introduced.

The sanitized `smtp` object also includes native `enabled`, `registration_enabled` and `email_verification` booleans. Stored key presence is reported separately by `configured` and must not be treated as an enable switch.
