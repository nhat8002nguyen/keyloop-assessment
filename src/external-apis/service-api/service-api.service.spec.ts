import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ServiceApiService } from "./service-api.service";
import { ApiConfig } from "../../entities/api-config.entity";
import type { ServiceApiParams } from "./service-api.service";

const serviceApiConfig: ApiConfig = {
  key: "SERVICE",
  baseUrl: "http://localhost:3002",
  timeoutMs: 5000,
  isActive: true,
  splitRatio: 0.5,
  authConfigJson: {},
  updatedAt: new Date(),
};

describe("ServiceApiService", () => {
  let service: ServiceApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceApiService,
        {
          provide: getRepositoryToken(ApiConfig),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ServiceApiService>(ServiceApiService);
  });

  const baseParams: ServiceApiParams = {
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
      findOne: jest.fn().mockResolvedValue(serviceApiConfig),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ServiceApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<ServiceApiService>(ServiceApiService);
    const httpSpy = jest.spyOn(svc as any, "httpGet").mockResolvedValue([]);

    await svc.fetchDocuments(baseParams);

    expect(httpSpy).toHaveBeenCalledWith(
      expect.stringContaining("http://localhost:3002"),
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
      findOne: jest.fn().mockResolvedValue(serviceApiConfig),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ServiceApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<ServiceApiService>(ServiceApiService);
    const httpSpy = jest.spyOn(svc as any, "httpGet").mockResolvedValue([]);

    await svc.fetchDocuments({ ...baseParams, correlationId: "xyz-999" });

    expect(httpSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-correlation-id": "xyz-999" }),
      }),
    );
  });

  it("propagates X-Enterprise-ID and X-Store-ID from api_config", async () => {
    const configWithAuth: ApiConfig = {
      ...serviceApiConfig,
      authConfigJson: { enterpriseId: "ENT-KEYLOOP", storeId: "WS-LONDON-01" },
    };
    const apiConfigRepo = {
      findOne: jest.fn().mockResolvedValue(configWithAuth),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ServiceApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<ServiceApiService>(ServiceApiService);
    const httpSpy = jest.spyOn(svc as any, "httpGet").mockResolvedValue([]);

    await svc.fetchDocuments(baseParams);

    expect(httpSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-enterprise-id": "ENT-KEYLOOP",
          "x-store-id": "WS-LONDON-01",
        }),
      }),
    );
  });

  it("throws when response exceeds timeoutMs", async () => {
    const apiConfigRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ ...serviceApiConfig, timeoutMs: 1 }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ServiceApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<ServiceApiService>(ServiceApiService);

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
      findOne: jest.fn().mockResolvedValue(serviceApiConfig),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ServiceApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<ServiceApiService>(ServiceApiService);
    const err = Object.assign(new Error("Not Found"), {
      response: { status: 404 },
    });
    jest.spyOn(svc as any, "httpGet").mockRejectedValue(err);

    await expect(svc.fetchDocuments(baseParams)).rejects.toThrow();
  });

  it("throws on 5xx upstream response", async () => {
    const apiConfigRepo = {
      findOne: jest.fn().mockResolvedValue(serviceApiConfig),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ServiceApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<ServiceApiService>(ServiceApiService);
    const err = Object.assign(new Error("Internal Server Error"), {
      response: { status: 500 },
    });
    jest.spyOn(svc as any, "httpGet").mockRejectedValue(err);

    await expect(svc.fetchDocuments(baseParams)).rejects.toThrow();
  });

  it("forwards dateFrom and dateTo when provided", async () => {
    const apiConfigRepo = {
      findOne: jest.fn().mockResolvedValue(serviceApiConfig),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ServiceApiService,
        { provide: getRepositoryToken(ApiConfig), useValue: apiConfigRepo },
      ],
    }).compile();
    const svc = mod.get<ServiceApiService>(ServiceApiService);
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
