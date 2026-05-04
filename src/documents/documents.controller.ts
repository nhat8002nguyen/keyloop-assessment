import { Controller, Get, Headers, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CorrelationId } from "../common/decorators/correlation-id.decorator";
import { DocumentsService } from "./documents.service";
import { SearchDocumentsQueryDto } from "./dtos/search-documents-query.dto";
import type { SearchResponseDto } from "./dtos/search-response.dto";

@ApiTags("documents")
@Controller("v1/documents")
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  search(
    @Query() query: SearchDocumentsQueryDto,
    @CorrelationId() correlationId: string,
    @Headers("x-sales-force-error") salesForceError?: string,
  ): Promise<SearchResponseDto> {
    const userId = "anonymous";
    return this.documentsService.search(query, correlationId, userId, {
      salesMockForceError: salesForceError === "true",
    });
  }

  @Get(":documentId/url")
  getDocumentUrl(
    @Param("documentId") documentId: string,
    @CorrelationId() correlationId: string,
  ): Promise<{ documentUrl: string }> {
    return this.documentsService
      .getDocumentUrl(documentId, correlationId)
      .then((documentUrl) => ({ documentUrl }));
  }
}
