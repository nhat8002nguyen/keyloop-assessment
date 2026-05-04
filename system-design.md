# Unified Document Viewer — System Design

**Domain:** Keyloop Operate  
**Pattern:** Backend-for-Frontend (BFF) + Gateway Aggregation  
**Request Strategy:** Parallel fan-out with partial-success fallback  
**Observability (target):** OpenTelemetry → Grafana + ELK Stack — **OpenTelemetry (SDK / Collector) is not in the current demo.**  

This document is the architectural plan for the unified document viewer. It includes: an **architecture diagram**, **component roles**, **data flow**, **API and data models**, **technology choices with justification**, a **target observability strategy** (logging, metrics, tracing), and a **GenAI** section describing how generative AI assisted the design phase.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────┐
│          Client Browser                 │
│         React / Next.js                 │
└──────────────────┬──────────────────────┘
                   │ HTTPS + X-Correlation-ID
┌──────────────────▼──────────────────────┐
│             API Gateway                 │
│   Auth (OAuth 2.0) · Rate Limit · CORS  │
└──────────────────┬──────────────────────┘
                   │ VIN · filters · page
┌──────────────────▼──────────────────────┐
│       Aggregate Service (BFF)           │  ←── main service
│          Node.js / NestJS               │
└────────┬──────────────────┬─────────────┘
         │ parallel (n/2)   │ parallel (n/2)
┌────────▼──────┐    ┌──────▼──────────┐
│ Sales Mock API│    │ Service Mock API │
│ Deal Jacket   │    │ Repair Orders   │
│ Finance Docs  │    │ VHC · History   │
└───────┬───────┘    └──────┬──────────┘
        │  doc URLs         │  doc URLs
        └────────┬──────────┘
        ┌────────▼──────────────┐
        │  Object Storage / CDN │
        │  AWS S3 + CloudFront  │
        └───────────────────────┘

Async (non-critical path):
  Aggregate Service ──(dashed)──▶ PostgreSQL  (user config, search history, metadata cache, api config)
  Aggregate Service ──(dashed)──▶ Kafka Broker ──▶ Spark Jobs (analytics) [not in demo — design only]
  Aggregate Service ──(dashed)──▶ OpenTelemetry Collector (planned)
                                        ├──▶ Grafana / Prometheus  (metrics)
                                        └──▶ ELK Stack             (logs)
