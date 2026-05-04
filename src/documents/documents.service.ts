import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { FindOptionsWhere, Repository } from "typeorm";
import { ApiConfig } from "../entities/api-config.entity";
import { DocumentSource } from "../entities/document-metadata-cache.entity";
import { UserDocumentConfig } from "../entities/user-document-config.entity";
import { SearchHistory } from "../entities/search-history.entity";
import { SalesApiService } from "../external-apis/sales-api/sales-api.service";
import { ServiceApiService } from "../external-apis/service-api/service-api.service";
import type { IMessageQueueService } from "../message-queue/message-queue.interface";
import { MESSAGE_QUEUE } from "../message-queue/message-queue.token";
import { DocumentNormalizerService } from "./normalizer/document-normalizer.service";
import type { SearchDocumentsQueryDto } from "./dtos/search-documents-query.dto";
import { DocumentSourceFilter } from "./dtos/search-documents-query.dto";
import type { UnifiedDocumentDto } from "./dtos/unified-document.dto";
import type {
  SearchResponseDto,
  SourceStatus,
} from "./dtos/search-response.dto";
import type { SalesDocumentDto } from "../external-apis/sales-api/dto/sales-document.dto";
import type { ServiceDocumentDto } from "../external-apis/service-api/dto/service-document.dto";
import { classifyDownstreamError } from "../observability/downstream-error.util";
import { MetricsService } from "../observability/metrics.service";
import { DocumentAssetSigningService } from "./signing/document-asset-signing.service";

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly metricsService: MetricsService,
    private readonly salesApiService: SalesApiService,
    private readonly serviceApiService: ServiceApiService,
    private readonly normalizer: DocumentNormalizerService,
    private readonly documentAssetSigning: DocumentAssetSigningService,
    @InjectRepository(UserDocumentConfig)
    private readonly userDocConfigRepo: Repository<UserDocumentConfig>,
    @InjectRepository(ApiConfig)
    private readonly apiConfigRepo: Repository<ApiConfig>,
    @InjectRepository(SearchHistory)
    private readonly searchHistoryRepo: Repository<SearchHistory>,
    @Inject(MESSAGE_QUEUE)
    private readonly messageQueue: IMessageQueueService,
  ) {}

  async search(
    query: SearchDocumentsQueryDto,
    correlationId: string,
    userId: string,
    opts?: { salesMockForceError?: boolean },
  ): Promise<SearchResponseDto> {
    const userWhere: FindOptionsWhere<UserDocumentConfig> = { userId };
    const [userConfigs, apiConfigs] = await Promise.all([
      this.userDocConfigRepo.find({ where: userWhere }),
      this.apiConfigRepo.find(),
    ]);

    const { salesPageSize, servicePageSize } = this.resolveSplit(
      query.pageSize,
      userId,
      apiConfigs,
      userConfigs,
    );

    const hiddenTypes = this.buildHiddenTypes(userConfigs);

    const sources: SourceStatus[] = [];
    const warnings: string[] = [];
    const data: UnifiedDocumentDto[] = [];

    const fetchSales =
      query.source !== DocumentSourceFilter.SERVICE
        ? this.fetchSalesWithTiming(
            query,
            salesPageSize,
            correlationId,
            opts?.salesMockForceError,
          )
        : null;

    const fetchService =
      query.source !== DocumentSourceFilter.SALES
        ? this.fetchServiceWithTiming(query, servicePageSize, correlationId)
        : null;

    const [salesResult, serviceResult] = await Promise.allSettled([
      fetchSales ?? Promise.resolve(null),
      fetchService ?? Promise.resolve(null),
    ]);

    const salesOutcome =
      salesResult.status === "fulfilled" ? salesResult.value : null;
    const serviceOutcome =
      serviceResult.status === "fulfilled" ? serviceResult.value : null;

    let salesFailed =
      salesResult.status === "rejected" ||
      (fetchSales !== null && salesOutcome === null);
    let serviceFailed =
      serviceResult.status === "rejected" ||
      (fetchService !== null && serviceOutcome === null);

    if (salesOutcome !== null) {
      sources.push({
        name: "SALES",
        status: "OK",
        latencyMs: salesOutcome.latencyMs,
        documentCount: salesOutcome.docs.length,
      });
      data.push(
        ...salesOutcome.docs.map((d) =>
          this.withSignedDocumentUrl(
            this.normalizer.fromSales(d, hiddenTypes.sales),
          ),
        ),
      );
    } else if (fetchSales !== null) {
      salesFailed = true;
      sources.push({
        name: "SALES",
        status: "ERROR",
        latencyMs: 0,
        documentCount: 0,
      });
    }

    if (serviceOutcome !== null) {
      sources.push({
        name: "SERVICE",
        status: "OK",
        latencyMs: serviceOutcome.latencyMs,
        documentCount: serviceOutcome.docs.length,
      });
      data.push(
        ...serviceOutcome.docs.map((d) =>
          this.withSignedDocumentUrl(
            this.normalizer.fromService(d, hiddenTypes.service),
          ),
        ),
      );
    } else if (fetchService !== null) {
      serviceFailed = true;
      sources.push({
        name: "SERVICE",
        status: "ERROR",
        latencyMs: 0,
        documentCount: 0,
      });
    }

    // Partial-failure fallback: fill page from working source
    if (salesFailed && !serviceFailed && fetchSales !== null) {
      warnings.push(
        "Sales system is currently unavailable. Showing Service records only.",
      );
      const needed = salesPageSize;
      const fallback = await this.fetchServiceWithTiming(
        { ...query, page: query.page + 1 },
        needed,
        correlationId,
      ).catch(() => null);
      if (fallback) {
        this.metricsService.recordDocumentsReturned(
          "SERVICE",
          fallback.docs.length,
        );
        data.push(
          ...fallback.docs.map((d) =>
            this.withSignedDocumentUrl(
              this.normalizer.fromService(d, hiddenTypes.service),
            ),
          ),
        );
      }
    } else if (serviceFailed && !salesFailed && fetchService !== null) {
      warnings.push(
        "Service system is currently unavailable. Showing Sales records only.",
      );
      const needed = servicePageSize;
      const fallback = await this.fetchSalesWithTiming(
        { ...query, page: query.page + 1 },
        needed,
        correlationId,
        opts?.salesMockForceError,
      ).catch(() => null);
      if (fallback) {
        this.metricsService.recordDocumentsReturned(
          "SALES",
          fallback.docs.length,
        );
        data.push(
          ...fallback.docs.map((d) =>
            this.withSignedDocumentUrl(
              this.normalizer.fromSales(d, hiddenTypes.sales),
            ),
          ),
        );
      }
    } else if (salesFailed && serviceFailed) {
      warnings.push(
        "Both document sources are currently unavailable. Please try again later.",
      );
    }

    if (fetchSales !== null && fetchService !== null) {
      if (salesFailed && !serviceFailed) {
        this.metricsService.recordPartialSuccess("SALES");
      }
      if (serviceFailed && !salesFailed) {
        this.metricsService.recordPartialSuccess("SERVICE");
      }
    }

    if (salesOutcome !== null) {
      this.metricsService.recordDocumentsReturned(
        "SALES",
        salesOutcome.docs.length,
      );
    }
    if (serviceOutcome !== null) {
      this.metricsService.recordDocumentsReturned(
        "SERVICE",
        serviceOutcome.docs.length,
      );
    }

    // Sort merged results by date descending
    data.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    const total = data.length;
    const response: SearchResponseDto = {
      correlationId,
      vin: query.vin,
      data,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        hasMore: false,
      },
      sources,
      warnings,
    };

    // Fire-and-forget: publish event + persist history
    this.publishSearchEvent(correlationId, userId, query, total).catch((err) =>
      this.logger.warn(`Kafka publish failed: ${(err as Error).message}`),
    );
    this.persistSearchHistory(correlationId, userId, query, total).catch(() => {
      // non-critical
    });

    return response;
  }

  getDocumentUrl(documentId: string, correlationId: string): Promise<string> {
    // documentId format: "{SOURCE}-{originalId}" — production resolves from cache / source; demo uses deterministic path + signed CDN-style URL.
    this.logger.debug(
      `Resolve document URL documentId=${documentId} correlationId=${correlationId}`,
    );
    const fallbackBase = `https://cdn.keyloop.io/docs/${encodeURIComponent(documentId)}.pdf`;
    return Promise.resolve(
      this.documentAssetSigning.signObjectUrl(fallbackBase),
    );
  }

  private withSignedDocumentUrl(doc: UnifiedDocumentDto): UnifiedDocumentDto {
    return {
      ...doc,
      documentUrl: this.documentAssetSigning.signObjectUrl(doc.documentUrl),
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private resolveSplit(
    pageSize: number,
    userId: string,
    apiConfigs: ApiConfig[],
    userConfigs: UserDocumentConfig[],
  ): { salesPageSize: number; servicePageSize: number } {
    const userSalesRow = userConfigs.find(
      (c) =>
        c.documentType === null &&
        c.source === DocumentSource.SALES &&
        c.splitRatioOverride !== null,
    );

    let salesRatio: number;

    if (userSalesRow && userSalesRow.splitRatioOverride !== null) {
      salesRatio = Number(userSalesRow.splitRatioOverride);
    } else {
      const salesConfig = apiConfigs.find((c) => c.key === "SALES");
      const serviceConfig = apiConfigs.find((c) => c.key === "SERVICE");
      const rawSales = Number(salesConfig?.splitRatio ?? 0.5);
      const rawService = Number(serviceConfig?.splitRatio ?? 0.5);
      const total = rawSales + rawService || 1;
      salesRatio = rawSales / total;
    }

    const salesPageSize = Math.round(pageSize * salesRatio);
    const servicePageSize = pageSize - salesPageSize;
    return { salesPageSize, servicePageSize };
  }

  private buildHiddenTypes(userConfigs: UserDocumentConfig[]): {
    sales: Set<string>;
    service: Set<string>;
  } {
    const sales = new Set<string>();
    const service = new Set<string>();
    for (const cfg of userConfigs) {
      if (cfg.documentType && cfg.isHidden) {
        if (cfg.source === DocumentSource.SALES) sales.add(cfg.documentType);
        else service.add(cfg.documentType);
      }
    }
    return { sales, service };
  }

  private async fetchSalesWithTiming(
    query: Pick<
      SearchDocumentsQueryDto,
      "vin" | "page" | "dateFrom" | "dateTo"
    >,
    pageSize: number,
    correlationId: string,
    salesMockForceError?: boolean,
  ): Promise<{ docs: SalesDocumentDto[]; latencyMs: number }> {
    const start = Date.now();
    try {
      const docs = await this.salesApiService.fetchDocuments({
        vin: query.vin,
        page: query.page,
        pageSize,
        correlationId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        mockForceError: salesMockForceError,
      });
      const latencyMs = Date.now() - start;
      this.metricsService.recordDownstreamRequest(
        "SALES",
        "success",
        latencyMs,
      );
      return { docs, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      this.metricsService.recordDownstreamRequest("SALES", "error", latencyMs);
      this.metricsService.recordDownstreamError(
        "SALES",
        classifyDownstreamError(err),
      );
      throw err;
    }
  }

  private async fetchServiceWithTiming(
    query: Pick<
      SearchDocumentsQueryDto,
      "vin" | "page" | "dateFrom" | "dateTo"
    >,
    pageSize: number,
    correlationId: string,
  ): Promise<{ docs: ServiceDocumentDto[]; latencyMs: number }> {
    const start = Date.now();
    try {
      const docs = await this.serviceApiService.fetchDocuments({
        vin: query.vin,
        page: query.page,
        pageSize,
        correlationId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      });
      const latencyMs = Date.now() - start;
      this.metricsService.recordDownstreamRequest(
        "SERVICE",
        "success",
        latencyMs,
      );
      return { docs, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      this.metricsService.recordDownstreamRequest(
        "SERVICE",
        "error",
        latencyMs,
      );
      this.metricsService.recordDownstreamError(
        "SERVICE",
        classifyDownstreamError(err),
      );
      throw err;
    }
  }

  private async publishSearchEvent(
    correlationId: string,
    userId: string,
    query: SearchDocumentsQueryDto,
    resultCount: number,
  ): Promise<void> {
    await this.messageQueue.publish("document.search", {
      correlationId,
      userId,
      vin: query.vin,
      filters: {
        source: query.source,
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
      },
      timestamp: new Date().toISOString(),
      resultCount,
    });
  }

  private async persistSearchHistory(
    correlationId: string,
    userId: string,
    query: SearchDocumentsQueryDto,
    resultCount: number,
  ): Promise<void> {
    await this.searchHistoryRepo.save({
      userId,
      vin: query.vin,
      filtersJson: {
        source: query.source,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      resultCount,
      correlationId,
    });
  }
}
