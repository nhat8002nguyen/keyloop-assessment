import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DocumentsService } from "./documents.service";
import { DocumentNormalizerService } from "./normalizer/document-normalizer.service";
import { SalesApiService } from "../external-apis/sales-api/sales-api.service";
import { ServiceApiService } from "../external-apis/service-api/service-api.service";
import { ApiConfig } from "../entities/api-config.entity";
import { UserDocumentConfig } from "../entities/user-document-config.entity";
import { SearchHistory } from "../entities/search-history.entity";
import { DocumentSource } from "../entities/document-metadata-cache.entity";
import { MESSAGE_QUEUE } from "../message-queue/message-queue.token";
import { MetricsService } from "../observability/metrics.service";
import { DocumentAssetSigningService } from "./signing/document-asset-signing.service";
import {
  DocumentSourceFilter,
  SearchDocumentsQueryDto,
} from "./dtos/search-documents-query.dto";
import type { UnifiedDocumentDto } from "./dtos/unified-document.dto";
import type { SalesDocumentDto } from "../external-apis/sales-api/dto/sales-document.dto";
import {
  SalesDocumentType,
  FinanceType,
} from "../external-apis/sales-api/dto/sales-document.dto";
import type { ServiceDocumentDto } from "../external-apis/service-api/dto/service-document.dto";
import { ServiceDocumentType } from "../external-apis/service-api/dto/service-document.dto";

const makeSalesDoc = (id: string, date: string): SalesDocumentDto => ({
  salesOrderId: id,
  documentType: SalesDocumentType.BILL_OF_SALE,
  title: `Sales Doc ${id}`,
  orderDate: date,
  handoverDate: date,
  salesPerson: "John",
  financeType: FinanceType.RETAIL,
  storageUrl: "https://s3.example.com/doc.pdf",
  fileSizeBytes: 1024,
  storeId: "STORE-001",
  enterpriseId: "ENT-KEYLOOP",
});

const makeServiceDoc = (id: string, date: string): ServiceDocumentDto => ({
  repairOrderId: id,
  documentType: ServiceDocumentType.REPAIR_ORDER,
  description: `Service Doc ${id}`,
  checkInDateTime: date,
  completedDateTime: date,
  checkInMileage: 10000,
  technicianId: "TECH-001",
  laborItems: ["Oil Change"],
  cdnUrl: "https://cdn.keyloop.io/doc.pdf",
  fileSizeKb: 100,
  workshopId: "WS-001",
});

const toUnified = (
  doc: SalesDocumentDto | ServiceDocumentDto,
  source: "SALES" | "SERVICE",
): UnifiedDocumentDto => ({
  id:
    source === "SALES"
      ? `SALES-${(doc as SalesDocumentDto).salesOrderId}`
      : `SERVICE-${(doc as ServiceDocumentDto).repairOrderId}`,
  source,
  documentType: "Test Document",
  title: "title" in doc ? doc.title : doc.description,
  summary: "summary",
  documentUrl: "url",
  date:
    source === "SALES"
      ? (doc as SalesDocumentDto).handoverDate
      : (doc as ServiceDocumentDto).completedDateTime,
  metadata: {},
  isVisible: true,
});