```

### 1.1 Data flow

**Synchronous path — document search**

1. The **client** issues an HTTPS request (e.g. `GET /api/v1/documents`) with VIN, pagination, optional source and date filters, and a **correlation ID** (or the **API Gateway** injects one).
2. The **API Gateway** validates OAuth 2.0 tokens, applies rate limits and CORS, and forwards the request to the **Aggregate Service**.
3. The **Aggregate Service** resolves pagination split ratios (`user_document_config` overrides, then `api_config`, then 50/50 fallback), loads downstream base URLs and timeouts, and issues **two parallel** HTTP calls to the **Sales Mock API** and **Service Mock API** (`Promise.allSettled`). Each downstream call receives its allocated share of `pageSize` and the same correlation ID.
4. Each **mock API** returns **metadata and URLs** to PDFs in object storage/CDN — not file bodies. Responses may differ in shape; the BFF maps both into the **unified document schema**, merges lists, sorts by the canonical **`date`** field (descending), and applies **user visibility** from PostgreSQL.
5. If one downstream fails or times out, the BFF applies the **partial-success** rules (extra fetch from the healthy source, warnings in the payload). The HTTP response includes unified documents, pagination, per-source status, correlation ID, and optional **warnings**.

**Synchronous path — inline viewing**

6. When the user opens a document, the client calls the BFF **signed URL** endpoint (`GET /api/v1/documents/:documentId/url`) so the UI receives a fresh URL suitable for inline PDF rendering via CDN/object storage.

**Asynchronous paths (non-blocking for the user)**

7. After the search/view HTTP response is committed, the Aggregate Service may emit **Kafka** events (`document.search`, `document.view`) for history and downstream analytics; failures are logged and do not change the API response.
8. **OpenTelemetry** instrumentation would send traces, metrics, and structured log hooks to the **Collector**, which fans out to **Grafana/Prometheus** (SLO-style metrics) and **ELK** (searchable logs and audit views).

---

## 2. Component List

| Component | Technology | Role |
|---|---|---|
| Client Browser | React / Next.js | VIN search UI, filter controls, document list + inline PDF viewer |
| API Gateway | Kong / AWS API Gateway | OAuth 2.0 token validation, rate limiting, CORS, correlation ID injection *(planned — not in current demo; clients call the BFF directly)* |
| Aggregate Service (BFF) | Node.js / NestJS | Fan-out orchestration, schema normalization, partial-failure handling, event publishing |
| Sales Mock API | Express.js (mock) | Returns Deal Jacket documents: Bill of Sale, Finance docs, Title, Odometer Disclosure |
| Service Mock API | Express.js (mock) | Returns Repair Orders, VHC Reports, Service History, Warranty Claims |
| Object Storage / CDN | AWS S3 + CloudFront | Stores actual PDF documents; both mock APIs return pre-signed/CDN URLs, not file bytes |
| PostgreSQL | PostgreSQL 15 | Search history, document metadata cache, user visibility config, downstream API config |
| Kafka Broker | Apache Kafka | Async event bus for search and view events — decoupled from the request path |
| Spark Jobs | Apache Spark (Streaming) | Consume Kafka events; persist search history; drive batch/streaming **analytics** *(planned — not in current demo; see §7.2)* |
| OpenTelemetry Collector | OTel SDK + Collector | Receives traces, metrics, and structured logs from all services |
| Grafana / Prometheus | Grafana OSS | Latency p95/p99, error rates, circuit breaker state, partial-success frequency |
| ELK Stack | Elasticsearch + Logstash + Kibana | Centralized log ingestion, full-text search, audit dashboards |

### 2.1 Technologies and justifications

| Technology | Why it was chosen |
|---|---|
| **React / Next.js (client)** | Fits a document list + viewer UI; SSR/CSR options align with a gateway-backed BFF. |
| **Kong / AWS API Gateway** | **Not yet in this demo** — reserved for a production edge layer (OAuth validation, throttling, correlation ID injection). The demo talks to the Aggregate Service directly without this gateway. |
| **Node.js + NestJS (Aggregate Service)** | Strong fit for I/O-bound BFF work (parallel HTTP fan-out), modular structure, and testable providers for downstream clients and messaging. |
| **Express (mock Sales / Service APIs)** | Lightweight HTTP mocks that mirror real microservice boundaries without over-building throwaway implementations. |
| **AWS S3 + CloudFront** | Object storage and CDN for large PDFs; APIs return URLs so bytes never transit the BFF. |
| **PostgreSQL** | Relational model for user config, API config, search history, and cache metadata with clear constraints and indexing. |
| **Apache Kafka** | Durable, scalable event bus for search/view analytics decoupled from the request path. |
| **Apache Spark (streaming / scheduled)** | **Not yet in this demo** — planned batch/streaming layer for history persistence and usage **analytics** off Kafka. See **§7.2** (design only). |
| **OpenTelemetry** | Vendor-neutral standard for **traces**, **metrics**, and log correlation across Gateway, BFF, and mocks (SDK + Collector). |
| **Prometheus + Grafana** | Histograms and counters for latency percentiles, errors, and circuit-breaker state — dashboard-friendly SRE workflows. |
| **ELK (Elasticsearch, Logstash, Kibana)** | Centralized **logging**, full-text query by correlation ID / VIN / user for audit and debugging. |

---

## 3. API Design

### 3.1 Aggregate Service Endpoints

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/v1/documents` | Search documents by VIN; supports pagination and filters | Bearer (OAuth 2.0) |
| GET | `/api/v1/documents/:documentId/url` | Fetch a fresh signed URL for a specific document | Bearer |
| GET | `/api/v1/health` | Liveness + downstream service status | None |

