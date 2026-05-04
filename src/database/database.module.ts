import { Module } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import databaseConfig from "../config/database.config";
import { ApiConfig } from "../entities/api-config.entity";
import { DocumentMetadataCache } from "../entities/document-metadata-cache.entity";
import { SearchHistory } from "../entities/search-history.entity";
import { UserDocumentConfig } from "../entities/user-document-config.entity";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (cfg: ConfigType<typeof databaseConfig>) => ({
        type: "postgres",
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        password: cfg.password,
        database: cfg.database,
        ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
        entities: [
          SearchHistory,
          DocumentMetadataCache,
          UserDocumentConfig,
          ApiConfig,
        ],
        synchronize: process.env.NODE_ENV !== "production",
      }),
    }),
  ],
})
export class DatabaseModule {}
