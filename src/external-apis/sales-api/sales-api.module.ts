import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApiConfig } from "../../entities/api-config.entity";
import { SalesApiService } from "./sales-api.service";

@Module({
  imports: [TypeOrmModule.forFeature([ApiConfig])],
  providers: [SalesApiService],
  exports: [SalesApiService],
})
export class SalesApiModule {}
