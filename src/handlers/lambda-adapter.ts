/**
 * Adapters between API Gateway and the plain handlers in handlers.ts
 *
 * Locally, handlers take normal args and return `{ statusCode, body: object }`.
 * Behind API Gateway they get an APIGatewayProxyEvent (path/query/body as strings) 
 * and must return a body that is a JSON string. These functions do
 * that translation so the tested business logic doesn't have to change.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  getItemHandler,
  createItemHandler,
  updateItemHandler,
  listItemsHandler,
} from './handlers.js';

// Turns a handler result into the response shape API Gateway expects
function toApiGatewayResult(result: { statusCode: number; body: unknown }): APIGatewayProxyResult {
  return {
    statusCode: result.statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body),
  };
}

/**
 * Parse the event body as JSON. Empty/missing bodies become `{}` so Zod
 * can return a normal 400 instead of crashing on JSON.parse(undefined).
 */
function parseBody(event: APIGatewayProxyEvent): any {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    /**
     * Bad JSON — hand an empty object to Zod so the client gets a 400
     * validation error instead of an unhandled 500 from the Lambda.
     */
    return {};
  }
}

export async function getItemLambdaHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const id = event.pathParameters?.id ?? '';
  const result = await getItemHandler(id);
  return toApiGatewayResult(result);
}

export async function createItemLambdaHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const data = parseBody(event);
  const result = await createItemHandler(data);
  return toApiGatewayResult(result);
}

export async function updateItemLambdaHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const id = event.pathParameters?.id ?? '';
  const data = parseBody(event);
  const result = await updateItemHandler(id, data);
  return toApiGatewayResult(result);
}

export async function listItemsLambdaHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  /**
   * Query params come in as strings. ListItemsSchema uses z.coerce.number()
   * for limit/offset, so we can pass them through as-is.
   */
  const query = event.queryStringParameters ?? {};
  const result = await listItemsHandler(query);
  return toApiGatewayResult(result);
}
