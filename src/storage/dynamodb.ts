/**
 * DynamoDB Storage Implementation (Optional)
 *
 * This implementation uses AWS DynamoDB for persistent storage.
 *
 * To use this:
 * 1. Set environment variable: USE_DYNAMODB=true
 * 2. Configure AWS credentials (or use DynamoDB Local)
 * 3. Set DYNAMODB_TABLE_NAME (or use default "ExamItems")
 *
 * For DynamoDB Local:
 * - Download from: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html
 * - Run: java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -sharedDb
 * - Set DYNAMODB_ENDPOINT=http://localhost:8000
 * 
 * DynamoDB storage for exam items.
 *  PK = Partition Key; SK = Sort Key.
 *  Single-table layout:
 *    PK = ITEM#<id>; SK = METADATA; -> current state of the item
 *    PK = ITEM#<id>; SK = VERSION#<n> -> snapshot of version n
 * This lets us fetch the current item with a single GetItem call, and fetch
 * the full version history with a single Query (PK match, SK begins_with
 * "VERSION#"), without needing a separate versions table.
*/

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { ExamItem, CreateItemRequest, UpdateItemRequest, ListItemsQuery } from '../types/item.js';
import { ItemStorage } from './interface.js';

const itemPK = (id: string) => `ITEM#${id}`;
const metadataSK = () => 'METADATA';
const versionSK = (version: number) => `VERSION#${version}`;

export class DynamoDBStorage implements ItemStorage {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    const dynamoClient = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && { endpoint: process.env.DYNAMODB_ENDPOINT }),
    });

    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = process.env.DYNAMODB_TABLE_NAME || 'ExamItems';
  }

  async createItem(data: CreateItemRequest): Promise<ExamItem> {
    const now = Date.now();
    const id = randomUUID(); // moved this here since id will be used for the PK and SK too.
    const item: ExamItem = {
      id,
      ...data,
      metadata: {
        ...data.metadata,
        created: now,
        lastModified: now,
        version: 1,
      },
    };

    const pk = itemPK(id);

    /**
     * DynamoDB's SubjectStatusIndex GSI can only index top-level attributes,
     * but status lives nested at metadata.status. So along with the real
     * item, we also write a flat "status" copy just so the GSI has something
     * to key off of. This copy is stripped back out again in getItem/listItems
     * so that callers never see it.
     */
    const indexedRow = { PK: pk, SK: metadataSK(), ...item, status: item.metadata.status };

    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: indexedRow,
    }));

    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { PK: pk, SK: versionSK(1), ...item, status: item.metadata.status }, // Writing the first version of the item to the table.
    }));

    return item;
  }

  async getItem(id: string): Promise<ExamItem | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: itemPK(id), SK: metadataSK() }, // Getting the current state of the item.
    }));

    if (!result.Item) return null;

    /**
     * PK/SK are storage-internal keys, and "status" is a denormalized copy
     * of metadata.status kept only so the GSI can index on it. Strip both
     * before returning, since ExamItem doesn't include any of them.
     */
    const { PK, SK, status, ...item } = result.Item;
    return item as ExamItem;
  }

  async updateItem(id: string, data: UpdateItemRequest): Promise<ExamItem | null> {
    const existing = await this.getItem(id);
    if (!existing) return null;

    const updated: ExamItem = {
      ...existing,
      ...data,
      content: data.content ? { ...existing.content, ...data.content } : existing.content,
      metadata: {
        ...existing.metadata,
        ...(data.metadata || {}),
        lastModified: Date.now(),
        version: existing.metadata.version + 1,
      },
    };

    const pk = itemPK(id);

    /**
     * DynamoDB's SubjectStatusIndex GSI can only index top-level attributes,
     * but status lives nested at metadata.status. So on every write we also
     * copy it up to a flat "status" field, just for the GSI to key off of.
     * Has to happen here too (not just in createItem), since an update
     * might change the status and the flat copy would go stale otherwise.
     */
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { PK: pk, SK: metadataSK(), ...updated, status: updated.metadata.status },
    }));

    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { PK: pk, SK: versionSK(updated.metadata.version), ...updated, status: updated.metadata.status },
    }));

    return updated;
  }

  async listItems(query: ListItemsQuery): Promise<{ items: ExamItem[]; total: number }> {
    /**
     * Only current items (SK = METADATA) should appear in list results,
     * otherwise every historical version would also show up as a separate
     * "item." For filtering at scale, the SubjectStatusIndex GSI (see
     * infrastructure/lib/infrastructure-stack.ts) should be queried
     * directly instead of using Scan. Scan is used here for simplicity
     * given the exercise's time constraints, and would be a priority fix
     * before production.
     */
    const result = await this.client.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'SK = :metaSK',
      ExpressionAttributeValues: { ':metaSK': metadataSK() },
    }));

    let items = (result.Items || []).map(({ PK, SK, status, ...item }) => item as ExamItem);

    if (query.subject) {
      items = items.filter(item => item.subject === query.subject);
    }
    if (query.status) {
      items = items.filter(item => item.metadata.status === query.status);
    }

    const total = items.length;
    const offset = query.offset || 0;
    const limit = query.limit || 10;
    items = items.slice(offset, offset + limit);

    return { items, total };
  }

  async createVersion(id: string): Promise<ExamItem | null> {
    /**
     * Not implemented for this exercise: createVersion isn't wired to an
     * API endpoint in this submission. The PK/SK schema above is designed
     * to support it though. It would follow the same overwrite-METADATA +
     * add-new-VERSION# pattern used in updateItem.
     */
    throw new Error('Not implemented - see ARCHITECTURE.md for intended design');
  }

  async getAuditTrail(id: string): Promise<ExamItem[]> {
    /**
     * Not implemented for this exercise: getAuditTrail isn't wired to an
     * API endpoint in this submission. Intended implementation is a
     * single Query(PK = ITEM#<id>, SK begins_with "VERSION#"), returning
     * every version snapshot for the item in one request
     */
    throw new Error('Not implemented - see ARCHITECTURE.md for intended design');
  }
}
