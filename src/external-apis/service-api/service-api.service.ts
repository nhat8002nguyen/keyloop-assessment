import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import axios from "axios";
import { ApiConfig } from "../../entities/api-config.entity";
import type { ServiceDocumentDto } from "./dto/service-document.dto";

export interface ServiceApiParams {
  vin: string;
  page: number;
  pageSize: number;
  correlationId: string;
  dateFrom?: string;
  dateTo?: string;
}

interface HttpGetOptions {
  params: Record<string, unknown>;
  headers: Record<string, string>;
  timeout?: number;
}

@Injectable()
export class ServiceApiService {
  private readonly logger = new Logger(ServiceApiService.name);

  constructor(
    @InjectRepository(ApiConfig)
    private readonly apiConfigRepo: Repository<ApiConfig>,
  ) {}

  async fetchDocuments(
    params: ServiceApiParams,
  ): Promise<ServiceDocumentDto[]> {
    const config = await this.apiConfigRepo.findOne({
      where: { key: "SERVICE" },
    });

    const baseUrl = config?.baseUrl ?? "http://localhost:3002";
    const timeoutMs = config?.timeoutMs ?? 5000;
    const auth = (config?.authConfigJson ?? {}) as Record<string, string>;

    const queryParams: Record<string, unknown> = {
      vin: params.vin,
      page: params.page,
      pageSize: params.pageSize,
    };
    if (params.dateFrom) queryParams.dateFrom = params.dateFrom;
    if (params.dateTo) queryParams.dateTo = params.dateTo;

    const headers: Record<string, string> = {
      "x-correlation-id": params.correlationId,
    };
    if (auth.enterpriseId) headers["x-enterprise-id"] = auth.enterpriseId;
    if (auth.storeId) headers["x-store-id"] = auth.storeId;

    this.logger.debug(
      `[SERVICE] Fetching vin=${params.vin} page=${params.page} pageSize=${params.pageSize}`,
    );

    return this.httpGet(`${baseUrl}/documents`, {
      params: queryParams,
      headers,
      timeout: timeoutMs,
    });
  }

  private async httpGet(
    url: string,
    options: HttpGetOptions,
  ): Promise<ServiceDocumentDto[]> {
    const response = await axios.get<{ documents: ServiceDocumentDto[] }>(url, {
      params: options.params,
      headers: options.headers,
      timeout: options.timeout,
    });
    return (
      response.data?.documents ??
      (response.data as unknown as ServiceDocumentDto[])
    );
  }
}
