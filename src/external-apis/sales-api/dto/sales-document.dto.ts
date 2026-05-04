export enum SalesDocumentType {
  BILL_OF_SALE = "BILL_OF_SALE",
  BUYERS_ORDER = "BUYERS_ORDER",
  RETAIL_INSTALLMENT_CONTRACT = "RETAIL_INSTALLMENT_CONTRACT",
  ODOMETER_DISCLOSURE = "ODOMETER_DISCLOSURE",
  TITLE_CERTIFICATE = "TITLE_CERTIFICATE",
  FI_DISCLOSURE = "FI_DISCLOSURE",
}

export enum FinanceType {
  CASH = "CASH",
  LEASE = "LEASE",
  RETAIL = "RETAIL",
}

export interface SalesDocumentDto {
  salesOrderId: string;
  documentType: SalesDocumentType;
  title: string;
  orderDate: string;
  handoverDate: string;
  salesPerson: string;
  financeType: FinanceType;
  storageUrl: string;
  fileSizeBytes: number;
  storeId: string;
  enterpriseId: string;
}
