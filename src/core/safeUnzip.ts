import { unzipSync, type Unzipped } from "fflate";

export const MAX_ZIP_COMPRESSED_BYTES = 25 * 1024 * 1024; // 25 MiB
export const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024; // 100 MiB
export const MAX_ZIP_SINGLE_ENTRY_BYTES = 35 * 1024 * 1024; // 35 MiB
export const MAX_ZIP_ENTRIES = 2500;
export const MAX_ZIP_COMPRESSION_RATIO = 120;

export interface SafeUnzipLimits {
  maxCompressedBytes?: number;
  maxTotalUncompressedBytes?: number;
  maxSingleEntryBytes?: number;
  maxEntries?: number;
  maxCompressionRatio?: number;
}

function isUnsafeZipEntryName(name: string): boolean {
  if (!name || name.includes("\0")) return true;
  if (name.startsWith("/") || name.startsWith("\\") || /^[a-zA-Z]:/.test(name)) {
    return true;
  }
  const normalized = name.replace(/\\/g, "/");
  return normalized.split("/").some((seg) => seg === "..");
}

/**
 * Safely unpacks an HWPX/ZIP byte buffer while enforcing compressed size,
 * entry count, single-entry size, total uncompressed size, compression ratio,
 * and path-traversal checks both before and after decompression.
 */
export function safeUnzipBytes(
  zipBytes: Uint8Array,
  label = "hwpx",
  limits: SafeUnzipLimits = {}
): Unzipped {
  const maxCompressed = limits.maxCompressedBytes ?? MAX_ZIP_COMPRESSED_BYTES;
  const maxTotal = limits.maxTotalUncompressedBytes ?? MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES;
  const maxSingle = limits.maxSingleEntryBytes ?? MAX_ZIP_SINGLE_ENTRY_BYTES;
  const maxEntries = limits.maxEntries ?? MAX_ZIP_ENTRIES;
  const maxRatio = limits.maxCompressionRatio ?? MAX_ZIP_COMPRESSION_RATIO;

  if (!(zipBytes instanceof Uint8Array) || zipBytes.byteLength < 4) {
    throw new Error(`[Security] ${label}: 유효한 ZIP/HWPX 바이트 데이터가 아닙니다.`);
  }
  if (
    zipBytes[0] !== 0x50 ||
    zipBytes[1] !== 0x4b ||
    (zipBytes[2] !== 0x03 && zipBytes[2] !== 0x05 && zipBytes[2] !== 0x07)
  ) {
    throw new Error(`[Security] ${label}: ZIP 시그니처(PK)가 올바르지 않습니다.`);
  }
  if (zipBytes.byteLength > maxCompressed) {
    throw new Error(
      `[Security] ${label}: 압축 파일 크기 한도(${Math.round(maxCompressed / (1024 * 1024))}MB)를 초과했습니다.`
    );
  }

  let entryCount = 0;
  let declaredTotal = 0;

  const unzipped = unzipSync(zipBytes, {
    filter(file) {
      entryCount += 1;
      if (entryCount > maxEntries) {
        throw new Error(
          `[Security] ${label}: 압축 엔트리 수 한도(${maxEntries}개)를 초과했습니다.`
        );
      }
      if (isUnsafeZipEntryName(file.name)) {
        throw new Error(
          `[Security] ${label}: 허용되지 않은 ZIP 경로 엔트리가 감지되었습니다 (${file.name}).`
        );
      }
      const origSize = file.originalSize || 0;
      const compSize = Math.max(1, file.size || 1);
      if (origSize > maxSingle) {
        throw new Error(
          `[Security] ${label}: 단일 엔트리 크기 한도를 초과했습니다 (${file.name}).`
        );
      }
      if (origSize > 1024 * 1024 && origSize / compSize > maxRatio) {
        throw new Error(
          `[Security] ${label}: 비정상 압축률(ZIP 폭탄 의심)이 감지되었습니다 (${file.name}).`
        );
      }
      declaredTotal += origSize;
      if (declaredTotal > maxTotal) {
        throw new Error(
          `[Security] ${label}: 총 압축 해제 용량 한도(${Math.round(maxTotal / (1024 * 1024))}MB)를 초과했습니다.`
        );
      }
      return true;
    },
  });

  // Post-decompression actual byte verification (defense against spoofed headers)
  let actualTotal = 0;
  const keys = Object.keys(unzipped);
  if (keys.length > maxEntries) {
    throw new Error(
      `[Security] ${label}: 실제 압축 해제 엔트리 수가 한도(${maxEntries}개)를 초과했습니다.`
    );
  }
  for (const name of keys) {
    const entryBytes = unzipped[name];
    if (entryBytes.byteLength > maxSingle) {
      throw new Error(
        `[Security] ${label}: 실제 해제된 단일 엔트리 크기가 한도를 초과했습니다 (${name}).`
      );
    }
    actualTotal += entryBytes.byteLength;
    if (actualTotal > maxTotal) {
      throw new Error(
        `[Security] ${label}: 실제 총 압축 해제 용량이 한도를 초과했습니다.`
      );
    }
  }
  if (actualTotal > 1024 * 1024 && actualTotal / Math.max(1, zipBytes.byteLength) > maxRatio) {
    throw new Error(
      `[Security] ${label}: 전체 압축 해제 비율이 안전 한도(${maxRatio}배)를 초과했습니다.`
    );
  }

  return unzipped;
}
