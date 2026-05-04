import express, { type Express } from "express";
import type { Request, Response } from "express";
import { SERVICE_DOCUMENTS_BY_VIN } from "./data/service-fixtures";
import { DEFAULT_MOCK_VIN } from "../shared/default-mock-vin";
import { selectDocumentsForVin } from "../shared/documents-for-vin";

const app: Express = express();
const PORT = Number(process.env.SERVICE_MOCK_PORT) || 3002;

app.use(express.json());

app.get("/documents", (req: Request, res: Response) => {
  if (req.headers["x-force-error"] === "true") {
    res.status(500).json({ error: "Forced error for testing" });
    return;
  }

  if (req.headers["x-force-timeout"] === "true") {
    setTimeout(() => {
      res.status(504).json({ error: "Forced timeout for testing" });
    }, 10000);
    return;
  }

  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 10;
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;

  let docs = selectDocumentsForVin(
    SERVICE_DOCUMENTS_BY_VIN,
    req.query.vin,
    DEFAULT_MOCK_VIN,
  );

  if (dateFrom) {
    const from = new Date(dateFrom).getTime();
    docs = docs.filter((d) => new Date(d.completedDateTime).getTime() >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo).getTime();
    docs = docs.filter((d) => new Date(d.completedDateTime).getTime() <= to);
  }

  const total = docs.length;
  const offset = (page - 1) * pageSize;
  const paginated = docs.slice(offset, offset + pageSize);

  res.json({
    documents: paginated,
    total,
    page,
    pageSize,
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "UP" });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Service Mock API listening on port ${PORT}`);
  });
}

export { app, app as serviceMockApp };
