import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApiConfig } from "../entities/api-config.entity";
import { UserDocumentConfig } from "../entities/user-document-config.entity";
import { SearchHistory } from "../entities/search-history.entity";
import { SalesApiModule } from "../external-apis/sales-api/sales-api.module";
import { ServiceApiModule } from "../external-apis/service-api/service-api.module";
import { MessageQueueModule } from "../message-queue/message-queue.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { DocumentNormalizerService } from "./normalizer/document-normalizer.service";
import { DocumentAssetSigningService } from "./signing/document-asset-signing.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([UserDocumentConfig, SearchHistory, ApiConfig]),
    SalesApiModule,
    ServiceApiModule,
    MessageQueueModule,
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentNormalizerService,
    DocumentAssetSigningService,
  ],
})
export class DocumentsModule {}
