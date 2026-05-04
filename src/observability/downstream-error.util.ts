import axios from "axios";

export function classifyDownstreamError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (
      err.code === "ECONNABORTED" ||
      err.message.toLowerCase().includes("timeout")
    ) {
      return "timeout";
    }
    const status = err.response?.status;
    if (status !== undefined && status >= 400 && status < 500) {
      return "http_4xx";
    }
    if (status !== undefined && status >= 500) {
      return "http_5xx";
    }
  }
  return "unknown";
}
