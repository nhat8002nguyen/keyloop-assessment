import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import * as http from "http";
import * as supertest from "supertest";
import { AppModule } from "../src/app.module";
import { salesMockApp } from "../mocks/sales-api/server";
import { serviceMockApp } from "../mocks/service-api/server";

const SALES_MOCK_PORT = 13001;
const SERVICE_MOCK_PORT = 13002;
const TEST_VIN = "1HGBH41JXMN109186";

describe("Documents API (e2e)", () => {
  let app: INestApplication;
  let salesMockServer: http.Server;
  let serviceMockServer: http.Server;

  beforeAll(async () => {
    salesMockServer = salesMockApp.listen(SALES_MOCK_PORT);
    serviceMockServer = serviceMockApp.listen(SERVICE_MOCK_PORT);

    process.env.SALES_API_BASE_URL = `http://localhost:${SALES_MOCK_PORT}`;
    process.env.SERVICE_API_BASE_URL = `http://localhost:${SERVICE_MOCK_PORT}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bufferLogs: true });
    app.useLogger(false);
    app.setGlobalPrefix("api", { exclude: ["metrics"] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    salesMockServer.close();
    serviceMockServer.close();
  });

  describe("GET /api/v1/documents", () => {
    it("returns 200 with merged documents from both sources", async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .get("/api/v1/documents")
        .query({ vin: TEST_VIN })
        .set("x-correlation-id", "e2e-test-001")
        .expect(200);

      expect(response.body).toMatchObject({
        correlationId: "e2e-test-001",
        vin: TEST_VIN,
        data: expect.any(Array),
        pagination: expect.objectContaining({ page: 1 }),
        sources: expect.arrayContaining([
          expect.objectContaining({ name: "SALES", status: "OK" }),
          expect.objectContaining({ name: "SERVICE", status: "OK" }),
        ]),
        warnings: [],
      });
    });

    it("echoes X-Correlation-ID in response header", async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .get("/api/v1/documents")
        .query({ vin: TEST_VIN })
        .set("x-correlation-id", "e2e-echo-test")
        .expect(200);

      expect(response.headers["x-correlation-id"]).toBe("e2e-echo-test");
    });

    it("returns documents sorted by date descending", async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .get("/api/v1/documents")
        .query({ vin: TEST_VIN })
        .expect(200);

      const dates: number[] = response.body.data.map((d: any) =>
        new Date(d.date).getTime(),
      );
      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
      }
    });

    it("generates a correlationId when none provided", async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .get("/api/v1/documents")
        .query({ vin: TEST_VIN })
        .expect(200);

      expect(response.body.correlationId).toBeTruthy();
      expect(response.headers["x-correlation-id"]).toBeTruthy();
    });

    it("partial failure: Sales mock returns 500 → 200 with SERVICE docs and warning", async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .get("/api/v1/documents")
        .query({ vin: TEST_VIN })
        .set("x-correlation-id", "e2e-partial-failure")
        .set("x-sales-force-error", "true")
        .expect(200);

      expect(response.body.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("Sales")]),
      );
      expect(
        response.body.sources.find((s: any) => s.name === "SALES")?.status,
      ).not.toBe("OK");
    });

    describe("VIN validation", () => {
      it("returns 400 when VIN is 16 characters", async () => {
        await supertest
          .default(app.getHttpServer())
          .get("/api/v1/documents")
          .query({ vin: "1HGBH41JXMN10918" })
          .expect(400);
      });

      it("returns 400 when VIN is 18 characters", async () => {
        await supertest
          .default(app.getHttpServer())
          .get("/api/v1/documents")
          .query({ vin: "1HGBH41JXMN1091860" })
          .expect(400);
      });

      it("returns 400 when VIN is missing", async () => {
        await supertest
          .default(app.getHttpServer())
          .get("/api/v1/documents")
          .expect(400);
      });
    });

    describe("source filter", () => {
      it("source=SALES returns only SALES documents", async () => {
        const response = await supertest
          .default(app.getHttpServer())
          .get("/api/v1/documents")
          .query({ vin: TEST_VIN, source: "SALES" })
          .expect(200);

        const sources = [
          ...new Set(response.body.data.map((d: any) => d.source)),
        ];
        expect(sources).toEqual(["SALES"]);
      });

      it("source=SERVICE returns only SERVICE documents", async () => {
        const response = await supertest
          .default(app.getHttpServer())
          .get("/api/v1/documents")
          .query({ vin: TEST_VIN, source: "SERVICE" })
          .expect(200);

        const sources = [
          ...new Set(response.body.data.map((d: any) => d.source)),
        ];
        expect(sources).toEqual(["SERVICE"]);
      });
    });

    describe("pagination", () => {
      it("respects pageSize parameter", async () => {
        const response = await supertest
          .default(app.getHttpServer())
          .get("/api/v1/documents")
          .query({ vin: TEST_VIN, pageSize: 4 })
          .expect(200);

        expect(response.body.data.length).toBeLessThanOrEqual(4);
        expect(response.body.pagination.pageSize).toBe(4);
      });
    });
  });

  describe("GET /api/v1/documents/:documentId/url", () => {
    it("returns a documentUrl for a valid document ID", async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .get("/api/v1/documents/SALES-SO-2024-00341/url")
        .set("x-correlation-id", "e2e-url-test")
        .expect(200);

      expect(response.body).toHaveProperty("documentUrl");
      expect(typeof response.body.documentUrl).toBe("string");
    });
  });

  describe("GET /api/v1/health", () => {
    it("returns health status with downstream sources", async () => {
      const response = await supertest
        .default(app.getHttpServer())
        .get("/api/v1/health")
        .expect(200);

      expect(response.body).toMatchObject({
        status: expect.stringMatching(/OK|DEGRADED/),
        downstream: expect.arrayContaining([
          expect.objectContaining({ name: "SALES" }),
          expect.objectContaining({ name: "SERVICE" }),
        ]),
      });
    });
  });
});
