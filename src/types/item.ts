/**
 * Exam item types.
 *
 * ItemStatus and SecurityLevel come from the Zod enums in validation.ts
 * rather than being typed by hand, so the allowed values stay in sync.
 */

import { z } from 'zod';
import { StatusEnum, SecurityLevelEnum } from '../handlers/validation.js';

export type ItemStatus = z.infer<typeof StatusEnum>;
export type SecurityLevel = z.infer<typeof SecurityLevelEnum>;

export interface ExamItem {
  id: string;
  subject: string; // e.g., "AP Biology", "AP Calculus"
  itemType: string; // "multiple-choice", "free-response", "essay"
  difficulty: number; // 1-5
  content: {
    question: string;
    options?: string[]; // For multiple choice
    correctAnswer: string;
    explanation: string;
  };
  metadata: {
    author: string;
    created: number; // timestamp
    lastModified: number; // timestamp
    version: number;
    status: ItemStatus; // "draft", "review", "approved", "archived"
    tags: string[];
  };
  securityLevel: SecurityLevel; // "standard", "secure", "highly-secure"
}

export interface CreateItemRequest {
  subject: string;
  itemType: string;
  difficulty: number;
  content: {
    question: string;
    options?: string[];
    correctAnswer: string;
    explanation: string;
  };
  metadata: {
    author: string;
    status: ItemStatus;
    tags: string[];
  };
  securityLevel: SecurityLevel;
}

export interface UpdateItemRequest {
  subject?: string;
  itemType?: string;
  difficulty?: number;
  content?: Partial<ExamItem["content"]>;
  metadata?: Partial<ExamItem["metadata"]>;
  securityLevel?: SecurityLevel;
}

export interface ListItemsQuery {
  limit?: number;
  offset?: number;
  subject?: string;
  status?: ItemStatus;
}