### 3.2 Search Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `vin` | string (17 chars) | **Yes** | 17-character Vehicle Identification Number |
| `page` | integer | No · default: 1 | Page number (1-indexed) |
| `pageSize` | integer | No · default: 20 | Total documents per page; per-source share is **resolved** from `api_config.split_ratio` and `user_document_config.split_ratio_override` (see **§5.1**) — not a fixed 50/50 |
| `source` | `SALES \| SERVICE \| ALL` | No · default: ALL | Filter results to one source system |
| `dateFrom` | ISO 8601 date | No | Inclusive start date filter applied to both sources |
| `dateTo` | ISO 8601 date | No | Inclusive end date filter applied to both sources |

### 3.3 Search Response Envelope

```jsonc
// GET /api/v1/documents?vin=1HGBH41JXMN109186&page=1&pageSize=20
// Response header: X-Correlation-ID: <uuid>
{
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "vin": "1HGBH41JXMN109186",
  "data": [ /* Document[] — see Unified Document schema */ ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 47,
    "hasMore": true
  },
  "sources": [
    { "name": "SALES",   "status": "OK",   "latencyMs": 210, "documentCount": 10 },
    { "name": "SERVICE", "status": "OK",   "latencyMs": 340, "documentCount": 10 }
  ],
  "warnings": []
}
```

### 3.4 Fan-out to Downstream Mock APIs

Both mock APIs are called in parallel via `Promise.allSettled`. Each receives its **resolved** share of the requested `pageSize` (`salesPageSize` / `servicePageSize` from **§5.1**), not a hardcoded half.

| Header / Param | Sales API | Service API |
|---|---|---|
| `X-Correlation-ID` | Propagated unchanged | Propagated unchanged |
| `X-Enterprise-ID` | From api_config table | From api_config table |
| `X-Store-ID` | From api_config table | From api_config table |
| `vin` | Query param | Query param |
| `page` | Client page (offset-adjusted) | Client page (offset-adjusted) |
| `pageSize` | `salesPageSize` (from resolved split) | `servicePageSize` (from resolved split) |
| `dateFrom` / `dateTo` | Passed through if set | Passed through if set |

---

## 4. Data Models

### 4.1 Sales Mock API Response (per document)

```jsonc
{
  "salesOrderId":  "SO-2024-00341",
  "documentType":  "BILL_OF_SALE", // BILL_OF_SALE | BUYERS_ORDER | RETAIL_INSTALLMENT_CONTRACT | ODOMETER_DISCLOSURE | TITLE_CERTIFICATE | FI_DISCLOSURE
  "title":         "Bill of Sale — Toyota Camry 2023",
  "orderDate":     "2024-03-15T10:30:00Z",
  "handoverDate":  "2024-03-20T14:00:00Z",   // <-- used as canonical sort date
  "salesPerson":   "John Smith",
  "financeType":   "RETAIL",                  // CASH | LEASE | RETAIL
  "storageUrl":    "https://s3.amazonaws.com/keyloop-docs/...",  // S3 pre-signed URL, expires 1h
  "fileSizeBytes": 245760,
  "storeId":       "STORE-001",
  "enterpriseId":  "ENT-KEYLOOP"
}
```

### 4.2 Service Mock API Response (per document)

```jsonc
{
  "repairOrderId":     "RO-2025-00891",
  "documentType":      "REPAIR_ORDER", // REPAIR_ORDER | JOB_CARD | VHC_REPORT | WORK_AUTHORIZATION | SERVICE_HISTORY | WARRANTY_CLAIM
  "description":       "60,000 Mile Full Service & Inspection",
  "checkInDateTime":   "2025-01-10T08:15:00Z",
  "completedDateTime": "2025-01-10T17:45:00Z",  // <-- used as canonical sort date
  "checkInMileage":    58320,
  "technicianId":      "TECH-042",
  "laborItems":        ["Oil Change", "Brake Inspection", "Tyre Rotation"],
  "cdnUrl":            "https://cdn.keyloop.io/docs/...",  // CloudFront URL
  "fileSizeKb":        312,
  "workshopId":        "WS-LONDON-01"
}
```

### 4.3 Unified Document Schema (returned to client)

