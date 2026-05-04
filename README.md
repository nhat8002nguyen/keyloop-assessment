# Aggregate Service (BFF)

NestJS service that aggregates **Sales** and **Service** document APIs behind a single HTTP surface, with PostgreSQL config, Redis cache wiring, and Kafka for search events.

This README focuses on **running everything locally** and **testing with Postman**. Section **13** summarizes the **high-level strategy** used when building this service with AI assistance.

## Prerequisites

- **Node.js** (LTS recommended) and **pnpm**
- **Docker** and Docker Compose (for PostgreSQL; Redis and Kafka optional for basic document search)

## 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` if your Postgres host, port, user, password, or database name differ. Defaults match the `db` service in `docker-compose.yml` (`postgres` / `postgres`, database `aggregate_service` on port `5432`).

**Important:** If another PostgreSQL instance already listens on `5432`, either stop it or point `DB_*` at your real instance (and ensure the password matches that server, not only the compose file).

## 2. Start infrastructure

From this directory:

```bash
docker compose up -d db
```

Optional (only if you need Redis or Kafka):

```bash
docker compose up -d redis zookeeper kafka
```

## 3. Install dependencies

```bash
pnpm install
```

## 4. Seed sample API / user config (optional)

**Optional step.** The BFF already falls back to **Sales** `http://localhost:3001` and **Service** `http://localhost:3002` when no matching **`api_config`** row exists, so you can skip seeding for a quick local run with the default mock ports.

Run **`pnpm repl:seed`** when you want rows written to the database: upstream base URLs stored in **`api_config`**, plus sample **`user_document_config`** (e.g. split override, hidden document type for the demo user).

```bash
pnpm repl:seed
```

This sets **Sales** → `http://localhost:3001` and **Service** → `http://localhost:3002` (override with `SEED_SALES_API_BASE` / `SEED_SERVICE_API_BASE` if you change mock ports).

## 5. Start mock upstream APIs

Use **two separate terminals** (default ports **3001** and **3002**):

```bash
pnpm mock:sales
```

```bash
pnpm mock:service
```

Sanity check from the host:

```bash
curl -s "http://localhost:3001/documents?page=1&pageSize=5&vin=1HGBH41JXMN109186" | head -c 200
curl -s "http://localhost:3002/documents?page=1&pageSize=5&vin=1HGBH41JXMN109186" | head -c 200
```

Mock behavior notes:

- **`vin`** query param (17 characters) selects vehicle-specific documents from in-memory catalogs (`mocks/*/data/*-fixtures.ts`). Default catalog matches **`1HGBH41JXMN109186`**; additional sample VINs: **`5YJ3E1EA1KF123456`**, **`1C4RJFAG0FC123456`**. Unknown VIN → empty list. Omitting **`vin`** uses the default catalog (local `curl` only).
- **`X-Force-Error: true`** response header forces **500** (useful for resilience / circuit-breaker tests).
- **`X-Force-Timeout: true`** simulates a slow failure path on the Sales mock.

You can change ports with `SALES_MOCK_PORT` / `SERVICE_MOCK_PORT`; then update **`api_config.base_url`** (or re-seed with the `SEED_*` env vars) so the BFF still targets the correct URLs.

## 6. Start the BFF

```bash
pnpm start:dev
```

On success you should see logs mentioning **Aggregate BFF** and **documents** URL. The app listens on **`PORT`** from `.env` (default **3000**).

Quick checks:

- **Health:** `GET http://localhost:3000/api/v1/health`
- **OpenAPI UI:** `http://localhost:3000/api/docs` (title should be **Aggregate Service**)

If **`/api/v1/health`** or **`/api/docs`** do not match this app, another process may be bound to port `3000` (for example a different Nest project). Free the port or set `PORT` to a free value and use that base URL in Postman.

## 7. Postman

1. Import **`postman/documents.postman_collection.json`**.
2. Open the collection **Variables** tab and confirm **`aggregateApiBase`** is `http://localhost:3000/api` (or `http://localhost:<PORT>/api` if you changed `PORT`).
3. Avoid naming conflicts with Postman environments: this collection uses **`aggregateApiBase`** (not `baseUrl`) so an empty global `baseUrl` does not break requests.
4. Run the **Search** requests with a **17-character VIN** (e.g. `1HGBH41JXMN109186`).
5. For **Get document URL**, set **`documentId`** to an id from the search response (format like `SALES-SO-2024-00341`), or use a known fixture id from the mock data.

Optional header: **`x-correlation-id`** (UUID); the server also generates one when omitted.

For integration-style runs against mocks: **`x-sales-force-error: true`** triggers the Sales mock’s **`x-force-error`** behaviour from the BFF (partial-failure path).

## 8. Expected search response (happy path)

With mocks up (default `api_config` URLs apply without seeding; seeding adds DB-backed config and sample user rules), **`GET /api/v1/documents?...&source=ALL`** should return:

- **`sources`**: `SALES` and `SERVICE` with **`status`: `"OK"`** and non-zero **`documentCount`** when fixtures return rows.
- **`data`**: merged normalized documents (may be smaller if user visibility rules hide types).
- **`warnings`**: usually empty when both sources succeed.

