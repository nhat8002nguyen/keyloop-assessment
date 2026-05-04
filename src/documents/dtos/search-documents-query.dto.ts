import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";

export enum DocumentSourceFilter {
  SALES = "SALES",
  SERVICE = "SERVICE",
  ALL = "ALL",
}

export class SearchDocumentsQueryDto {
  @ApiProperty({ description: "17-character Vehicle Identification Number" })
  @IsString()
  @Length(17, 17)
  vin: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize: number = 20;

  @ApiProperty({
    required: false,
    enum: DocumentSourceFilter,
    default: DocumentSourceFilter.ALL,
  })
  @IsOptional()
  @IsEnum(DocumentSourceFilter)
  source: DocumentSourceFilter = DocumentSourceFilter.ALL;

  @ApiProperty({
    required: false,
    description: "Inclusive start date (ISO 8601)",
  })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiProperty({
    required: false,
    description: "Inclusive end date (ISO 8601)",
  })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
