import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { DocumentSource } from "./document-metadata-cache.entity";

/**
 * Dual-purpose per-user config row:
 *
 * Visibility rule:   document_type IS NOT NULL, is_hidden set, split_ratio_override NULL
 * Source preference: document_type IS NULL,     is_hidden NULL, split_ratio_override set
 *
 * The unique constraint `(user_id, source, COALESCE(document_type, ''))` must be created
 * via a raw migration since TypeORM does not support COALESCE in index definitions:
 *   CREATE UNIQUE INDEX uq_user_doc_config
 *     ON user_document_config (user_id, source, COALESCE(document_type, ''));
 */
@Entity("user_document_config")
export class UserDocumentConfig {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id" })
  userId: string;

  /**
   * Non-null → visibility rule (e.g. "BILL_OF_SALE").
   * Null     → source-level preference row (split_ratio_override applies).
   */
  @Column({
    name: "document_type",
    type: "varchar",
    length: 128,
    nullable: true,
    default: null,
  })
  documentType: string | null;

  @Column({ type: "enum", enum: DocumentSource })
  source: DocumentSource;

  /**
   * Applies only when document_type IS NOT NULL.
   * true = hide this document type from the list for this user.
   */
  @Column({ name: "is_hidden", type: "boolean", nullable: true, default: null })
  isHidden: boolean | null;

  /**
   * Applies only when document_type IS NULL.
   * Overrides api_config.split_ratio for this source for this user (0.0–1.0).
   * When set on the SALES row, the SERVICE allocation is (pageSize - salesPageSize).
   */
  @Column({
    name: "split_ratio_override",
    type: "decimal",
    precision: 3,
    scale: 2,
    nullable: true,
    default: null,
  })
  splitRatioOverride: number | null;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
