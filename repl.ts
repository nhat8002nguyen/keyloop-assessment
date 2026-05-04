/**
 * Seed PostgreSQL with sample rows for local / Postman testing.
 *
 * Usage (from aggregate-service/, with .env or defaults matching .env.example):
 *   pnpm repl:seed
 *
 * Prerequisites:
 *   - Postgres running (e.g. docker compose up -d db)
 *   - Schema: start the Nest app once in development (TypeORM synchronize) or apply migrations
 *   - For non-empty search results, run mock upstream APIs:
 *       pnpm mock:sales    # default http://localhost:3001
 *       pnpm mock:service # default http://localhost:3002
 */
import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import { DataSource } from "typeorm";
import { ApiConfig } from "./src/entities/api-config.entity";
import { DocumentSource } from "./src/entities/document-metadata-cache.entity";
import { UserDocumentConfig } from "./src/entities/user-document-config.entity";

function loadDotEnv(): void {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  const host = process.env.DB_HOST || "localhost";
  const port = Number(process.env.DB_PORT) || 5432;
  const username = process.env.DB_USERNAME || "postgres";
  const password = process.env.DB_PASSWORD || "postgres";
  const database = process.env.DB_DATABASE || "aggregate_service";
  const ssl = process.env.DB_SSL === "true";

  const salesBase = process.env.SEED_SALES_API_BASE ?? "http://localhost:3001";
  const serviceBase =
    process.env.SEED_SERVICE_API_BASE ?? "http://localhost:3002";

  const dataSource = new DataSource({
    type: "postgres",
    host,
    port,
    username,
    password,
    database,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    entities: [ApiConfig, UserDocumentConfig],
    synchronize: process.env.NODE_ENV !== "production",
  });

  await dataSource.initialize();

  const apiRepo = dataSource.getRepository(ApiConfig);
  const userRepo = dataSource.getRepository(UserDocumentConfig);

  await apiRepo.upsert(
    [
      {
        key: "SALES",
        baseUrl: salesBase,
        timeoutMs: 5000,
        isActive: true,
        splitRatio: 0.5,
        authConfigJson: {},
      },
      {
        key: "SERVICE",
        baseUrl: serviceBase,
        timeoutMs: 5000,
        isActive: true,
        splitRatio: 0.5,
        authConfigJson: {},
      },
    ],
    ["key"],
  );

  await userRepo.delete({ userId: "anonymous" });

  await userRepo.save([
    {
      userId: "anonymous",
      documentType: null,
      source: DocumentSource.SALES,
      isHidden: null,
      splitRatioOverride: 0.5,
    },
    {
      userId: "anonymous",
      documentType: "BILL_OF_SALE",
      source: DocumentSource.SALES,
      isHidden: true,
      splitRatioOverride: null,
    },
  ]);

  await dataSource.destroy();

  console.log("Seed complete.");
  console.log(`  api_config: SALES → ${salesBase}, SERVICE → ${serviceBase}`);
  console.log(
    "  user_document_config: anonymous row (50/50 split) + hide BILL_OF_SALE for demo",
  );
  console.log("");
  console.log("Postman / curl checks:");
  console.log(
    "  GET http://localhost:3000/api/v1/health  — if this 404, port 3000 is not this Nest app",
  );
  console.log(
    "  GET http://localhost:3000/api/v1/documents?vin=1HGBH41JXMN109186",
  );
  console.log(
    "  GET http://localhost:3000/api/v1/documents/SALES-SO-2024-00341/url",
  );
  console.log("");
  console.log(
    "Run mocks (separate terminals): pnpm mock:sales && pnpm mock:service",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
