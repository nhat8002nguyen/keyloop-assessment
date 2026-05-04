import { createHmac } from "crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Query params appended to CDN / object-storage URLs (edge validates same HMAC + expiry). */
const EXP_PARAM = "doc_exp";
const SIG_PARAM = "doc_sig";

@Injectable()
export class DocumentAssetSigningService {
  private readonly secretBuffer: Buffer;
  private readonly ttlSeconds: number;

  constructor(private readonly config: ConfigService) {
    const secret = this.config.getOrThrow<string>(
      "DOCUMENT_ASSET_SIGNING_SECRET",
    );
    this.secretBuffer = Buffer.from(secret, "utf8");
    this.ttlSeconds =
      this.config.get<number>("DOCUMENT_ASSET_SIGNING_TTL_SEC") ?? 3600;
  }

  /**
   * Appends tamper-evident expiry + HMAC signature to an object URL.
   * Strips any existing doc_exp/doc_sig pair first so callers can safely re-sign.
   */
  signObjectUrl(originalUrl: string): string {
    const trimmed = originalUrl.trim();
    if (trimmed.length === 0) {
      return originalUrl;
    }
    try {
      const base = new URL(trimmed);
      if (base.protocol !== "http:" && base.protocol !== "https:") {
        return originalUrl;
      }

      base.searchParams.delete(SIG_PARAM);
      base.searchParams.delete(EXP_PARAM);

      const canonicalResource = this.canonicalResource(base);
      const exp = Math.floor(Date.now() / 1000) + this.ttlSeconds;
      const signature = createHmac("sha256", this.secretBuffer)
        .update(`${canonicalResource}|${exp}`)
        .digest("hex");

      base.searchParams.set(EXP_PARAM, String(exp));
      base.searchParams.set(SIG_PARAM, signature);
      return base.toString();
    } catch {
      return originalUrl;
    }
  }

  /** Resource string: origin + pathname + sorted query (excluding signing params — already stripped). */
  private canonicalResource(u: URL): string {
    const keys = [...u.searchParams.keys()].sort();
    if (keys.length === 0) {
      return `${u.origin}${u.pathname}`;
    }
    const qs = keys
      .map((key) => {
        const raw = u.searchParams.get(key);
        return `${encodeURIComponent(key)}=${encodeURIComponent(raw ?? "")}`;
      })
      .join("&");
    return `${u.origin}${u.pathname}?${qs}`;
  }
}
