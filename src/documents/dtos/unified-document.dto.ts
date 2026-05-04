export class UnifiedDocumentDto {
  /** "{source}-{originalId}", e.g. "SALES-SO-2024-00341" */
  id: string;

  /** SALES or SERVICE */
  source: string;

  /** Human-readable document type, e.g. "Bill of Sale", "Repair Order" */
  documentType: string;

  title: string;

  /** ≤160 character summary */
  summary: string;

  /** Signed S3 URL or CloudFront CDN URL */
  documentUrl: string;

  /** ISO 8601 — handoverDate (Sales) or completedDateTime (Service) */
  date: string;

  /** Source-specific extras */
  metadata: Record<string, unknown>;

  /** false if hidden by user_document_config */
  isVisible: boolean;
}