```jsonc
{
  "id":           "SALES-SO-2024-00341",      // "{source}-{originalId}"
  "source":       "SALES",                    // SALES | SERVICE
  "documentType": "Bill of Sale",             // normalized human-readable string
  "title":        "Bill of Sale — Toyota Camry 2023",
  "summary":      "Finance type: Retail · Sales: John Smith",  // ≤160 chars
  "documentUrl":  "https://...",              // signed/CDN URL — never the file bytes
  "date":         "2024-03-20T14:00:00Z",     // handoverDate (Sales) or completedDateTime (Service)
  "metadata": {
    // Sales extras:    financeType, salesPerson, salesOrderId
    // Service extras:  checkInMileage, laborItems, technicianId, repairOrderId
  },
  "isVisible":    true                        // false if hidden by user_document_config
}
```

---

## 5. Resilience & Pagination Strategy

### 5.1 Parallel Request Split — Configurable Ratio

The split of `pageSize` between the two downstream APIs is **not hardcoded**. It is resolved at request time through a two-level config lookup:

#### Resolution priority (highest wins)

| Priority | Source | Applies to |
|---|---|---|
| **1 — User override** | `user_document_config` row where `document_type IS NULL` and `split_ratio_override IS NOT NULL` | Per-user, per-source (e.g. a specific user always wants 70% from Sales) |
| **2 — Global default** | `api_config.split_ratio` for each source key | Applies to all users without a personal override |
| **3 — Hard fallback** | `0.5` | Used only if a source row is missing from `api_config` |

#### Algorithm

```
function resolveSplitRatios(userId, apiConfigs, userSourceConfigs):

  // 1. Try per-user override for SALES source
  userSalesRow = userSourceConfigs.find(
    c => c.source == 'SALES' && c.documentType == null && c.splitRatioOverride != null
  )

  if (userSalesRow):
    salesRatio   = userSalesRow.splitRatioOverride          // e.g. 0.7
    serviceRatio = 1.0 - salesRatio                         // e.g. 0.3
  else:
    // 2. Fall back to api_config per-source ratio
    rawSales   = apiConfigs['SALES'].splitRatio   ?? 0.5
    rawService = apiConfigs['SERVICE'].splitRatio ?? 0.5
    total      = rawSales + rawService
    salesRatio   = rawSales   / total              // normalize in case they don't sum to 1.0
    serviceRatio = rawService / total

  salesPageSize   = Math.round(pageSize * salesRatio)
  servicePageSize = pageSize - salesPageSize        // ensures exact sum == pageSize

  return { salesPageSize, servicePageSize }
```

#### Example — pageSize = 20

| Scenario | `api_config` SALES | `api_config` SERVICE | User override | Result |
|---|---|---|---|---|
| Equal split (default) | `split_ratio = 0.5` | `split_ratio = 0.5` | None | Sales=10, Service=10 |
| Sales-heavy global | `split_ratio = 0.7` | `split_ratio = 0.3` | None | Sales=14, Service=6 |
| User override | any | any | SALES `split_ratio_override = 0.6` | Sales=12, Service=8 |

Both run via `Promise.allSettled`. Results are merged and sorted by `date` descending.

### 5.2 Partial Success Handling

| Scenario | Immediate Action | Fallback Request? | Client Warning |
|---|---|---|---|
| Both succeed | Merge 10+10=20 docs, sort, return | None | None |
| Sales fails / times out | Use 10 Service docs; make an additional Service call at next-page offset for 10 more | Yes — Service API (offset shifted) | "Sales system is currently unavailable. Showing Service records only." |
| Service fails / times out | Use 10 Sales docs; make an additional Sales call at next-page offset for 10 more | Yes — Sales API (offset shifted) | "Service system is currently unavailable. Showing Sales records only." |
| Both fail | Return empty data array, HTTP 200 with warnings | None | "Both document sources are currently unavailable. Please try again later." |

### 5.3 Timeout & Circuit Breaker

