import { z } from "zod";

/**
 * Status and securityLevel are limited to the values from the spec, so
 * values like "bananas" gets rejected here instead of making it into storage.
 * Exported so item.ts can derive its TypeScript types from the same enums
 * with z.infer. So, only one place to update if the allowed values ever change.
 */
export const StatusEnum = z.enum(["draft", "review", "approved", "archived"]);
export const SecurityLevelEnum = z.enum(["standard", "secure", "highly-secure"]);

/**
 * Server-owned fields (id, created, lastModified, version) are omitted, 
 * storage sets them, and we wouldn't want to allow clients to set them.
 */
export const UpdateItemSchema = z.object({
    subject: z.string().optional(),
    itemType: z.string().optional(),
    difficulty: z.number().min(1).max(5).optional(),
    content: z.object({
        question: z.string(),
        options: z.array(z.string()).optional(),
        correctAnswer: z.string(),
        explanation: z.string(),
    }).partial().optional(),
    metadata: z.object({
        status: StatusEnum,
        tags: z.array(z.string()),
    }).partial().optional(),
    securityLevel: SecurityLevelEnum.optional(),
});

export const ListItemsSchema = z.object({
    limit: z.coerce.number().optional(),
    offset: z.coerce.number().optional(),
    subject: z.string().optional(),
    status: StatusEnum.optional(),
});

export const CreateItemSchema = z.object({
    subject: z.string(),
    itemType: z.string(),
    difficulty: z.number().min(1).max(5),
    content: z.object({
        question: z.string(),
        options: z.array(z.string()).optional(),
        correctAnswer: z.string(),
        explanation: z.string(),
    }),
    metadata: z.object({
        author: z.string(),
        status: StatusEnum,
        tags: z.array(z.string()),
    }),
    securityLevel: SecurityLevelEnum,
});
