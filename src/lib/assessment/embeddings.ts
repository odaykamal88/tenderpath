/**
 * Embedding scaffolding for hybrid retrieval (Sprint 4+).
 *
 * Current state: stubs only. Keyword-based matchTenders() remains the
 * primary retrieval path. This module defines interfaces and insertion
 * points for when embedding-based retrieval is layered on top.
 *
 * Intended hybrid pattern (Sprint 4):
 *   1. generateProfileEmbedding(analysis) → ProfileEmbedding
 *   2. retrieveTendersByEmbedding(embedding) → tender IDs (ANN via pgvector)
 *   3. Union ANN IDs with keyword-match IDs before scoring pass
 *   4. Rerank the union by score (keyword score + cosine similarity)
 *
 * Insertion point in match.ts:
 *   After the per-slug SQL pool pass but before the scoring loop.
 *   Add embedding-retrieved rows to `byId` map (deduped by id).
 */

import type { AIAnalysis } from "@/lib/types";

export interface ProfileEmbedding {
  vector: number[];
  /** Embedding model used (e.g. "voyage-3", "text-embedding-3-small"). */
  model: string;
  generatedAt: string;
}

export interface TenderEmbeddingRecord {
  tenderId: number;
  vector: number[];
  model: string;
}

/**
 * Synthesize a text prompt from an AI analysis for embedding generation.
 * Exported so it can be unit-tested without a live embedding API.
 */
export function buildProfilePrompt(analysis: AIAnalysis): string {
  const parts: string[] = [];
  if (analysis.detected_industry) parts.push(analysis.detected_industry);
  if (analysis.sectors?.length) parts.push(analysis.sectors.join(", "));
  if (analysis.services?.length) parts.push(analysis.services.join(", "));
  if (analysis.capabilities?.length) parts.push(analysis.capabilities.join(", "));
  return parts.join(". ");
}

/**
 * Generate a profile embedding from an AI analysis.
 * Returns null until the embedding infrastructure is wired (Sprint 4).
 */
export async function generateProfileEmbedding(
  _analysis: AIAnalysis,
): Promise<ProfileEmbedding | null> {
  // Sprint 4: POST buildProfilePrompt(analysis) to an embeddings API.
  // Store the vector in the assessments row (assessments.profile_embedding).
  return null;
}

/**
 * Retrieve tender IDs ranked by cosine similarity to a profile embedding.
 * Returns empty array until pgvector + tender_embeddings table exist (Sprint 4).
 */
export async function retrieveTendersByEmbedding(
  _profileEmbedding: ProfileEmbedding,
  _limit = 200,
): Promise<number[]> {
  // Sprint 4: SELECT tender_id FROM tender_embeddings
  //   ORDER BY embedding <=> $1::vector LIMIT $2
  // Requires: pgvector extension, tender_embeddings table, nightly embedding job.
  return [];
}
