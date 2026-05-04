import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { SalesApiService } from "./sales-api.service";
import { ApiConfig } from "../../entities/api-config.entity";
import type { SalesApiParams } from "./sales-api.service";

const mockApiConfigRepo = () => ({
  findOne: jest.fn(),
});

const salesApiConfig: ApiConfig = {
  key: "SALES",
  baseUrl: "http://localhost:3001",
  timeoutMs: 5000,
  isActive: true,
  splitRatio: 0.5,
  authConfigJson: {},
  updatedAt: new Date(),
};

describe("SalesApiService", () => {
  let service: SalesApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesApiService,
        {
          provide: getRepositoryToken(ApiConfig),
          useValue: mockApiConfigRepo(),
        },
      ],
    }).compile();

    service = module.get<SalesApiService>(SalesApiService);
  });

  const baseParams: SalesApiParams = {
    vin: "1HGBH41JXMN109186",
    page: 1,
    pageSize: 10,
    correlationId: "test-correlation-id",
  };

  it("is defined", () => {
    expect(service).toBeDefined();
  });

  it("sends GET request to configured baseUrl with correct query params", async () => {
    const apiConfigRepo = {
      findOne: jest.fn().mockResolvedValue(salesApiConfig),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SalesApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<SalesApiService>(SalesApiService);

    const httpSpy = jest.spyOn(svc as any, "httpGet").mockResolvedValue([]);

    await svc.fetchDocuments(baseParams);

    expect(httpSpy).toHaveBeenCalledWith(
      expect.stringContaining("http://localhost:3001"),
      expect.objectContaining({
        params: expect.objectContaining({
          vin: "1HGBH41JXMN109186",
          pageSize: 10,
        }),
      }),
    );
  });

  it("propagates X-Correlation-ID header", async () => {
    const apiConfigRepo = {
      findOne: jest.fn().mockResolvedValue(salesApiConfig),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SalesApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<SalesApiService>(SalesApiService);

    const httpSpy = jest.spyOn(svc as any, "httpGet").mockResolvedValue([]);

    await svc.fetchDocuments({ ...baseParams, correlationId: "abc-123" });

    expect(httpSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-correlation-id": "abc-123" }),
      }),
    );
  });

  it("propagates X-Enterprise-ID and X-Store-ID from api_config", async () => {
    const configWithAuth: ApiConfig = {
      ...salesApiConfig,
      authConfigJson: { enterpriseId: "ENT-KEYLOOP", storeId: "STORE-001" },
    };
    const apiConfigRepo = {
      findOne: jest.fn().mockResolvedValue(configWithAuth),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SalesApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<SalesApiService>(SalesApiService);
    const httpSpy = jest.spyOn(svc as any, "httpGet").mockResolvedValue([]);

    await svc.fetchDocuments(baseParams);

    expect(httpSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-enterprise-id": "ENT-KEYLOOP",
          "x-store-id": "STORE-001",
        }),
      }),
    );
  });

  it("throws when response exceeds timeoutMs", async () => {
    const apiConfigRepo = {
      findOne: jest.fn().mockResolvedValue({ ...salesApiConfig, timeoutMs: 1 }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SalesApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<SalesApiService>(SalesApiService);

    jest
      .spyOn(svc as any, "httpGet")
      .mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 50),
          ),
      );

    await expect(svc.fetchDocuments(baseParams)).rejects.toThrow();
  });

  it("throws on 4xx upstream response", async () => {
    const apiConfigRepo = {
      findOne: jest.fn().mockResolvedValue(salesApiConfig),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SalesApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<SalesApiService>(SalesApiService);

    const err = Object.assign(new Error("Not Found"), {
      response: { status: 404 },
    });
    jest.spyOn(svc as any, "httpGet").mockRejectedValue(err);

    await expect(svc.fetchDocuments(baseParams)).rejects.toThrow();
  });

  it("throws on 5xx upstream response", async () => {
    const apiConfigRepo = {
      findOne: jest.fn().mockResolvedValue(salesApiConfig),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SalesApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<SalesApiService>(SalesApiService);

    const err = Object.assign(new Error("Internal Server Error"), {
      response: { status: 500 },
    });
    jest.spyOn(svc as any, "httpGet").mockRejectedValue(err);

    await expect(svc.fetchDocuments(baseParams)).rejects.toThrow();
  });

  it("forwards dateFrom and dateTo when provided", async () => {
    const apiConfigRepo = {
      findOne: jest.fn().mockResolvedValue(salesApiConfig),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SalesApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<SalesApiService>(SalesApiService);
    const httpSpy = jest.spyOn(svc as any, "httpGet").mockResolvedValue([]);

    await svc.fetchDocuments({
      ...baseParams,
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
    });

    expect(httpSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({
          dateFrom: "2024-01-01",
          dateTo: "2024-12-31",
        }),
      }),
    );
  });
});