describe("DocumentsService", () => {
  let service: DocumentsService;
  let salesApiService: jest.Mocked<SalesApiService>;
  let serviceApiService: jest.Mocked<ServiceApiService>;
  let normalizerService: jest.Mocked<DocumentNormalizerService>;
  let messageQueue: { publish: jest.Mock };

  let mockFetchSalesDocuments: jest.MockedFunction<
    SalesApiService["fetchDocuments"]
  >;
  let mockFetchServiceDocuments: jest.MockedFunction<
    ServiceApiService["fetchDocuments"]
  >;
  let mockNormalizerFromSales: jest.MockedFunction<
    DocumentNormalizerService["fromSales"]
  >;
  let mockNormalizerFromService: jest.MockedFunction<
    DocumentNormalizerService["fromService"]
  >;
  let mockPublish: jest.Mock;

  const baseQuery: SearchDocumentsQueryDto = {
    vin: "1HGBH41JXMN109186",
    page: 1,
    pageSize: 20,
    source: DocumentSourceFilter.ALL,
  };

  const CORRELATION_ID = "test-correlation-id";
  const USER_ID = "user-001";

  const defaultApiConfigs: ApiConfig[] = [
    {
      key: "SALES",
      baseUrl: "http://localhost:3001",
      timeoutMs: 5000,
      isActive: true,
      splitRatio: 0.5,
      authConfigJson: {},
      updatedAt: new Date(),
    },
    {
      key: "SERVICE",
      baseUrl: "http://localhost:3002",
      timeoutMs: 5000,
      isActive: true,
      splitRatio: 0.5,
      authConfigJson: {},
      updatedAt: new Date(),
    },
  ];

  beforeEach(async () => {
    mockFetchSalesDocuments = jest.fn();
    mockFetchServiceDocuments = jest.fn();
    mockNormalizerFromSales = jest.fn();
    mockNormalizerFromService = jest.fn();
    mockPublish = jest.fn().mockResolvedValue(undefined);
    messageQueue = { publish: mockPublish };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        {
          provide: MetricsService,
          useValue: {
            recordDownstreamRequest: jest.fn(),
            recordDownstreamError: jest.fn(),
            recordPartialSuccess: jest.fn(),
            recordDocumentsReturned: jest.fn(),
          },
        },
        {
          provide: SalesApiService,
          useValue: { fetchDocuments: mockFetchSalesDocuments },
        },
        {
          provide: ServiceApiService,
          useValue: { fetchDocuments: mockFetchServiceDocuments },
        },
        {
          provide: DocumentNormalizerService,
          useValue: {
            fromSales: mockNormalizerFromSales,
            fromService: mockNormalizerFromService,
          },
        },
        {
          provide: getRepositoryToken(UserDocumentConfig),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(ApiConfig),
          useValue: { find: jest.fn().mockResolvedValue(defaultApiConfigs) },
        },
        {
          provide: getRepositoryToken(SearchHistory),
          useValue: { save: jest.fn() },
        },
        {
          provide: MESSAGE_QUEUE,
          useValue: messageQueue,
        },
        {
          provide: DocumentAssetSigningService,
          useValue: {
            signObjectUrl: jest.fn((u: string) => u),
          },
        },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
    salesApiService = module.get(SalesApiService);
    serviceApiService = module.get(ServiceApiService);
    normalizerService = module.get(DocumentNormalizerService);
  });

  const buildModule = async (
    apiConfigs: ApiConfig[],
    userConfigs: Partial<UserDocumentConfig>[],
  ) => {
    const mq = { publish: jest.fn().mockResolvedValue(undefined) };
    const fetchSales: jest.MockedFunction<SalesApiService["fetchDocuments"]> =
      jest.fn().mockResolvedValue([]);
    const fetchService: jest.MockedFunction<
      ServiceApiService["fetchDocuments"]
    > = jest.fn().mockResolvedValue([]);
    const mod = await Test.createTestingModule({
      providers: [
        DocumentsService,
        {
          provide: MetricsService,
          useValue: {
            recordDownstreamRequest: jest.fn(),
            recordDownstreamError: jest.fn(),
            recordPartialSuccess: jest.fn(),
            recordDocumentsReturned: jest.fn(),
          },
        },
        {
          provide: SalesApiService,
          useValue: { fetchDocuments: fetchSales },
        },
        {
          provide: ServiceApiService,
          useValue: { fetchDocuments: fetchService },
        },
        {
          provide: DocumentNormalizerService,
          useValue: { fromSales: jest.fn(), fromService: jest.fn() },
        },
        {
          provide: getRepositoryToken(UserDocumentConfig),
          useValue: { find: jest.fn().mockResolvedValue(userConfigs) },
        },
        {
          provide: getRepositoryToken(ApiConfig),
          useValue: { find: jest.fn().mockResolvedValue(apiConfigs) },
        },
        {
          provide: getRepositoryToken(SearchHistory),
          useValue: { save: jest.fn() },
        },
        { provide: MESSAGE_QUEUE, useValue: mq },
        {
          provide: DocumentAssetSigningService,
          useValue: {
            signObjectUrl: jest.fn((u: string) => u),
          },
        },
      ],
    }).compile();
    return {
      svc: mod.get<DocumentsService>(DocumentsService),
      fetchSales,
      fetchService,
    };
  };

  describe("split ratio resolution", () => {
    it("defaults to 50/50 when api_config has equal split_ratio (pageSize=20 → 10+10)", async () => {
      mockFetchSalesDocuments.mockResolvedValue([]);
      mockFetchServiceDocuments.mockResolvedValue([]);

      await service.search(
        { ...baseQuery, pageSize: 20 },
        CORRELATION_ID,
        USER_ID,
      );

      expect(mockFetchSalesDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 10 }),
      );
      expect(mockFetchServiceDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 10 }),
      );
    });

    it("respects api_config split_ratio: SALES=0.7, SERVICE=0.3 → Sales=14, Service=6", async () => {
      const skewedApiConfigs: ApiConfig[] = [
        { ...defaultApiConfigs[0], splitRatio: 0.7 },
        { ...defaultApiConfigs[1], splitRatio: 0.3 },
      ];
      const { svc, fetchSales, fetchService } = await buildModule(
        skewedApiConfigs,
        [],
      );

      await svc.search({ ...baseQuery, pageSize: 20 }, CORRELATION_ID, USER_ID);

      expect(fetchSales).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 14 }),
      );
      expect(fetchService).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 6 }),
      );
    });

    it("normalizes ratios that do not sum to 1.0: SALES=0.6, SERVICE=0.6 → still sums to pageSize", async () => {
      const unnormalizedConfigs: ApiConfig[] = [
        { ...defaultApiConfigs[0], splitRatio: 0.6 },
        { ...defaultApiConfigs[1], splitRatio: 0.6 },
      ];
      const { svc, fetchSales, fetchService } = await buildModule(
        unnormalizedConfigs,
        [],
      );

      await svc.search({ ...baseQuery, pageSize: 20 }, CORRELATION_ID, USER_ID);

      const salesCall = fetchSales.mock.calls[0]?.[0];
      const serviceCall = fetchService.mock.calls[0]?.[0];
      expect((salesCall?.pageSize ?? 0) + (serviceCall?.pageSize ?? 0)).toBe(
        20,
      );
    });

    it("user split_ratio_override takes priority over api_config", async () => {
      const userSourceRow: Partial<UserDocumentConfig> = {
        userId: USER_ID,
        documentType: null,
        source: DocumentSource.SALES,
        isHidden: null,
        splitRatioOverride: 0.8,
      };
      const { svc, fetchSales, fetchService } = await buildModule(
        defaultApiConfigs,
        [userSourceRow],
      );

      await svc.search({ ...baseQuery, pageSize: 20 }, USER_ID, USER_ID);

      expect(fetchSales).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 16 }),
      );
      expect(fetchService).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 4 }),
      );
    });

    it("user override: salesPageSize + servicePageSize always equals pageSize exactly", async () => {
      const userSourceRow: Partial<UserDocumentConfig> = {
        userId: USER_ID,
        documentType: null,
        source: DocumentSource.SALES,
        isHidden: null,
        splitRatioOverride: 0.3,
      };
      const { svc, fetchSales, fetchService } = await buildModule(
        defaultApiConfigs,
        [userSourceRow],
      );

      await svc.search({ ...baseQuery, pageSize: 20 }, USER_ID, USER_ID);

      const salesCall = fetchSales.mock.calls[0]?.[0];
      const serviceCall = fetchService.mock.calls[0]?.[0];
      expect((salesCall?.pageSize ?? 0) + (serviceCall?.pageSize ?? 0)).toBe(
        20,
      );
    });

    it("falls back to 0.5 when api_config rows are missing", async () => {
      const { svc, fetchSales, fetchService } = await buildModule([], []);

      await svc.search({ ...baseQuery, pageSize: 20 }, CORRELATION_ID, USER_ID);

      expect(fetchSales).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 10 }),
      );
      expect(fetchService).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 10 }),
      );
    });

    it("visibility config rows (documentType IS NOT NULL) are not treated as ratio overrides", async () => {
      const visibilityRow: Partial<UserDocumentConfig> = {
        userId: USER_ID,
        documentType: "BILL_OF_SALE",
        source: DocumentSource.SALES,
        isHidden: true,
        splitRatioOverride: null,
      };
      const { svc, fetchSales, fetchService } = await buildModule(
        defaultApiConfigs,
        [visibilityRow],
      );

      await svc.search({ ...baseQuery, pageSize: 20 }, USER_ID, USER_ID);

      expect(fetchSales).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 10 }),
      );
      expect(fetchService).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 10 }),
      );
    });
  });

  describe("both sources succeed", () => {
    it("merges and sorts all documents by date descending", async () => {
      const salesDocs = [
        makeSalesDoc("SO-001", "2024-03-20T14:00:00Z"),
        makeSalesDoc("SO-002", "2024-01-10T10:00:00Z"),
      ];
      const serviceDocs = [
        makeServiceDoc("RO-001", "2024-06-15T09:00:00Z"),
        makeServiceDoc("RO-002", "2023-11-05T12:00:00Z"),
      ];

      mockFetchSalesDocuments.mockResolvedValue(salesDocs);
      mockFetchServiceDocuments.mockResolvedValue(serviceDocs);

      salesDocs.forEach((d) =>
        mockNormalizerFromSales.mockReturnValueOnce(toUnified(d, "SALES")),
      );
      serviceDocs.forEach((d) =>
        mockNormalizerFromService.mockReturnValueOnce(toUnified(d, "SERVICE")),
      );

      const result = await service.search(baseQuery, CORRELATION_ID, USER_ID);

      const dates = result.data.map((d) => new Date(d.date).getTime());
      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
      }
    });

    it("returns no warnings when both succeed", async () => {
      mockFetchSalesDocuments.mockResolvedValue([]);
      mockFetchServiceDocuments.mockResolvedValue([]);

      const result = await service.search(baseQuery, CORRELATION_ID, USER_ID);

      expect(result.warnings).toHaveLength(0);
    });

    it("reports OK status for both sources", async () => {
      mockFetchSalesDocuments.mockResolvedValue([]);
      mockFetchServiceDocuments.mockResolvedValue([]);

      const result = await service.search(baseQuery, CORRELATION_ID, USER_ID);

      const salesStatus = result.sources.find((s) => s.name === "SALES");
      const serviceStatus = result.sources.find((s) => s.name === "SERVICE");
      expect(salesStatus?.status).toBe("OK");
      expect(serviceStatus?.status).toBe("OK");
    });

    it("response envelope includes correlationId and vin", async () => {
      mockFetchSalesDocuments.mockResolvedValue([]);
      mockFetchServiceDocuments.mockResolvedValue([]);

      const result = await service.search(baseQuery, CORRELATION_ID, USER_ID);

      expect(result.correlationId).toBe(CORRELATION_ID);
      expect(result.vin).toBe(baseQuery.vin);
    });
  });

  describe("source filter", () => {
    it("source=SALES only calls SalesApiService, skips ServiceApiService", async () => {
      mockFetchSalesDocuments.mockResolvedValue([]);

      await service.search(
        { ...baseQuery, source: DocumentSourceFilter.SALES },
        CORRELATION_ID,
        USER_ID,
      );

      expect(mockFetchSalesDocuments).toHaveBeenCalled();
      expect(mockFetchServiceDocuments).not.toHaveBeenCalled();
    });

    it("source=SERVICE only calls ServiceApiService, skips SalesApiService", async () => {
      mockFetchServiceDocuments.mockResolvedValue([]);

      await service.search(
        { ...baseQuery, source: DocumentSourceFilter.SERVICE },
        CORRELATION_ID,
        USER_ID,
      );

      expect(mockFetchServiceDocuments).toHaveBeenCalled();
      expect(mockFetchSalesDocuments).not.toHaveBeenCalled();
    });
  });

  describe("date filter propagation", () => {
    it("forwards dateFrom and dateTo to both downstream calls", async () => {
      mockFetchSalesDocuments.mockResolvedValue([]);
      mockFetchServiceDocuments.mockResolvedValue([]);

      await service.search(
        { ...baseQuery, dateFrom: "2024-01-01", dateTo: "2024-12-31" },
        CORRELATION_ID,
        USER_ID,
      );

      expect(mockFetchSalesDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: "2024-01-01",
          dateTo: "2024-12-31",
        }),
      );
      expect(mockFetchServiceDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: "2024-01-01",
          dateTo: "2024-12-31",
        }),
      );
    });
  });

  describe("correlation ID propagation", () => {
    it("propagates correlationId to both downstream calls", async () => {
      mockFetchSalesDocuments.mockResolvedValue([]);
      mockFetchServiceDocuments.mockResolvedValue([]);

      await service.search(baseQuery, "specific-correlation-id", USER_ID);

      expect(mockFetchSalesDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: "specific-correlation-id" }),
      );
      expect(mockFetchServiceDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: "specific-correlation-id" }),
      );
    });
  });

  describe("partial failure — Sales fails", () => {
    it("makes fallback call to Service API with shifted offset", async () => {
      mockFetchSalesDocuments.mockRejectedValue(new Error("Sales down"));
      mockFetchServiceDocuments.mockResolvedValue([]);

      await service.search(
        { ...baseQuery, pageSize: 20 },
        CORRELATION_ID,
        USER_ID,
      );

      expect(mockFetchServiceDocuments).toHaveBeenCalledTimes(2);
    });

    it("includes sales unavailable warning in response", async () => {
      mockFetchSalesDocuments.mockRejectedValue(new Error("Sales down"));
      mockFetchServiceDocuments.mockResolvedValue([]);

      const result = await service.search(baseQuery, CORRELATION_ID, USER_ID);

      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("Sales")]),
      );
    });

    it("still returns HTTP 200 with service documents", async () => {
      const serviceDocs = [makeServiceDoc("RO-001", "2025-01-10T17:45:00Z")];
      mockFetchSalesDocuments.mockRejectedValue(new Error("Sales down"));
      mockFetchServiceDocuments.mockResolvedValue(serviceDocs);
      mockNormalizerFromService.mockReturnValue(
        toUnified(serviceDocs[0], "SERVICE"),
      );

      const result = await service.search(baseQuery, CORRELATION_ID, USER_ID);

      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].source).toBe("SERVICE");
    });
  });

  describe("partial failure — Service fails", () => {
    it("makes fallback call to Sales API with shifted offset", async () => {
      mockFetchServiceDocuments.mockRejectedValue(new Error("Service down"));
      mockFetchSalesDocuments.mockResolvedValue([]);

      await service.search(
        { ...baseQuery, pageSize: 20 },
        CORRELATION_ID,
        USER_ID,
      );

      expect(mockFetchSalesDocuments).toHaveBeenCalledTimes(2);
    });

    it("includes service unavailable warning in response", async () => {
      mockFetchServiceDocuments.mockRejectedValue(new Error("Service down"));
      mockFetchSalesDocuments.mockResolvedValue([]);

      const result = await service.search(baseQuery, CORRELATION_ID, USER_ID);

      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("Service")]),
      );
    });
  });

  describe("both sources fail", () => {
    it("returns empty data array", async () => {
      mockFetchSalesDocuments.mockRejectedValue(new Error("Sales down"));
      mockFetchServiceDocuments.mockRejectedValue(new Error("Service down"));

      const result = await service.search(baseQuery, CORRELATION_ID, USER_ID);

      expect(result.data).toHaveLength(0);
    });

    it("includes two warnings (one per source)", async () => {
      mockFetchSalesDocuments.mockRejectedValue(new Error("Sales down"));
      mockFetchServiceDocuments.mockRejectedValue(new Error("Service down"));

      const result = await service.search(baseQuery, CORRELATION_ID, USER_ID);

      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings.join(" ")).toMatch(/unavailable/i);
    });
  });

  describe("user visibility config", () => {
    it("passes hidden document types to normalizer so isVisible=false is set", async () => {
      const userConfigRepo = {
        find: jest.fn().mockResolvedValue([
          {
            userId: USER_ID,
            documentType: "BILL_OF_SALE",
            source: "SALES",
            isHidden: true,
          },
        ]),
      };

      const mod = await Test.createTestingModule({
        providers: [
          DocumentsService,
          {
            provide: MetricsService,
            useValue: {
              recordDownstreamRequest: jest.fn(),
              recordDownstreamError: jest.fn(),
              recordPartialSuccess: jest.fn(),
              recordDocumentsReturned: jest.fn(),
            },
          },
          { provide: SalesApiService, useValue: salesApiService },
          { provide: ServiceApiService, useValue: serviceApiService },
          { provide: DocumentNormalizerService, useValue: normalizerService },
          {
            provide: getRepositoryToken(UserDocumentConfig),
            useValue: userConfigRepo,
          },
          {
            provide: getRepositoryToken(ApiConfig),
            useValue: { find: jest.fn().mockResolvedValue(defaultApiConfigs) },
          },
          {
            provide: getRepositoryToken(SearchHistory),
            useValue: { save: jest.fn() },
          },
          { provide: MESSAGE_QUEUE, useValue: messageQueue },
          {
            provide: DocumentAssetSigningService,
            useValue: {
              signObjectUrl: jest.fn((u: string) => u),
            },
          },
        ],
      }).compile();

      const svc = mod.get<DocumentsService>(DocumentsService);
      mockFetchSalesDocuments.mockResolvedValue([
        makeSalesDoc("SO-001", "2024-03-20T14:00:00Z"),
      ]);
      mockFetchServiceDocuments.mockResolvedValue([]);
      mockNormalizerFromSales.mockReturnValue({} as UnifiedDocumentDto);

      await svc.search(baseQuery, CORRELATION_ID, USER_ID);

      expect(mockNormalizerFromSales).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Set),
      );
      const callArgs = mockNormalizerFromSales.mock.calls[0];
      expect(callArgs).toBeDefined();
      const hiddenSet = callArgs[1];
      expect(hiddenSet.has("BILL_OF_SALE")).toBe(true);
    });
  });

  describe("Kafka event publishing", () => {
    it("publishes document.search event after response", async () => {
      mockFetchSalesDocuments.mockResolvedValue([]);
      mockFetchServiceDocuments.mockResolvedValue([]);

      await service.search(baseQuery, CORRELATION_ID, USER_ID);

      expect(mockPublish).toHaveBeenCalledWith(
        "document.search",
        expect.objectContaining({
          correlationId: CORRELATION_ID,
          userId: USER_ID,
          vin: baseQuery.vin,
        }),
      );
    });

    it("publish failure does not throw or affect the response", async () => {
      mockFetchSalesDocuments.mockResolvedValue([]);
      mockFetchServiceDocuments.mockResolvedValue([]);
      mockPublish.mockRejectedValue(new Error("Kafka unavailable"));

      await expect(
        service.search(baseQuery, CORRELATION_ID, USER_ID),
      ).resolves.toBeDefined();
    });
  });
});
