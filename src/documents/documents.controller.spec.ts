import { Test, TestingModule } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { DocumentSourceFilter } from "./dtos/search-documents-query.dto";
import type { SearchResponseDto } from "./dtos/search-response.dto";

const mockSearchResponse = (): SearchResponseDto => ({
  correlationId: "test-correlation-id",
  vin: "1HGBH41JXMN109186",
  data: [],
  pagination: { page: 1, pageSize: 20, total: 0, hasMore: false },
  sources: [
    { name: "SALES", status: "OK", latencyMs: 100, documentCount: 0 },
    { name: "SERVICE", status: "OK", latencyMs: 120, documentCount: 0 },
  ],
  warnings: [],
});

describe("DocumentsController", () => {
  let controller: DocumentsController;
  let documentsService: jest.Mocked<DocumentsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        {
          provide: DocumentsService,
          useValue: {
            search: jest.fn(),
            getDocumentUrl: jest.fn(),
          },
        },
      ],
    })
      .overridePipe(ValidationPipe)
      .useValue(new ValidationPipe({ transform: true, whitelist: true }))
      .compile();

    controller = module.get<DocumentsController>(DocumentsController);
    documentsService = module.get(DocumentsService);
  });

  describe("search()", () => {
    it("calls documentsService.search with correct query and correlationId", async () => {
      documentsService.search.mockResolvedValue(mockSearchResponse());

      const query = {
        vin: "1HGBH41JXMN109186",
        page: 1,
        pageSize: 20,
        source: DocumentSourceFilter.ALL,
      };

      await controller.search(query, "test-correlation-id");

      expect(jest.mocked(documentsService.search)).toHaveBeenCalledWith(
        query,
        "test-correlation-id",
        expect.any(String),
        { salesMockForceError: false },
      );
    });

    it("returns the SearchResponseDto from documentsService", async () => {
      const response = mockSearchResponse();
      documentsService.search.mockResolvedValue(response);

      const result = await controller.search(
        {
          vin: "1HGBH41JXMN109186",
          page: 1,
          pageSize: 20,
          source: DocumentSourceFilter.ALL,
        },
        "test-correlation-id",
        undefined,
      );

      expect(result).toEqual(response);
    });
  });

  describe("getDocumentUrl()", () => {
    it("delegates to documentsService.getDocumentUrl and wraps in documentUrl key", async () => {
      documentsService.getDocumentUrl.mockResolvedValue(
        "https://cdn.keyloop.io/doc.pdf",
      );

      const result = await controller.getDocumentUrl(
        "SALES-SO-2024-00341",
        "test-correlation-id",
      );

      expect(jest.mocked(documentsService.getDocumentUrl)).toHaveBeenCalledWith(
        "SALES-SO-2024-00341",
        "test-correlation-id",
      );
      expect(result).toEqual({ documentUrl: "https://cdn.keyloop.io/doc.pdf" });
    });
  });
});
