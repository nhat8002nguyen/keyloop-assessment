export enum ServiceDocumentType {
  REPAIR_ORDER = "REPAIR_ORDER",
  JOB_CARD = "JOB_CARD",
  VHC_REPORT = "VHC_REPORT",
  WORK_AUTHORIZATION = "WORK_AUTHORIZATION",
  SERVICE_HISTORY = "SERVICE_HISTORY",
  WARRANTY_CLAIM = "WARRANTY_CLAIM",
}

export interface ServiceDocumentDto {
  repairOrderId: string;
  documentType: ServiceDocumentType;
  description: string;
  checkInDateTime: string;
  completedDateTime: string;
  checkInMileage: number;
  technicianId: string;
  laborItems: string[];
  cdnUrl: string;
  fileSizeKb: number;
  workshopId: string;
}
