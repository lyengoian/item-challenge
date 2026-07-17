# Architecture Documentation

Design decisions and implementation approach for the exam item management API.

## What's implemented

Four endpoints are implemented end to end, including handlers, Zod validation, tests, local routing, and CDK:

| Method | Path | Handler |
| --- | --- | --- |
| `POST` | `/api/items` | `createItemHandler` (starter + added Zod validation) |
| `GET` | `/api/items/:id` | `getItemHandler` (starter) |
| `PUT` | `/api/items/:id` | `updateItemHandler` (implemented) |
| `GET` | `/api/items` | `listItemsHandler` (implemented) |

`createVersionHandler` and `getAuditTrailHandler` were left unimplemented at the API layer. The DynamoDB key design below was built so they can be added later without reshaping storage.

**Note on reused logic:** the starter's `src/storage/memory.ts` already implements version-increment-on-update and subject/status filtering with offset/limit pagination for the in-memory backend. My DynamoDB implementation follows that same increment and filter/pagination logic where it's storage-agnostic (it's simple, correct, and there's no reason to reinvent it), but the actual storage mechanism (how and where version history and current state get persisted) is a different design built specifically for DynamoDB, described below.

---

## Data Model Design

Each exam item can have many versions over time. The starter's in-memory storage keeps history in a second Map<string, ExamItem[]>, meaning that for each item id, an array it just pushes new versions onto. DynamoDB has no equivalent to "one key holding a growing array of full objects": items are capped at 400KB, so an ever-growing version array would eventually hit that ceiling, and reading the current item would mean loading the entire history just to get the latest entry. The standard DynamoDB pattern for one entity with many related records is separate rows sharing a partition key, queried together, which is a structurally different approach. That's what's designed below.

**Single-table DynamoDB design.** Every record for one item shares `PK = ITEM#<id>`. The sort key distinguishes record types:

| SK | Purpose |
| --- | --- |
| `METADATA` | Current / latest state |
| `VERSION#<n>` | Immutable snapshot of version *n* (audit trail) |

An item with 3 versions would have 4 rows: one `METADATA` + `VERSION#1`…`VERSION#3`.

**Access patterns**

| Pattern | Operation |
| --- | --- |
| Get current item | `GetItem(PK=ITEM#<id>, SK=METADATA)` (cost stays flat as history grows) |
| Get audit trail | `Query(PK=ITEM#<id>, SK begins_with VERSION#)` |
| List / filter by subject + status | Intended: `Query` on GSI `SubjectStatusIndex` (see known limitation below) |

On create/update, storage overwrites `METADATA` and appends a new `VERSION#n` row. Older version rows are never mutated. The `metadata.version` increment itself (`version + 1`) follows the same logic already used in the starter's `memory.ts`.

**GSI: `SubjectStatusIndex`.** Partition key `subject`, sort key `status`. The primary key is organized around "everything for one item," not "all items in a subject," so this index supports filtered listing without a full-table scan.

**GSI attribute note.** DynamoDB GSI keys must be top-level attributes. `subject` already is. `status` lives under `metadata.status`, so each write also stores a flat `status` copy for the index. Callers still receive a normal `ExamItem`. `getItem` / `listItems` strip `PK`, `SK`, and that flat `status` before returning. This was caught and fixed after initial implementation (the GSI would not have populated correctly on `status` without it) and verified against a real DynamoDB Local instance (see Testing).

---

## Infrastructure Choices

Defined with AWS CDK in `infrastructure/`.

**One Lambda per endpoint.** Four `NodejsFunction`s (`create` / `get` / `update` / `list`) instead of one shared handler so each gets least-privilege IAM and isolated cold starts / concurrency. `get`/`list` use `grantReadData`. `create`/`update` use `grantReadWriteData`.

**API Gateway REST API.** Routes:

- `POST /api/items`, `GET /api/items` -> create / list Lambdas
- `GET /api/items/{id}`, `PUT /api/items/{id}` -> get / update Lambdas

**DynamoDB on-demand (`PAY_PER_REQUEST`).** Avoids guessing provisioned capacity. This fits the scenario of bursty exam-authoring traffic better than steady provisioned throughput. Generally recommended for unpredictable or spiky traffic, and ideal for apps with traffic that fluctuates wildly or has sudden, unexpected spikes, like flash sales, ticket releases, or an exam day.

**Explicit CloudWatch log groups.** Declared in CDK with retention from env config, instead of Lambda's default of retaining forever.

**Environment-specific config.** `EnvConfig` keyed by CDK context `env` (`cdk synth --context env=prod`, defaults to `dev`):

| | Dev | Prod |
| --- | --- | --- |
| Table name | `ExamItems-dev` | `ExamItems-prod` |
| Removal policy | `DESTROY` | `RETAIN` |
| Log retention | 1 week | 1 month |
| Lambda memory | 128 MB | 256 MB |
| API stage | `dev` | `prod` |

