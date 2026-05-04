import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity("api_config")
export class ApiConfig {
  @PrimaryColumn()
  key: string;

  @Column({ name: "base_url" })
  baseUrl: string;

  @Column({ name: "timeout_ms", default: 5000 })
  timeoutMs: number;

  @Column({ name: "is_active", default: true })
  isActive: boolean;

  /**
   * Fraction of the total pageSize allocated to this source (0.0–1.0).
   * Normalized against the other source at runtime if the two values don't sum to 1.0.
   * Default: 0.5 (equal split).
   */
  @Column({
    name: "split_ratio",
    type: "decimal",
    precision: 3,
    scale: 2,
    default: 0.5,
  })
  splitRatio: number;

  @Column({ name: "auth_config_json", type: "jsonb", nullable: true })
  authConfigJson: Record<string, unknown>;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