- Each downstream request timeout: **5 000 ms** (configurable via `api_config` table)
- Circuit breaker per service: **CLOSED → OPEN → HALF_OPEN**
- Circuit breaker state exposed as Prometheus gauge metric `circuit_breaker_state{source}`

### 5.4 Date Normalization

| Source | Raw Date Field | Mapped to `date` | Sort Order |
|---|---|---|---|
| Sales API | `handoverDate` | `date` (ISO 8601) | Descending (newest first) |
| Service API | `completedDateTime` | `date` (ISO 8601) | Descending (newest first) |

### 5.5 User Document Visibility

Before sending the response, the Aggregate Service queries `user_document_config` for the authenticated user.  
Any document type flagged as hidden gets `isVisible: false`. Config is cached per user session.

---

## 6. Observability

Observability covers three pillars in this design: **structured logging** (who did what, with which VIN, and downstream outcomes), **metrics** (latency, errors, partial success, circuit breaker state), and **distributed tracing** (correlation ID end-to-end plus **OpenTelemetry** trace context via the Collector when that stack is deployed). Together they support performance analysis of the two downstream systems, auditing, and incident debugging.

### 6.1 Correlation ID Propagation

| Hop | Direction | Mechanism |
|---|---|---|
| Client → API Gateway | Outbound | Client generates UUID v4; Gateway injects if absent |
| API Gateway → Aggregate | Passthrough | `X-Correlation-ID` header forwarded as-is |
| Aggregate → Sales Mock API | Outbound | Same `X-Correlation-ID` propagated |
| Aggregate → Service Mock API | Outbound | Same `X-Correlation-ID` propagated |
| Aggregate → Kafka events | Embedded | `correlationId` field in event payload |
| Response → Client | Echoed | `correlationId` in response body + response header |

### 6.2 Middleware Logging (Structured JSON)

| Event | Level | Fields Captured |
|---|---|---|
| Incoming request | INFO | correlationId, userId, vin, filters, ip, userAgent, timestamp |
| Downstream request start | DEBUG | correlationId, target (SALES\|SERVICE), pageSize, startTs |
| Downstream request complete | INFO | correlationId, target, statusCode, latencyMs, docCount |
| Downstream timeout / error | WARN | correlationId, target, error, latencyMs, retryAttempt |
| Partial success triggered | WARN | correlationId, failedSource, fallbackDocsRequested |
| User config lookup | DEBUG | correlationId, userId, hiddenTypes |
| Response dispatched | INFO | correlationId, totalDocs, latencyMs, statusCode, warnings |

### 6.3 Prometheus Metrics

| Metric | Type | Labels | Purpose |
|---|---|---|---|
| `aggregate_request_duration_ms` | Histogram | status | End-to-end BFF latency (p50, p95, p99) |
| `downstream_request_duration_ms` | Histogram | source, status | Per-service latency — compare Sales vs Service |
| `downstream_error_total` | Counter | source, error_type | Count of timeouts, 4xx, 5xx per downstream |
| `partial_success_total` | Counter | failed_source | Tracks how often one source is degraded |
| `documents_returned_total` | Counter | source | Document volume per system over time |
| `circuit_breaker_state` | Gauge | source | 0 = CLOSED, 1 = OPEN, 2 = HALF_OPEN |

### 6.4 ELK Stack

- **Logstash** ingests structured JSON logs via Filebeat agents on each service
- **Elasticsearch** indexes by `correlationId`, `vin`, `userId`, `source`
- **Kibana** dashboards: audit trail (who searched which VIN, when) + debug trace (full request by correlationId)

---

## 7. Event Streaming

### 7.1 Kafka Topics

| Topic | Producer | Consumer(s) | Payload Fields |
|---|---|---|---|
| `document.search` | Aggregate Service | Search History Worker · Analytics jobs | correlationId, userId, vin, filters, timestamp, resultCount, sources |
| `document.view` | Aggregate Service (triggered by client click) | View History Worker · Analytics jobs | correlationId, userId, documentId, source, documentType, vin, timestamp |

> **Note:** Kafka publishing is async and happens after the HTTP response is sent. A publish failure is logged as WARN and never affects the client response.

