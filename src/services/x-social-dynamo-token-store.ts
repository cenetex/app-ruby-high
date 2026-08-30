import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { XTokenRecord, XTokenStore } from "./x-social-service.js";

class DynamoXTokenStore implements XTokenStore {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    const region = process.env.AWS_REGION ?? "us-east-1";
    this.tableName = process.env.RUBY_HIGH_DYNAMO_TABLE ?? "ruby-high-state";
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  async loadAll(): Promise<XTokenRecord[]> {
    const records: XTokenRecord[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "begins_with(pk, :prefix)",
        ExpressionAttributeValues: { ":prefix": "x:token:" },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }));
      const items = (result.Items ?? []) as Array<Record<string, unknown>>;
      for (const item of items) {
        if (item.token && typeof item.token === "object") records.push(item.token as unknown as XTokenRecord);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return records;
  }

  async save(record: XTokenRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { pk: `x:token:${record.teacherId}`, token: record, updatedAt: Date.now() },
    }));
  }

  async delete(teacherId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: `x:token:${teacherId}` },
    }));
  }
}

export function createDynamoXTokenStore(): XTokenStore {
  return new DynamoXTokenStore();
}
