import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const certDir = join(dirname(fileURLToPath(import.meta.url)), "..", "certs");

export function loadCerts(): { key: Buffer; cert: Buffer } | null {
  const keyPath = join(certDir, "key.pem");
  const certPath = join(certDir, "cert.pem");
  if (!existsSync(keyPath) || !existsSync(certPath)) return null;
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}
