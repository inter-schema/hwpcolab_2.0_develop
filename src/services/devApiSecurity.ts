import path from "node:path";
import fs from "node:fs";

export interface DevApiRequestHeaders {
  host?: string;
  origin?: string;
  referer?: string;
  "sec-fetch-site"?: string;
}

export interface DevApiAuthDecision {
  allowed: boolean;
  reason?: string;
}

export type SafeStaticPathResult =
  | { ok: true; filePath: string }
  | { ok: false; status: 400 | 403 | 404; reason: string };

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Extracts normalized lowercase hostname (without port) from a Host header or URL.
 */
export function extractHostname(hostHeaderOrUrl: string): string {
  const raw = String(hostHeaderOrUrl || "").trim();
  if (!raw) return "";
  try {
    const asUrl = raw.includes("://") ? new URL(raw) : new URL(`http://${raw}`);
    return asUrl.hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  const norm = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return LOOPBACK_HOSTNAMES.has(norm) || norm === "::1";
}

function isTrustedPreviewHostname(hostname: string): boolean {
  const norm = hostname.toLowerCase();
  return norm.endsWith(".run.app") || norm.endsWith(".aistudio.google.com");
}

/**
 * Validates that a Vite dev API request originates from a trusted local/same-origin UI
 * and blocks cross-site CSRF or unauthenticated LAN access.
 */
export function isAllowedDevApiRequest(
  headers: DevApiRequestHeaders,
  options?: {
    allowRemoteDev?: boolean;
    extraAllowedHosts?: string[];
  }
): DevApiAuthDecision {
  const allowRemote = Boolean(options?.allowRemoteDev);
  const extraHosts = new Set(
    (options?.extraAllowedHosts || []).map((h) => extractHostname(h)).filter(Boolean)
  );

  const secFetchSite = String(headers["sec-fetch-site"] || "").trim().toLowerCase();
  if (secFetchSite === "cross-site") {
    return { allowed: false, reason: "Cross-site request rejected (Sec-Fetch-Site: cross-site)" };
  }

  const hostRaw = String(headers.host || "").trim();
  const hostName = extractHostname(hostRaw);
  if (!hostName) {
    return { allowed: false, reason: "Missing or invalid Host header" };
  }

  const hostTrusted =
    allowRemote ||
    isLoopbackHostname(hostName) ||
    isTrustedPreviewHostname(hostName) ||
    extraHosts.has(hostName);

  if (!hostTrusted) {
    return {
      allowed: false,
      reason: `Untrusted Host header rejected: ${hostName}`,
    };
  }

  const originRaw = String(headers.origin || "").trim();
  if (originRaw) {
    if (originRaw.toLowerCase() === "null") {
      return { allowed: false, reason: "Null Origin header rejected" };
    }
    const originHost = extractHostname(originRaw);
    if (!originHost) {
      return { allowed: false, reason: "Malformed Origin header rejected" };
    }
    const bothLoopback = isLoopbackHostname(originHost) && isLoopbackHostname(hostName);
    if (originHost !== hostName && !bothLoopback) {
      return {
        allowed: false,
        reason: `Origin mismatch rejected (${originHost} !== ${hostName})`,
      };
    }
  }

  const refererRaw = String(headers.referer || "").trim();
  if (!originRaw && refererRaw) {
    const refererHost = extractHostname(refererRaw);
    if (refererHost) {
      const bothLoopback = isLoopbackHostname(refererHost) && isLoopbackHostname(hostName);
      if (refererHost !== hostName && !bothLoopback) {
        return {
          allowed: false,
          reason: `Referer mismatch rejected (${refererHost} !== ${hostName})`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Resolves a static asset URL path under `rootDir` while strictly preventing:
 * - malformed percent-encoding and double-encoded traversal (%252e%252e)
 * - path traversal segments (..)
 * - backslashes, Windows drive letters, UNC paths, and null bytes
 * - symlink escapes outside `rootDir`
 */
export function resolveSafeStaticFile(
  rootDir: string,
  rawSubPath: string
): SafeStaticPathResult {
  const withoutQuery = String(rawSubPath || "").split("?")[0].split("#")[0];
  if (!withoutQuery || withoutQuery.includes("\0")) {
    return { ok: false, status: 400, reason: "Empty or null-byte path rejected" };
  }

  // Reject encoded null bytes or double-encoded traversal before decoding
  if (/%00|%25|%5c/i.test(withoutQuery)) {
    return { ok: false, status: 403, reason: "Suspicious percent-encoding rejected" };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return { ok: false, status: 400, reason: "Malformed percent-encoding rejected" };
  }

  // Reject if a second decode would still change traversal or separator tokens
  if (/%2e|%2f|%5c|%00/i.test(decoded)) {
    return { ok: false, status: 403, reason: "Double-encoded path sequence rejected" };
  }

  if (
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    decoded.startsWith("/") ||
    /^[a-zA-Z]:/.test(decoded) ||
    decoded.startsWith("//")
  ) {
    return { ok: false, status: 403, reason: "Absolute, UNC, backslash, or drive path rejected" };
  }

  const segments = decoded.split("/").filter((s) => s.length > 0);
  if (segments.length === 0 || segments.some((seg) => seg === "." || seg === "..")) {
    return { ok: false, status: 403, reason: "Path traversal segment rejected" };
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(rootDir);
  } catch {
    return { ok: false, status: 404, reason: "Static root directory unavailable" };
  }

  const candidate = path.resolve(realRoot, ...segments);
  const relFromRoot = path.relative(realRoot, candidate);
  if (
    !relFromRoot ||
    relFromRoot.startsWith("..") ||
    path.isAbsolute(relFromRoot)
  ) {
    return { ok: false, status: 403, reason: "Resolved path escapes static root" };
  }

  if (!fs.existsSync(candidate)) {
    return { ok: false, status: 404, reason: "File not found" };
  }

  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync(candidate);
  } catch {
    return { ok: false, status: 404, reason: "Unable to resolve file realpath" };
  }

  const realRel = path.relative(realRoot, realCandidate);
  if (
    !realRel ||
    realRel.startsWith("..") ||
    path.isAbsolute(realRel)
  ) {
    return { ok: false, status: 403, reason: "Symlink target escapes static root" };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(realCandidate);
  } catch {
    return { ok: false, status: 404, reason: "Unable to stat file" };
  }

  if (!stat.isFile()) {
    return { ok: false, status: 403, reason: "Target is not a regular file" };
  }

  return { ok: true, filePath: realCandidate };
}