**Lambda adapter (`src/handlers/lambda-adapter.ts`).** Local handlers take plain args and return `{ statusCode, body: object }`. API Gateway expects `APIGatewayProxyEvent` and a JSON-string `body`. Adapters translate so business logic stays testable without AWS-specific shapes. CDK points each function at its adapter export.

**Bundling with `NodejsFunction`.** esbuild bundles `@aws-sdk`, `zod`, etc. at synth time. `Code.fromAsset('../dist')` alone would ship `tsc` output without `node_modules` and fail at runtime on AWS. Because handlers live under repo-root `src/` (outside `infrastructure/`), `projectRoot` is set to the repo root so CDK accepts the entry path. Caught after initial `cdk synth` passed. synth alone doesn't validate that a Lambda's actual dependencies would run on AWS.

Validated with `cdk synth --context env=dev` and `cdk synth --context env=prod`.

---

## Scalability

- **Current-item reads** stay O(1) on the item via `METADATA`, regardless of version count. Only audit queries grow with history.
- **Compute / storage** scale via Lambda concurrency and DynamoDB on-demand. No manual capacity planning for normal load.
- **Partitioning** by `ITEM#<id>` spreads load and avoids a single hot partition for all writes.
- **List path** today uses `Scan` (see trade-offs). At scale that is the main bottleneck. The GSI is already defined so list can move to `Query`.
- **Abuse / spikes:** on-demand does not fully protect against bot traffic. Production follow-up: API Gateway throttling and optionally AWS WAF.

---

## Security

**Least-privilege IAM.** Each Lambda only gets the DynamoDB actions it needs (read vs read/write).

**Input validation.** Zod schemas reject malformed bodies/queries before storage. `status` and `securityLevel` use `z.enum([...])`. `ItemStatus` / `SecurityLevel` in `src/types/item.ts` are derived with `z.infer` from the same enums, one source of truth at compile time and runtime.

**`securityLevel` (not enforced yet).** Present on the model (`standard` / `secure` / `highly-secure`) for future controls:

- Authorization checks against the requester's role/clearance before returning content
- Separate access audit logging for highly-secure reads
- Field-level encryption for sensitive fields like `content.correctAnswer` and `content.explanation` on highly-secure items

**API authentication.** Not implemented. Production should use an API Gateway authorizer (Lambda authorizer or Cognito). Exam content leakage before test day is an integrity risk, not just a generic CRUD concern.

---

## Trade-offs

I deliberately prioritized basic CRUD (create, get, update, and list) because those are the paths every exam-item workflow needs first. Version and audit APIs are unimplemented, but the key design already supports them (`VERSION#` rows and a straightforward `Query`).

Implementing `DynamoDBStorage` was optional. The starter’s in-memory backend already supports local CRUD, including bumping `metadata.version` on update. I still built the DynamoDB layer so I could validate the single-table design against a real DynamoDB Local instance. That let me confirm `METADATA` + `VERSION#n` rows, the denormalized GSI `status` field, and that CDK’s `USE_DYNAMODB=true` path has a working storage implementation behind it. (`createVersion` / `getAuditTrail` remain unimplemented in DynamoDB until those API routes exist, but updates already append `VERSION#n` history as a side effect of normal edits.)

**Known limitation:** `listItems` still uses a table `Scan`. This is fine for a small dataset and local dev with a few test items, but of course not for production scale. The GSI is defined in CDK (and in the Local create-table), and writes include the top-level `subject` / `status` attributes it needs (confirmed on DynamoDB Local). I have not switched `listItems` to Query that index. With more time, wiring `listItems` to `QueryCommand` on `SubjectStatusIndex` would be the next task.

**What I'd dig into next on security / abuse protection.** With more time I'd put Cognito (or another API Gateway authorizer) in front so every request is tied to an authenticated user, then enforce role-based access (and `securityLevel` checks). I'd also enable API Gateway throttling / usage plans to limit abusive traffic, and put AWS WAF in front of the API for bot-style and common web attacks before they reach Lambda or DynamoDB. Field-level encryption (like KMS) for highly-secure answers could sit on top of that.

**Testing**

- How to run locally: see [RUNNING_LOCALLY.md](./RUNNING_LOCALLY.md).
- Unit tests (`pnpm test`): 11 Vitest cases covering create/get/update/list. Success paths, 404s, validation 400s, version bump, and partial-update field preservation. Scoped via `include: ["src/**/*.{test,spec}.ts"]` in `vitest.config.ts` so CDK `cdk.out` / infra `node_modules` aren't picked up.
- Manual smoke tests: see [API_TESTING.md](./API_TESTING.md) (in-memory by default).
- DynamoDB Local: table and `SubjectStatusIndex` GSI created manually, then verified end-to-end (create -> get -> update -> list) with `USE_DYNAMODB=true`. After create + two updates, a direct `aws dynamodb query` on the item’s PK showed four rows: `METADATA` (latest) plus immutable `VERSION#1`…`VERSION#3` with top-level `status` matching `metadata.status` on each row.