If both sources fail, **`data`** is empty and **`warnings`** includes a message that both backends are unavailable—verify mocks are running and **`api_config.base_url`** values match (no trailing **`/api`**; the BFF appends **`/documents`**).

## 9. Kafka (optional)

Search publishes to topic **`document.search`** when the broker is reachable. To inspect messages locally:

```bash
docker compose up -d zookeeper kafka
```

```bash
docker compose exec kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic document.search \
  --from-beginning
```

Ensure `.env` **`KAFKA_BROKERS`** matches your broker (default `localhost:9092`). To silence the KafkaJS partitioner warning in logs, set **`KAFKAJS_NO_PARTITIONER_WARNING=1`**.

## 10. Observability (local Grafana + Kibana)

Start Prometheus, Grafana, Elasticsearch, Kibana, and Filebeat (Compose **profile** `observability`):

```bash
docker compose --profile observability up -d
```

With the BFF on **`localhost:3000`** (default **`PORT`**):

| UI | URL | Notes |
|----|-----|------|
| **Prometheus** | http://localhost:9090 | Scrapes **`host.docker.internal:3000/metrics`** |
| **Grafana** | http://localhost:3005 · login **`admin` / `admin`** | Prometheus datasource is provisioned |
| **Kibana** | http://localhost:5601 | Create a **data view** on `aggregate-logs-*` after logs exist |

Expose Prometheus metrics from the app at **`GET /metrics`** (same names as in **`system-design.md`**, for example `aggregate_request_duration_ms`, `downstream_request_duration_ms`, `circuit_breaker_state`). HTTP access logs use structured JSON via **nestjs-pino**.

To ship logs into Elasticsearch for Kibana, set **`LOG_TO_FILE=true`** in `.env`, restart the BFF (writes **`logs/aggregate.jsonl`**), then ensure Filebeat is running (`docker compose --profile observability up -d`). Create the **`logs`** directory if it does not exist.

## 11. Useful scripts

| Command | Purpose |
|--------|---------|
| `pnpm start:dev` | Run BFF with watch |
| `pnpm mock:sales` | Sales mock HTTP API |
| `pnpm mock:service` | Service mock HTTP API |
| `pnpm repl:seed` | Seed `api_config` + sample `user_document_config` |
| `pnpm test` | Unit tests |
| `pnpm build` | Production build |

## 12. Troubleshooting

| Symptom | Things to check |
|--------|------------------|
| Postgres **password authentication failed** | Another Postgres on `5432` with a different password; align `.env` **DB_*** or use compose `db` only. |
| **`DataTypeNotSupportedError` / metadata errors** | Use current `main`; entity columns use explicit DB types. |
| **404** on `/api/v1/documents` | Wrong app on port 3000; confirm `/api/docs` is Aggregate Service. |
| **`sources` all ERROR** | Mocks not running; wrong `base_url` in `api_config`; firewall; circuit breaker after many failures—restart BFF or wait. |
| **Empty `data` but sources OK** | Strong date filters; seed hides some types for user `anonymous` (from `repl:seed`). |

## 13. High-level strategy for guiding AI assistance

This service was built with Cursor using a deliberate prompting approach: anchor on **`system-design.md`**, reuse existing Nest templates (`nestjs-template`, **`cache/`**), and tighten vague asks into concrete constraints (interceptor circuit breaker, **`IMessageQueueService`**, env-driven infra).

### Strategy

- **Single source of truth** — Implement against **`system-design.md`**; when behavior changed (e.g. configurable pagination split), update the design doc, entities, and tests together.
- **Phased delivery** — **Tests first** (skeletons + specs), human review, then implementation so behavior is encoded before shipping logic.
- **Template reuse** — Follow the **`nestjs-template`** layout
- **Concrete constraints** — Specify patterns explicitly (circuit breaker as **`NestInterceptor`**, message queue behind an interface, config for managed DB/cache/broker).
- **Narrow follow-ups** — For fixes, include file paths, error text, and line numbers so changes stay small and reviewable.
- **Operational realism** — Drive Postman, seed scripts, and this README from real integration pain (wrong process on port 3000, env variable precedence, DB port conflicts).

### Verifying and refining output

| Step | Practice |
|------|----------|
| **Compile and test** | Run **`tsc`** and **`pnpm test`** after each chunk; stub phase may fail tests by design, then go green after implementation. |
| **Lint as contract** | Fix unsafe `any`, unbound methods, and unresolved types with types and small extractions—not blanket `eslint-disable`. |
| **Integration checks** | Mocks, optional seed, and Postman catch routing and variable issues early. |
| **Design drift** | Schema or split-ratio changes touch design, migrations/synchronize expectations, and specs at once. |
| **Explain then change** | For observability and messaging, confirm behavior first, then integrate or fix bootstrap order. |

### Ensuring final quality

- Broad automated coverage (normalizer, HTTP clients, circuit breaker, documents flow, Kafka adapter, controller).
- Consistent layout: **`external-apis/`**, queue abstraction, DB-driven split ratios and user rules.
- Config and observability aligned with **`system-design.md`** (metrics, structured logs, optional ELK).
- Hardening via strict TypeScript/ESLint and small refactors (e.g. shared circuit-breaker state for metrics).

---

For design details, see the repository **`system-design.md`** at the monorepo root if present.