### 7.2 Spark Background Jobs

> **Design only — not implemented.** The following jobs describe a planned **analytics** pipeline around Kafka events (usage metrics, audit-style reporting — not document recommendations, since VIN search is lookup-driven). They are **not** part of the delivered aggregate-service codebase unless explicitly built elsewhere.

| Job | Trigger | Output |
|---|---|---|
| Search History Persister | Streaming micro-batch | Writes search events to `search_history` table |
| View History Persister | Streaming micro-batch | Writes view events; tracks document engagement |
| Usage analytics rollup | Scheduled — hourly | Aggregates searches/views by document type, source, VIN patterns (where allowed), and dealership for dashboards |
| Popular documents report | Scheduled — daily | Top-N most-viewed documents per dealership (operational analytics) |

---

## 8. PostgreSQL Schema

### `search_history`
> Auditable log of every VIN search and document view.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | string | Authenticated user |
| vin | string(17) | Searched VIN |
| filters_json | JSONB | source, dateFrom, dateTo at time of search |
| result_count | integer | Total docs returned |
| searched_at | timestamptz | |
| correlation_id | UUID | Links to distributed trace |

### `document_metadata_cache`
> Short-lived metadata cache to speed up repeat searches for the same VIN.

| Column | Type | Notes |
|---|---|---|
| vin | string(17) | |
| source | enum | SALES \| SERVICE |
| document_id | string | originalId from source system |
| metadata_json | JSONB | Cached unified document object |
| cached_at | timestamptz | |
| expires_at | timestamptz | TTL-based invalidation |

### `user_document_config`
> Per-user visibility toggles and per-user pagination split overrides.  
> A row with `document_type IS NULL` is a **source-level preference** row (used for split ratio); a row with a non-null `document_type` is a **visibility rule** row. Both can coexist for the same user.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | string | Authenticated user |
| document_type | string **NULLABLE** | Non-null = visibility rule (e.g. "BILL_OF_SALE"). **Null = source-level preference row.** |
| source | enum | SALES \| SERVICE |
| is_hidden | boolean NULLABLE | Applies only when `document_type IS NOT NULL`. true = hide this doc type from the list. |
| split_ratio_override | float NULLABLE | **Applies only when `document_type IS NULL`. When set, overrides `api_config.split_ratio` for this source for this user (0.0–1.0). Takes priority over global config.** |
| updated_at | timestamptz | |

**Unique index:** `(user_id, source, COALESCE(document_type, ''))` — allows one split-ratio row (null document_type) and one row per document type per source per user.

### `api_config`
> Downstream API endpoint registry — base URLs, timeouts, auth credentials, and global split ratio.

| Column | Type | Notes |
|---|---|---|
| key | string PK | "SALES" \| "SERVICE" |
| base_url | string | Mock API base URL |
| timeout_ms | integer | Default 5000 |
| is_active | boolean | Circuit breaker override |
| split_ratio | float | **Fraction of pageSize allocated to this source (0.0–1.0). Default 0.5. Normalized against the other source at runtime if the two values do not sum to 1.0.** |
| auth_config_json | JSONB | OAuth client_id, client_secret, token_url |
| updated_at | timestamptz | |

---

## 9. Front-End Behaviour Notes

- Document list shows: **title**, **short summary**, **source badge** (SALES / SERVICE), **date**
- Clicking a document calls `GET /api/v1/documents/:documentId/url` → renders PDF inline via CDN URL
- Filter controls: **Source** (All / Sales / Service), **Date range** (dateFrom, dateTo)
- If `warnings` array is non-empty, display a banner above the list ("Sales system unavailable…")
- Documents with `isVisible: false` are filtered out client-side before rendering

---

