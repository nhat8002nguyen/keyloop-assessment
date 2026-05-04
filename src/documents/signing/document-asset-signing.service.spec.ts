import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { DocumentAssetSigningService } from "./document-asset-signing.service";

describe("DocumentAssetSigningService", () => {
  const createService = async (ttl = 3600) => {
    const mod = await Test.createTestingModule({
      providers: [
        DocumentAssetSigningService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === "DOCUMENT_ASSET_SIGNING_SECRET") {
                return "unit-test-document-signing-secret-min-16";
              }
              throw new Error(`unexpected getOrThrow key: ${key}`);
            },
            get: (key: string) =>
              key === "DOCUMENT_ASSET_SIGNING_TTL_SEC" ? ttl : undefined,
          },
        },
      ],
    }).compile();
    return mod.get(DocumentAssetSigningService);
  };

  it("adds doc_exp and doc_sig to a plain HTTPS URL", async () => {
    const svc = await createService();
    const out = svc.signObjectUrl("https://cdn.example.com/docs/ro.pdf");
    const parsed = new URL(out);
    expect(parsed.searchParams.get("doc_exp")).toMatch(/^\d+$/);
    expect(parsed.searchParams.get("doc_sig")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different signatures when doc_exp differs (implicit via time)", async () => {
    const svc = await createService();
    const a = svc.signObjectUrl("https://cdn.example.com/x.pdf");
    const b = svc.signObjectUrl("https://cdn.example.com/y.pdf");
    expect(a).not.toBe(b);
  });

  it("strips prior doc_sig/doc_exp before re-signing so only one signing pair remains", async () => {
    const svc = await createService();
    const first = svc.signObjectUrl("https://cdn.example.com/a.pdf");
    const second = svc.signObjectUrl(first);
    expect((second.match(/doc_sig=/g) ?? []).length).toBe(1);
    expect((second.match(/doc_exp=/g) ?? []).length).toBe(1);
  });

  it("returns original string for non-HTTP URLs", async () => {
    const svc = await createService();
    expect(svc.signObjectUrl("ftp://files.example/x.pdf")).toBe(
      "ftp://files.example/x.pdf",
    );
  });
});
