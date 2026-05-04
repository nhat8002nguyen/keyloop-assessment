import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export enum DocumentSource {
  SALES = "SALES",
  SERVICE = "SERVICE",
}

@Entity("document_metadata_cache")
@Index(["vin", "source", "documentId"], { unique: true })
export class DocumentMetadataCache {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ length: 17 })
  vin: string;

  @Column({ type: "enum", enum: DocumentSource })
  source: DocumentSource;

  @Column({ name: "document_id" })
  documentId: string;

  @Column({ name: "metadata_json", type: "jsonb" })
  metadataJson: Record<string, unknown>;

  @Column({ name: "cached_at", type: "timestamptz" })
  cachedAt: Date;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt: Date;
}
