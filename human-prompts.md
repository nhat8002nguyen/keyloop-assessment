1. 
System Design Doc for Unified Document Viewer
@/Users/nhatnguyen/Downloads/trash_files/keyloop.pdf @keyloop-scenario5-deepresearch.txt Help me generate system design doc with a architecture diagram. This system design is focused on backend development. Not implement code at this time. 
2 mocked APIs that the aggregate service will call, 1 of Sales system API, and 1 of Service System API. 
- The aggregate service is the main backend service of this implementation.
- Aggregate service will expose a API to search documents by VIN, and support pagination. 
- The handle will make 2 parallel requests to 2 mocked services and each service responses with configurable ratio of original pagination. 
- If a service failed to response, we will allow partial success and make additional request to the working service to fetch a half number of document metadata. 
- The document will be stored in a object storage or CDN.
- These services will return the documents urls not the document itself.
- Return some message to notify the client if 1 of the mocked service is down.
- The response data from 2 mocked service should based on your research and may be different with each other.
- The aggregate service will synthesize these responses to a unified schema and return to the front-end to render a unified document viewer with a list of documents. 
- In the front-end, we can view a list of documents with its title, a short summary, source. And if the user clicks on an item, it will render a document from the object storage/CDN.
- The response data from mocked services should be order by recent date as default. The aggregate service will re-order by date and send back to client-side with datetime. 
- Each request/response should include a correlation id for ditributed tracing and monitoring.
- About oservibility, we should add logging to middleware, perfomance of requests. These metrics will be collected by OpenTelemetry and shown by grafana of monitoring. 
- The log can be collected to a centralized logging using ELK stack.
- The goal of observability is to check performance of 2 mocked services, auditing and debugging.
- Each search event or view document event from client-side will be pushed to a kafka broker. These events will be stored as user search history and consumed by some backgroud workers like spark jobs to generate recommendation for users. This component is not mandatory and is not the main feature of out aggregation service. 
- Client-side can make requests including filter about Source Tagging, Date range.
- We have a persitent DB to store user configuration for hiding or showing specific document data for some specific users.
- In the @keyloop-scenario5-deepresearch.txt Persistence and the Database Layer includes Search History and Auditing, Document Metadata Caching, API Configuration.
---------------------------------

2.
@system-design.md start building for aggregation service with mock response from 2 external services for testing.
@unified-document-service is template codebase of a nest.js micro-service to follow. 
- First generate necessary modules, services, controllers, and entities skeleton files.
- Generate a test suites to satify all logic in the design docs for me to review.
- After I review and approve the test suites, build the service. 
- this demo is built with all components sitting in a single machine: redis, database, kafka,... The config module should allow us to points these dependencies to external managed distributed db, cache, or message queues. 
---------------------------------

3. 
- the circuit breaker should be implemented as a interceptor in the common/interceptors/
- @unified-document-service/src/cache includes setup about cache service and redis, so should not generate a redis folder. Kafka should be a concrete implementation of an abstract layer message queue, so we can switch to another similar queue type like redis queue. 