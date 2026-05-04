import { Test, TestingModule } from "@nestjs/testing";
import { DocumentNormalizerService } from "./document-normalizer.service";
import type { SalesDocumentDto } from "../../external-apis/sales-api/dto/sales-document.dto";
import {
  SalesDocumentType,
  FinanceType,
} from "../../external-apis/sales-api/dto/sales-document.dto";
import type { ServiceDocumentDto } from "../../external-apis/service-api/dto/service-document.dto";
import { ServiceDocumentType } from "../../external-apis/service-api/dto/service-document.dto";

const makeSalesDoc = (
  overrides: Partial<SalesDocumentDto> = {},
): SalesDocumentDto => ({
  salesOrderId: "SO-2024-00341",
  documentType: SalesDocumentType.BILL_OF_SALE,
  title: "Bill of Sale — Toyota Camry 2023",
  orderDate: "2024-03-15T10:30:00Z",
  handoverDate: "2024-03-20T14:00:00Z",
  salesPerson: "John Smith",
  financeType: FinanceType.RETAIL,
  storageUrl: "https://s3.amazonaws.com/keyloop-docs/doc.pdf",
  fileSizeBytes: 245760,
  storeId: "STORE-001",
  enterpriseId: "ENT-KEYLOOP",
  ...overrides,
});

const makeServiceDoc = (
  overrides: Partial<ServiceDocumentDto> = {},
): ServiceDocumentDto => ({
  repairOrderId: "RO-2025-00891",
  documentType: ServiceDocumentType.REPAIR_ORDER,
  description: "60,000 Mile Full Service",
  checkInDateTime: "2025-01-10T08:15:00Z",
  completedDateTime: "2025-01-10T17:45:00Z",
  checkInMileage: 58320,
  technicianId: "TECH-042",
  laborItems: ["Oil Change", "Brake Inspection"],
  cdnUrl: "https://cdn.keyloop.io/docs/ro-891.pdf",
  fileSizeKb: 312,
  workshopId: "WS-LONDON-01",
  ...overrides,
});

