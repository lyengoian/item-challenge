# API Testing Guide

My manual smoke tests for the four implemented endpoints. Run `pnpm dev` first, then
hit `http://localhost:3000` from a second terminal.

By default the server uses **in-memory storage**. To use DynamoDB storage
locally, I used the optional setup below (with guidance from the `dynamodb.ts` file which also had setup instructions). The curl commands are the same either way.

Not covered here (unimplemented by design): `POST /api/items/:id/versions` and
`GET /api/items/:id/audit`. See `ARCHITECTURE.md`.

---

## Optional: DynamoDB Local

Useful to confirm `DynamoDBStorage` (not just in-memory) against
the same API. Requires [DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html)
and the AWS CLI. Followed the instructions from `dynamodb.ts` for setup.

**1. Start DynamoDB Local** (from the directory where it was unpacked):

```bash
java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -sharedDb
```

**2. Create the table** (if it doesn’t exist yet). Dummy credentials are enough for Local:

```bash
export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=local
export AWS_DEFAULT_REGION=us-east-1

aws dynamodb create-table \
  --endpoint-url http://localhost:8000 \
  --table-name ExamItems \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=subject,AttributeType=S \
    AttributeName=status,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes '[
    {
      "IndexName": "SubjectStatusIndex",
      "KeySchema": [
        {"AttributeName": "subject", "KeyType": "HASH"},
        {"AttributeName": "status", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    }
  ]' \
  --billing-mode PAY_PER_REQUEST
```

**Resetting the table (optional)** — delete and re-run the `create-table` command above to make a clean slate:

```bash
export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=local
export AWS_DEFAULT_REGION=us-east-1

aws dynamodb delete-table \
  --endpoint-url http://localhost:8000 \
  --table-name ExamItems
```

Confirm it’s gone:

```bash
aws dynamodb list-tables --endpoint-url http://localhost:8000
```

**3. Start the API pointed at Local** (same dummy credentials in this shell):

```bash
export USE_DYNAMODB=true
export DYNAMODB_TABLE_NAME=ExamItems
export DYNAMODB_ENDPOINT=http://localhost:8000
export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=local
export AWS_DEFAULT_REGION=us-east-1

pnpm dev
```

 `📦 Using DynamoDB storage` should be visible in the console. Then run the curl steps below in a
second terminal.

---

## 1. Create an item

```bash
curl -s -i -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "AP Biology",
    "itemType": "multiple-choice",
    "difficulty": 3,
    "content": {
      "question": "What is photosynthesis?",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "A",
      "explanation": "Photosynthesis is the process by which plants convert light into energy."
    },
    "metadata": {
      "author": "lily",
      "status": "draft",
      "tags": ["biology", "photosynthesis"]
    },
    "securityLevel": "standard"
  }' 
```

**Expected:** `201`, response includes `id`, `metadata.version: 1`.
**Copy the returned `id`**: every command below needs it. This will be the `ITEM_ID`.

---

## 2. Get the item by ID

```bash
curl -s -i http://localhost:3000/api/items/ITEM_ID 
```

**Expected:** `200`, full item body matching what was created.

---

## 3. Update the item (first update: version 1 -> 2)

```bash
curl -s -i -X PUT http://localhost:3000/api/items/ITEM_ID \
  -H "Content-Type: application/json" \
  -d '{
    "difficulty": 5,
    "metadata": { "status": "review" }
  }' 
```

**Expected:** `200`, `difficulty: 5`, `metadata.status: "review"`,
`metadata.version: 2`.

---

## 4. Update again (version 2 -> 3): confirms versioning increments correctly

```bash
curl -s -i -X PUT http://localhost:3000/api/items/ITEM_ID \
  -H "Content-Type: application/json" \
  -d '{
    "metadata": { "status": "approved" }
  }' 
```

**Expected:** `200`, `metadata.status: "approved"`, `metadata.version: 3`,
and `difficulty` should still be `5` from the previous update (partial
updates don't change untouched fields).

---

## 5. List items

```bash
# Basic list with pagination
curl -s -i "http://localhost:3000/api/items?limit=5&offset=0" 

# Filter by subject
curl -s -i "http://localhost:3000/api/items?subject=AP%20Biology" 

# Filter by status
curl -s -i "http://localhost:3000/api/items?status=approved" 
```

**Expected:** `200` for all three. `ITEM_ID` should appear in the first two
result sets, and in the third since we set it to `"approved"` in step 4.

---

## Error / validation paths

These confirm the API fails safely and with useful messages

```bash
# 404: item doesn't exist
curl -s -i http://localhost:3000/api/items/bananas
# Expected: 404, body.error: "Item not found"

# 400: create with missing required fields
curl -s -i -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d '{"subject": "AP Bio"}' 
# Expected: 400, body.error: "Validation failed", details listing missing fields

# 400: invalid enum value (invalid status value)
curl -s -i -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "AP Bio", "itemType": "multiple-choice", "difficulty": 3,
    "content": {"question": "q", "correctAnswer": "a", "explanation": "e"},
    "metadata": {"author": "me", "status": "bananas", "tags": []},
    "securityLevel": "standard"
  }' 
# Expected: 400, error mentions "bananas" isn't one of the allowed status values

# 400: difficulty out of range (spec says 1-5)
curl -s -i -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "AP Bio", "itemType": "multiple-choice", "difficulty": 8,
    "content": {"question": "q", "correctAnswer": "a", "explanation": "c"},
    "metadata": {"author": "Lilit", "status": "draft", "tags": []},
    "securityLevel": "standard"
  }' 
# Expected: 400, error on difficulty exceeding max

# 404: update on nonexistent item
curl -s -i -X PUT http://localhost:3000/api/items/bananas \
  -H "Content-Type: application/json" \
  -d '{"difficulty": 1}' 
# Expected: 404, body.error: "Item not found"

# 400: update with invalid difficulty
curl -s -i -X PUT http://localhost:3000/api/items/ITEM_ID \
  -H "Content-Type: application/json" \
  -d '{"difficulty": 10}'
# Expected: 400, body.error: "Validation failed"
```

---

## Quick reference: implemented endpoints

| Method | Path | Handler | Notes |
|---|---|---|---|
| `POST` | `/api/items` | `createItemHandler` | Validated with `CreateItemSchema` |
| `GET` | `/api/items/:id` | `getItemHandler` | `404` if missing |
| `PUT` | `/api/items/:id` | `updateItemHandler` | `UpdateItemSchema`: bumps `metadata.version` and writes `METADATA` + new `VERSION#n` |
| `GET` | `/api/items` | `listItemsHandler` | `ListItemsSchema`: `limit`, `offset`, `subject`, `status` |

| Method | Path | Status |
|---|---|---|
| `POST` | `/api/items/:id/versions` | Not implemented |
| `GET` | `/api/items/:id/audit` | Not implemented |
