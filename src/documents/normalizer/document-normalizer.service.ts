import { Injectable } from "@nestjs/common";
import {
  SalesDocumentType,
  FinanceType,
} from "../../external-apis/sales-api/dto/sales-document.dto";
import type { SalesDocumentDto } from "../../external-apis/sales-api/dto/sales-document.dto";
import { ServiceDocumentType } from "../../external-apis/service-api/dto/service-document.dto";
import type { ServiceDocumentDto } from "../../external-apis/service-api/dto/service-document.dto";
import type { UnifiedDocumentDto } from "../dtos/unified-document.dto";

const SALES_TYPE_LABELS: Record<SalesDocumentType, string> = {
  [SalesDocumentType.BILL_OF_SALE]: "Bill of Sale",
  [SalesDocumentType.BUYERS_ORDER]: "Buyer's Order",
  [SalesDocumentType.RETAIL_INSTALLMENT_CONTRACT]:
    "Retail Installment Contract",
  [SalesDocumentType.ODOMETER_DISCLOSURE]: "Odometer Disclosure",
  [SalesDocumentType.TITLE_CERTIFICATE]: "Title Certificate",
  [SalesDocumentType.FI_DISCLOSURE]: "F&I Disclosure",
};

const FINANCE_TYPE_LABELS: Record<FinanceType, string> = {
  [FinanceType.CASH]: "Cash",
  [FinanceType.LEASE]: "Lease",
  [FinanceType.RETAIL]: "Retail",
};

const SERVICE_TYPE_LABELS: Record<ServiceDocumentType, string> = {
  [ServiceDocumentType.REPAIR_ORDER]: "Repair Order",
  [ServiceDocumentType.JOB_CARD]: "Job Card",
  [ServiceDocumentType.VHC_REPORT]: "VHC Report",
  [ServiceDocumentType.WORK_AUTHORIZATION]: "Work Authorization",
  [ServiceDocumentType.SERVICE_HISTORY]: "Service History",
  [ServiceDocumentType.WARRANTY_CLAIM]: "Warranty Claim",
};

const truncate = (str: string, max: number): string =>
  str.length <= max ? str : str.slice(0, max - 1) + "…";

@Injectable()
export class DocumentNormalizerService {
  fromSales(
    doc: SalesDocumentDto,
    hiddenTypes: Set<string>,
  ): UnifiedDocumentDto {
    const financeLabel =
      FINANCE_TYPE_LABELS[doc.financeType] ?? doc.financeType;
    const rawSummary = `Finance type: ${financeLabel} · Sales: ${doc.salesPerson}`;

    return {
      id: `SALES-${doc.salesOrderId}`,
      source: "SALES",
      documentType: SALES_TYPE_LABELS[doc.documentType] ?? doc.documentType,
      title: doc.title,
      summary: truncate(rawSummary, 160),
      documentUrl: doc.storageUrl,
      date: doc.handoverDate,
      metadata: {
        salesOrderId: doc.salesOrderId,
        salesPerson: doc.salesPerson,
        financeType: doc.financeType,
      },
      isVisible: !hiddenTypes.has(doc.documentType),
    };
  }

  fromService(
    doc: ServiceDocumentDto,
    hiddenTypes: Set<string>,
  ): UnifiedDocumentDto {
    const labourPreview = doc.laborItems.slice(0, 3).join(", ");
    const rawSummary = `Technician: ${doc.technicianId} · Labour: ${labourPreview}`;

    return {
      id: `SERVICE-${doc.repairOrderId}`,
      source: "SERVICE",
      documentType: SERVICE_TYPE_LABELS[doc.documentType] ?? doc.documentType,
      title: doc.description,
      summary: truncate(rawSummary, 160),
      documentUrl: doc.cdnUrl,
      date: doc.completedDateTime,
      metadata: {
        repairOrderId: doc.repairOrderId,
        checkInMileage: doc.checkInMileage,
        laborItems: doc.laborItems,
        technicianId: doc.technicianId,
      },
      isVisible: !hiddenTypes.has(doc.documentType),
    };
  }
}
