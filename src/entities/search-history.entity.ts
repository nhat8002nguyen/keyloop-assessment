import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("search_history")
export class SearchHistory {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id" })
  userId: string;

  @Column({ length: 17 })
  vin: string;

  @Column({ name: "filters_json", type: "jsonb", nullable: true })
  filtersJson: Record<string, unknown>;

  @Column({ name: "result_count", default: 0 })
  resultCount: number;

  @CreateDateColumn({ name: "searched_at", type: "timestamptz" })
  searchedAt: Date;

  @Column({ name: "correlation_id", type: "uuid", nullable: true })
  correlationId: string;
}
