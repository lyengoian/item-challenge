# Running locally

How to install, run, test, and validate this solution on your machine.

## Prerequisites

- [Node.js 22+](https://nodejs.org)
- [pnpm](https://pnpm.io/installation) (app + unit tests)
- npm (comes with Node, used for the CDK app under `infrastructure/`)
- Optional: AWS CLI + [DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html) if you want to test the DynamoDB storage setup

## 1. Install dependencies

From the **repo root** (API, handlers, Vitest):

```bash
pnpm install
```

From **`infrastructure/`** (CDK):

```bash
npm install
```

## 2. Run the API (in-memory storage)

Default local mode (no DynamoDB required):

From the **repo root** 

```bash
pnpm dev
```

Server listens at `http://localhost:3000`. You should see `📦 Using in-memory storage`.

Manual curl smoke tests: see [API_TESTING.md](./API_TESTING.md).

## 3. Run unit tests

From the repo root:

```bash
pnpm test
```

Vitest runs the handler suite under `src/__tests__/`.

## 4. Validate infrastructure (CDK)

```bash
cd infrastructure
cdk synth
# or with an environment:
cdk synth --context env=dev
cdk synth --context env=prod
```

All should complete without errors.

## 5. Optional: DynamoDB Local

To run the same API against the real `DynamoDBStorage` implementation instead of in-memory:

1. Start DynamoDB Local and create the `ExamItems` table (with GSI).
2. Export `USE_DYNAMODB`, `DYNAMODB_TABLE_NAME`, `DYNAMODB_ENDPOINT`, and dummy AWS credentials.
3. Run `pnpm dev` and use the same curls as in [API_TESTING.md](./API_TESTING.md).

Full steps (create/reset table, env vars, curls) are in [**API_TESTING.md -> Optional: DynamoDB Local**](./API_TESTING.md).