## 10. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Aggregation pattern | BFF (Backend-for-Frontend) | Tailors the API contract to the specific UI needs; hides downstream complexity |
| Parallel requests | `Promise.allSettled` | Never throws on partial failure; allows one API to succeed independently |
| Pagination split | Configurable ratio via `api_config.split_ratio`; per-user override via `user_document_config.split_ratio_override` | Avoids hardcoding; supports skewing toward the richer source for specific users or globally |
| Partial failure fallback | Additional request to working source | Keeps page full even with one source down |
| Document storage | Object Storage + CDN URLs | APIs return URLs not bytes; keeps bandwidth off the BFF |
| Sort field normalization | Map to common `date` field | Single sort key regardless of source schema |
| User config | PostgreSQL per-user table | Simple, persistent, admin-editable visibility rules |
| Event publishing | Kafka (fire-and-forget) | Decouples analytics from critical request path |
| Observability | OpenTelemetry + Grafana + ELK (target) | Industry-standard; separates metrics (Grafana) from logs (ELK) cleanly |

---

## 11. GenAI assistance in the design phase

Generative AI (Cursor’s assistant) was used as a **design partner** during early architecture work: refining requirements into diagrams and tables, and iterating when constraints changed. The following **user prompts** (exact wording from the design conversation) drove that collaboration.

**Initial backend-focused design brief**

> @/Users/nhatnguyen/Downloads/trash_files/keyloop.pdf @keyloop-scenario5-deepresearch.txt Help me generate system design doc with a architecture diagram. This system design is focused on backend development. Not implement code at this time.  
> Dependencies like Redis, PostgreSQL, Redis Queue should be abstracted to an interface so we can switch to another similar technologies. 
> 2 mocked APIs that the aggregate service will call, 1 of Sales system API, and 1 of Service System API.  
> - The aggregate service is the main backend service of this implementation.  
> - Aggregate service will expose a API to search documents by VIN, and support pagination.  
> - The handle will make 2 parallel requests to 2 mocked services and each service responses with half of original pagination.  
> - If a service failed to response, we will allow partial success and make additional request to the working service to fetch a remaining half of documents.  
> - The document will be stored in a object storage or CDN.  
> - These services will return the documents urls not the document itself.  
> - Return some message to notify the client if 1 of the mocked service is down.  
> - The response data from 2 mocked service should based on your research and may be different with each other.  
> - The aggregate service will synthesize these responses to a unified schema and return to the front-end to render a unified document viewer with a list of documents.  
> - In the front-end, we can view a list of documents with its title, a short summary, source. And if the user clicks on an item, it will render a document from the object storage/CDN.  
> - The response data from mocked services should be order by recent date as default. The aggregate service will re-order by date and send back to client-side with datetime.  
> - Each request/response should include a correlation id for ditributed tracing and monitoring.  
> - About oservibility, we should add logging to middleware, perfomance of requests. These metrics will be collected by OpenTelemetry and shown by grafana of monitoring.  
> - The log can be collected to a centralized logging using ELK stack.  
> - The goal of observability is to check performance of 2 mocked services, auditing and debugging.  
> - Each search event or view document event from client-side will be pushed to a kafka broker. These events will be stored as user search history and consumed by some background workers like Spark jobs for **analytics** (usage reporting, not personalized recommendations). This component is not mandatory and is not the main feature of our aggregation service.  
> - Client-side can make requests including filter about Source Tagging, Date range.  
> - We have a persitent DB to store user configuration for hiding or showing specific document data for some specific users.  
> - In the @keyloop-scenario5-deepresearch.txt Persistence and the Database Layer includes Search History and Auditing, Document Metadata Caching, API Configuration.

**Hand-off to another agent**

> help save this for me to import to another agent to start building.

**Design change — configurable pagination split (still reflected throughout this document)**

> Pagination split strategy (each mock API gets pageSize/2)  
> Don't hardcode this split, add this config to user_document_config, and api_config, with user_document_config is prioritized.  
> Modify the design.

**How GenAI was used (summary)**

- Turned the initial brief into a structured design (diagrams, component tables, API and schema drafts) without implementing application code in that phase.  
- Updated the written design when pagination split moved from a fixed 50/50 rule to **`api_config.split_ratio`** and **`user_document_config`** (with user overrides prioritized), matching the resolution logic described in **§5.1** and the PostgreSQL sections.  
- Produced an exportable **`system-design.md`** so the same plan could be reused by humans and other agents.