describe("DocumentNormalizerService", () => {
  let service: DocumentNormalizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DocumentNormalizerService],
    }).compile();

    service = module.get<DocumentNormalizerService>(DocumentNormalizerService);
  });

  describe("fromSales", () => {
    it("builds id as SALES-{salesOrderId}", () => {
      const doc = makeSalesDoc();
      const result = service.fromSales(doc, new Set());
      expect(result.id).toBe("SALES-SO-2024-00341");
    });

    it("sets source to SALES", () => {
      const result = service.fromSales(makeSalesDoc(), new Set());
      expect(result.source).toBe("SALES");
    });

    it("maps handoverDate to date", () => {
      const doc = makeSalesDoc({ handoverDate: "2024-03-20T14:00:00Z" });
      const result = service.fromSales(doc, new Set());
      expect(result.date).toBe("2024-03-20T14:00:00Z");
    });

    it("passes through documentUrl from storageUrl", () => {
      const doc = makeSalesDoc({
        storageUrl: "https://s3.amazonaws.com/keyloop-docs/doc.pdf",
      });
      const result = service.fromSales(doc, new Set());
      expect(result.documentUrl).toBe(
        "https://s3.amazonaws.com/keyloop-docs/doc.pdf",
      );
    });

    it.each([
      [SalesDocumentType.BILL_OF_SALE, "Bill of Sale"],
      [SalesDocumentType.BUYERS_ORDER, "Buyer's Order"],
      [
        SalesDocumentType.RETAIL_INSTALLMENT_CONTRACT,
        "Retail Installment Contract",
      ],
      [SalesDocumentType.ODOMETER_DISCLOSURE, "Odometer Disclosure"],
      [SalesDocumentType.TITLE_CERTIFICATE, "Title Certificate"],
      [SalesDocumentType.FI_DISCLOSURE, "F&I Disclosure"],
    ])(
      "normalizes documentType %s to human-readable %s",
      (rawType, expected) => {
        const doc = makeSalesDoc({ documentType: rawType });
        const result = service.fromSales(doc, new Set());
        expect(result.documentType).toBe(expected);
      },
    );

    it("summary is 160 chars or fewer and includes financeType and salesPerson", () => {
      const doc = makeSalesDoc({
        financeType: FinanceType.RETAIL,
        salesPerson: "John Smith",
      });
      const result = service.fromSales(doc, new Set());
      expect(result.summary.length).toBeLessThanOrEqual(160);
      expect(result.summary).toContain("Retail");
      expect(result.summary).toContain("John Smith");
    });

    it("metadata contains financeType, salesPerson, salesOrderId", () => {
      const doc = makeSalesDoc();
      const result = service.fromSales(doc, new Set());
      expect(result.metadata).toMatchObject({
        financeType: FinanceType.RETAIL,
        salesPerson: "John Smith",
        salesOrderId: "SO-2024-00341",
      });
    });

    it("sets isVisible=true when documentType not in hidden set", () => {
      const result = service.fromSales(
        makeSalesDoc(),
        new Set(["REPAIR_ORDER"]),
      );
      expect(result.isVisible).toBe(true);
    });

    it("sets isVisible=false when documentType is in hidden set", () => {
      const doc = makeSalesDoc({
        documentType: SalesDocumentType.BILL_OF_SALE,
      });
      const result = service.fromSales(doc, new Set(["BILL_OF_SALE"]));
      expect(result.isVisible).toBe(false);
    });
  });

  describe("fromService", () => {
    it("builds id as SERVICE-{repairOrderId}", () => {
      const result = service.fromService(makeServiceDoc(), new Set());
      expect(result.id).toBe("SERVICE-RO-2025-00891");
    });

    it("sets source to SERVICE", () => {
      const result = service.fromService(makeServiceDoc(), new Set());
      expect(result.source).toBe("SERVICE");
    });

    it("maps completedDateTime to date", () => {
      const doc = makeServiceDoc({ completedDateTime: "2025-01-10T17:45:00Z" });
      const result = service.fromService(doc, new Set());
      expect(result.date).toBe("2025-01-10T17:45:00Z");
    });

    it("passes through documentUrl from cdnUrl", () => {
      const doc = makeServiceDoc({
        cdnUrl: "https://cdn.keyloop.io/docs/ro-891.pdf",
      });
      const result = service.fromService(doc, new Set());
      expect(result.documentUrl).toBe("https://cdn.keyloop.io/docs/ro-891.pdf");
    });

    it.each([
      [ServiceDocumentType.REPAIR_ORDER, "Repair Order"],
      [ServiceDocumentType.JOB_CARD, "Job Card"],
      [ServiceDocumentType.VHC_REPORT, "VHC Report"],
      [ServiceDocumentType.WORK_AUTHORIZATION, "Work Authorization"],
      [ServiceDocumentType.SERVICE_HISTORY, "Service History"],
      [ServiceDocumentType.WARRANTY_CLAIM, "Warranty Claim"],
    ])(
      "normalizes documentType %s to human-readable %s",
      (rawType, expected) => {
        const doc = makeServiceDoc({ documentType: rawType });
        const result = service.fromService(doc, new Set());
        expect(result.documentType).toBe(expected);
      },
    );

    it("summary is 160 chars or fewer and mentions technicianId", () => {
      const doc = makeServiceDoc({ technicianId: "TECH-042" });
      const result = service.fromService(doc, new Set());
      expect(result.summary.length).toBeLessThanOrEqual(160);
      expect(result.summary).toContain("TECH-042");
    });

    it("metadata contains checkInMileage, laborItems, technicianId, repairOrderId", () => {
      const doc = makeServiceDoc();
      const result = service.fromService(doc, new Set());
      expect(result.metadata).toMatchObject({
        checkInMileage: 58320,
        laborItems: ["Oil Change", "Brake Inspection"],
        technicianId: "TECH-042",
        repairOrderId: "RO-2025-00891",
      });
    });

    it("sets isVisible=false when documentType is in hidden set", () => {
      const doc = makeServiceDoc({
        documentType: ServiceDocumentType.REPAIR_ORDER,
      });
      const result = service.fromService(doc, new Set(["REPAIR_ORDER"]));
      expect(result.isVisible).toBe(false);
    });

    it("sets isVisible=true when documentType not in hidden set", () => {
      const result = service.fromService(makeServiceDoc(), new Set());
      expect(result.isVisible).toBe(true);
    });
  });
});
