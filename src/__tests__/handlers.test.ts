/**
 * Example Test File
 *
 * This demonstrates how to write tests for your handlers.
 * You can use this as a template for testing your implemented endpoints.
 *
 * To run tests:
 *   pnpm test           - Run once
 *   pnpm test:watch     - Run in watch mode
 *   pnpm test:ui        - Run with interactive UI
 */

import { describe, expect, it } from "vitest";
import { createItemHandler, getItemHandler, listItemsHandler, updateItemHandler } from "../handlers/handlers.js";

const sampleItem = {
  subject: "AP Biology",
  itemType: "multiple-choice",
  difficulty: 3,
  content: {
    question: "What is the mitochondria?",
    options: ["A", "B", "C", "D"],
    correctAnswer: "A",
    explanation: "The mitochondria is the powerhouse of the cell",
  },
  metadata: {
    author: "Daisy the cat",
    status: "draft" as const,
    tags: ["biology", "mitochondria"],
  },
  securityLevel: "standard" as const,
};

describe("Handlers", () => {
  describe("createItemHandler", () => {
    it("should create an item successfully", async () => {
      const result = await createItemHandler(sampleItem);

      expect(result.statusCode).toBe(201);
      expect(result.body).toHaveProperty("id");
      if ("subject" in result.body) {
        expect(result.body.subject).toBe("AP Biology");
      }
      if ("metadata" in result.body) {
        expect(result.body.metadata).toHaveProperty("author", "Daisy the cat");
        expect(result.body.metadata.version).toBe(1);
      }
    });

    it("should return 400 for invalid data", async () => {
      const result = await createItemHandler({
        subject: "AP Bio",
        // missing required fields
      });

      expect(result.statusCode).toBe(400);
      expect(result.body).toHaveProperty("error", "Validation failed");
    });

    it("should return 400 for an invalid status enum", async () => {
      const result = await createItemHandler({
        ...sampleItem,
        metadata: { ...sampleItem.metadata, status: "bananas" },
      });

      expect(result.statusCode).toBe(400);
      expect(result.body).toHaveProperty("error", "Validation failed");
    });
  });

  describe("getItemHandler", () => {
    it("should return 404 for non-existent item", async () => {
      const result = await getItemHandler("non-existent-id");

      expect(result.statusCode).toBe(404);
      expect(result.body).toHaveProperty("error");
      if ("error" in result.body) {
        expect(result.body.error).toBe("Item not found");
      }
    });

    it("should retrieve an existing item", async () => {
      // First create an item
      const itemData = {
        subject: "AP Calculus",
        itemType: "free-response",
        difficulty: 4,
        content: {
          question: "Calculate the derivative...",
          correctAnswer: "42",
          explanation: "Using the chain rule...",
        },
        metadata: {
          author: "test-author",
          status: "approved",
          tags: ["calculus", "derivatives"],
        },
        securityLevel: "standard",
      };

      const createResult = await createItemHandler(itemData);
      expect(createResult.body).toHaveProperty("id");
      if (!("id" in createResult.body)) {
        throw new Error("Item creation failed");
      }
      const itemId = createResult.body.id;

      // Then retrieve it
      const getResult = await getItemHandler(itemId);

      expect(getResult.statusCode).toBe(200);
      expect(getResult.body).toHaveProperty("id", itemId);
      if ("subject" in getResult.body) {
        expect(getResult.body.subject).toBe("AP Calculus");
      }
    });
  });

  describe("updateItemHandler", () => {
    it("should update an item and bump metadata.version", async () => {
      const createResult = await createItemHandler(sampleItem);
      if (!("id" in createResult.body) || !("metadata" in createResult.body)) {
        throw new Error("Item creation failed");
      }
      const itemId = createResult.body.id;
      expect(createResult.body.metadata.version).toBe(1);

      const updateResult = await updateItemHandler(itemId, { difficulty: 5 });

      expect(updateResult.statusCode).toBe(200);
      expect(updateResult.body).toHaveProperty("id", itemId);
      if ("difficulty" in updateResult.body) {
        expect(updateResult.body.difficulty).toBe(5);
      }
      if ("metadata" in updateResult.body) {
        expect(updateResult.body.metadata.version).toBe(2);
      }
    });

    it("should not change untouched fields on partial update", async () => {
      const createResult = await createItemHandler(sampleItem);
      if (!("id" in createResult.body)) {
        throw new Error("Item creation failed");
      }
      const itemId = createResult.body.id;

      const updateResult = await updateItemHandler(itemId, { difficulty: 5 });

      expect(updateResult.statusCode).toBe(200);
      if ("subject" in updateResult.body) {
        expect(updateResult.body.subject).toBe("AP Biology");
      }
      if ("content" in updateResult.body) {
        expect(updateResult.body.content.question).toBe("What is the mitochondria?");
        expect(updateResult.body.content.correctAnswer).toBe("A");
      }
      if ("metadata" in updateResult.body) {
        expect(updateResult.body.metadata.status).toBe("draft");
        expect(updateResult.body.metadata.author).toBe("Daisy the cat");
      }
      if ("securityLevel" in updateResult.body) {
        expect(updateResult.body.securityLevel).toBe("standard");
      }
    });

    it("should return 404 for non-existent item", async () => {
      const result = await updateItemHandler("non-existent-id", {
        difficulty: 4,
      });

      expect(result.statusCode).toBe(404);
    });

    it("should return 400 for invalid data", async () => {
      const result = await updateItemHandler("some-id", {
        difficulty: 10, // violates max(5) rule
      });

      expect(result.statusCode).toBe(400);
      expect(result.body).toHaveProperty("error", "Validation failed");
    });
  });

  describe("listItemsHandler", () => {
    it("should list items and include newly created ones", async () => {
      const itemData = {
        subject: "AP Calculus",
        itemType: "free-response",
        difficulty: 4,
        content: {
          question: "Calculate the derivative...",
          correctAnswer: "42",
          explanation: "Using the chain rule...",
        },
        metadata: {
          author: "test-author",
          status: "approved",
          tags: ["calculus"],
        },
        securityLevel: "standard",
      };

      const createResult = await createItemHandler(itemData);
      if (!("id" in createResult.body)) {
        throw new Error("Item creation failed");
      }
      const itemId = createResult.body.id;

      const listResult = await listItemsHandler({ subject: "AP Calculus" });

      expect(listResult.statusCode).toBe(200);
      if ("items" in listResult.body) {
        const found = listResult.body.items.find((item) => item.id === itemId);
        expect(found).toBeDefined();
        expect(found?.subject).toBe("AP Calculus");
      }
    });

    it("should return 400 for invalid query params", async () => {
      const result = await listItemsHandler({ subject: 123 });

      expect(result.statusCode).toBe(400);
      expect(result.body).toHaveProperty("error", "Validation failed");
    });
  });
});
