import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApiConfig } from "../../entities/api-config.entity";
import { ServiceApiService } from "./service-api.service";

@Module({
  imports: [TypeOrmModule.forFeature([ApiConfig])],
  providers: [ServiceApiService],
  exports: [ServiceApiService],
})
export class ServiceApiModule {}
