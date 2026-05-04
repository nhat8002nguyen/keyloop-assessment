import { UnifiedDocumentDto } from "./unified-document.dto";

export interface SourceStatus {
  name: string;
  status: "OK" | "ERROR" | "TIMEOUT";
  latencyMs: number;
  documentCount: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export class SearchResponseDto {
  correlationId: string;
  vin: string;
  data: UnifiedDocumentDto[];
  pagination: PaginationMeta;
  sources: SourceStatus[];
  warnings: string[];
}
