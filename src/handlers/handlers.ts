/**
 * API handlers for exam items.
 *
 * Each handler takes plain arguments and returns `{ statusCode, body }`,
 * which works with the local server and with the Lambda adapters.
 */

import { createStorage } from '../storage/index.js';
import {CreateItemSchema, UpdateItemSchema, ListItemsSchema} from './validation.js';
import { z } from "zod";

const storage = createStorage();

export async function getItemHandler(id: string) {
  try {
    const item = await storage.getItem(id);

    if (!item) {
      return {
        statusCode: 404,
        body: { error: 'Item not found' },
      };
    }

    return {
      statusCode: 200,
      body: item,
    };
  } catch (error) {
    console.error('Error getting item:', error);
    return {
      statusCode: 500,
      body: { error: 'Internal server error' },
    };
  }
}

export async function createItemHandler(data: any) {
  try {
    const validatedData = CreateItemSchema.parse(data);
    const item = await storage.createItem(validatedData);

    return {
      statusCode: 201,
      body: item,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { statusCode: 400, body: { error: 'Validation failed', details: error.errors } };
    }
    console.error('Error creating item:', error);
    return {
      statusCode: 500,
      body: { error: 'Internal server error' },
    };
  }
}

export async function updateItemHandler(id: string, data: any) {
  try {
    const validatedData = UpdateItemSchema.parse(data);
    const item = await storage.updateItem(id, validatedData);

    if (!item) {
      return {
        statusCode: 404,
        body: { error: 'Item not found' },
      };
    }

    return {
      statusCode: 200,
      body: item,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { statusCode: 400, body: { error: 'Validation failed', details: error.errors } };
    }
    console.error('Error updating item:', error);
    return { statusCode: 500, body: { error: 'Internal server error' } };
  }
}

export async function listItemsHandler(query: any) {
  try {
    const validatedData = ListItemsSchema.parse(query);
    const items = await storage.listItems(validatedData);
    return {
      statusCode: 200,
      body: items,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { statusCode: 400, body: { error: 'Validation failed', details: error.errors } };
    }
    console.error('Error listing items:', error);
    return {
      statusCode: 500,
      body: { error: 'Internal server error' },
    };
  }
}

/**
 * Not implemented for this submission (prioritized create/get/update/list):
 * - createVersionHandler
 * - getAuditTrailHandler
 */
