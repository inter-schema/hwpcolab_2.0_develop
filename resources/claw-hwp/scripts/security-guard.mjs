/**
 * HOP-Claw Shared Security Guard for Node CLI & HWPX Engine Scripts
 * License: GNU General Public License v3.0 or later (GPL-3.0-or-later)
 *
 * Enforces:
 * 1. Safe ZIP decompression limits (25 MiB compressed, 100 MiB total uncompressed,
 *    35 MiB single entry, 2,500 entries, 120x max compression ratio, no path traversal)
 *    both before and after decompression.
 * 2. Unified HWPX document editing policy guard (G2 excluded regions, G4 existing-doc
 *    setup_document guard, nested table depth/size limits, table coordinate bounds).
 */

import { unzipSync, strFromU8 } from "./vendor/fflate/index.mjs";

export const MAX_ZIP_COMPRESSED_BYTES = 25 * 1024 * 1024;
export const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_SINGLE_ENTRY_BYTES = 35 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 2500;
export const MAX_ZIP_COMPRESSION_RATIO = 120;

function isUnsafeZipEntryName(name) {
  if (!name || name.includes("\0")) return true;
  if (name.startsWith("/") || name.startsWith("\\") || /^[a-zA-Z]:/.test(name)) {
    return true;
  }
  const normalized = name.replace(/\\/g, "/");
  return normalized.split("/").some((seg) => seg === "..");
}

/**
 * Safely unzips HWPX/ZIP bytes while enforcing resource & traversal limits.
 */
export function safeUnzipHwpxBytes(rawBytes, label = "hwpx", limits = {}) {
  const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
  const maxCompressed = limits.maxCompressedBytes ?? MAX_ZIP_COMPRESSED_BYTES;
  const maxTotal = limits.maxTotalUncompressedBytes ?? MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES;
  const maxSingle = limits.maxSingleEntryBytes ?? MAX_ZIP_SINGLE_ENTRY_BYTES;
  const maxEntries = limits.maxEntries ?? MAX_ZIP_ENTRIES;
  const maxRatio = limits.maxCompressionRatio ?? MAX_ZIP_COMPRESSION_RATIO;

  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`[Security] ${label}: 유효한 ZIP/HWPX 시그니처가 아닙니다.`);
  }
  if (bytes.byteLength > maxCompressed) {
    throw new Error(
      `[Security] ${label}: 압축 파일 크기 한도(${Math.round(maxCompressed / (1024 * 1024))}MB)를 초과했습니다.`
    );
  }

  let entryCount = 0;
  let declaredTotal = 0;

  const unzipped = unzipSync(bytes, {
    filter(file) {
      entryCount += 1;
      if (entryCount > maxEntries) {
        throw new Error(
          `[Security] ${label}: 압축 엔트리 개수 한도(${maxEntries}개)를 초과했습니다.`
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

  // Post-decompression actual byte verification (prevents spoofed central-directory sizes)
  let actualTotal = 0;
  const names = Object.keys(unzipped);
  if (names.length > maxEntries) {
    throw new Error(
      `[Security] ${label}: 실제 압축 해제 엔트리 수가 한도(${maxEntries}개)를 초과했습니다.`
    );
  }
  for (const name of names) {
    const entryBuf = unzipped[name];
    if (entryBuf.byteLength > maxSingle) {
      throw new Error(
        `[Security] ${label}: 실제 해제된 단일 엔트리 크기가 한도를 초과했습니다 (${name}).`
      );
    }
    actualTotal += entryBuf.byteLength;
    if (actualTotal > maxTotal) {
      throw new Error(
        `[Security] ${label}: 실제 총 압축 해제 용량이 한도를 초과했습니다.`
      );
    }
  }
  if (actualTotal > 1024 * 1024 && actualTotal / Math.max(1, bytes.byteLength) > maxRatio) {
    throw new Error(
      `[Security] ${label}: 전체 압축 해제 비율이 안전 한도(${maxRatio}배)를 초과했습니다.`
    );
  }

  return unzipped;
}

function scanTopLevelSimple(xml, tag) {
  const t = tag.replace(/:/g, "\\:");
  const re = new RegExp(`<${t}((?:\\s[^>]*?)?)(/?)>|</${t}\\s*>`, "g");
  const out = [];
  let depth = 0;
  let start = -1;
  let openEnd = -1;
  let attrs = "";
  let m;
  while ((m = re.exec(xml)) !== null) {
    const isClose = m[0].startsWith("</");
    if (!isClose && m[2] === "/") {
      if (depth === 0) {
        out.push({ start: m.index, end: re.lastIndex, openEnd: re.lastIndex, attrs: m[1] || "", inner: "" });
      }
      continue;
    }
    if (!isClose) {
      if (depth === 0) {
        start = m.index;
        openEnd = re.lastIndex;
        attrs = m[1] || "";
      }
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) {
        out.push({ start, end: re.lastIndex, openEnd, attrs, inner: xml.slice(openEnd, m.index) });
      }
    }
  }
  return out;
}

/**
 * Extracts table hierarchy metadata (pre-order tableIndex, depth, rowCount, colCount)
 * directly from unzipped HWPX files so policy validation cannot be bypassed even when
 * callers omit `tablesMeta`.
 */
export function extractTablesMetaFromUnzipped(unzippedFiles) {
  const sectionFiles = Object.keys(unzippedFiles)
    .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const ma = a.match(/section(\d+)\.xml/i);
      const mb = b.match(/section(\d+)\.xml/i);
      return (ma ? parseInt(ma[1], 10) : 0) - (mb ? parseInt(mb[1], 10) : 0);
    });

  const tables = [];

  function walk(fragment, secIdx, depth, parentTableIndex) {
    const tblList = scanTopLevelSimple(fragment, "hp:tbl");
    for (const tbl of tblList) {
      const tableIndex = tables.length;
      const trList = scanTopLevelSimple(tbl.inner, "hp:tr");
      let maxRow = 0;
      let maxCol = 0;
      for (let ri = 0; ri < trList.length; ri++) {
        const tcList = scanTopLevelSimple(trList[ri].inner, "hp:tc");
        for (let ci = 0; ci < tcList.length; ci++) {
          const tc = tcList[ci];
          const subEnd = tc.inner.lastIndexOf("</hp:subList>");
          const directInner = subEnd >= 0 ? tc.inner.slice(subEnd) : tc.inner;
          const am = directInner.match(
            /<hp:cellAddr [^>]*colAddr="(\d+)"[^>]*rowAddr="(\d+)"|<hp:cellAddr [^>]*rowAddr="(\d+)"[^>]*colAddr="(\d+)"/
          );
          const col = am ? (am[1] !== undefined ? Number(am[1]) : Number(am[4])) : ci;
          const row = am ? (am[2] !== undefined ? Number(am[2]) : Number(am[3])) : ri;
          const sm = directInner.match(/<hp:cellSpan [^>]*colSpan="(\d+)"[^>]*rowSpan="(\d+)"/);
          const colSpan = sm ? Number(sm[1]) : 1;
          const rowSpan = sm ? Number(sm[2]) : 1;
          maxRow = Math.max(maxRow, row + rowSpan);
          maxCol = Math.max(maxCol, col + colSpan);
        }
      }
      if (maxRow === 0) maxRow = trList.length;

      tables.push({
        tableIndex,
        sec: secIdx,
        depth,
        parentTableIndex,
        rowCount: maxRow,
        colCount: maxCol,
      });

      const childTbls = scanTopLevelSimple(tbl.inner, "hp:tbl");
      for (const child of childTbls) {
        walk(tbl.inner.slice(child.start, child.end), secIdx, depth + 1, tableIndex);
      }
    }
  }

  for (let secIdx = 0; secIdx < sectionFiles.length; secIdx++) {
    const xml = strFromU8(unzippedFiles[sectionFiles[secIdx]]);
    walk(xml, secIdx, 0, undefined);
  }
  return tables;
}

const CELL_TARGET_OPS = new Set([
  "set_cell_text",
  "cell_ByCoord",
  "insert_nested_table",
  "set_cell_align",
  "set_cell_background",
  "set_cell_border",
  "set_cell_diagonal",
  "set_cell_size",
  "set_cell_margin",
  "set_title_cell",
  "set_cell_image",
  "set_cell_shape",
  "set_cell_chart",
  "set_cell_equation",
  "split_cell",
]);

/**
 * Authoritative engine-level document editing Policy Guard.
 * Runs before any operation mutates the HWPX XML so neither CLI wrappers nor
 * direct engine invocations can bypass document safety rules.
 */
export function validateHwpxOperations(ops, tablesMeta = [], policyContext = {}) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(ops)) {
    return { valid: false, errors: ["편집 연산 배열(operations)이 유효하지 않습니다."], warnings };
  }

  const isNewDocument = Boolean(policyContext.isNewDocument);
  const isHwpx = policyContext.isHwpx !== false;
  const excludedRegions = Array.isArray(policyContext.excludedRegions)
    ? policyContext.excludedRegions
    : [];

  const excludedCellKeys = new Set(
    excludedRegions
      .filter((r) => r && r.targetType === "cell")
      .map((r) => `${Number(r.tableIndex)}:${Number(r.row)}:${Number(r.col)}`)
  );

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!op || typeof op !== "object") {
      errors.push(`연산 #${i}: 유효한 객체가 아닙니다.`);
      continue;
    }
    const kind = op.type || op.op;
    if (!kind || typeof kind !== "string") {
      errors.push(`연산 #${i}: 연산 타입(type/op)이 누락되었습니다.`);
      continue;
    }

    // G4: Block setup_document on existing documents
    if (kind === "setup_document" && !isNewDocument) {
      errors.push(
        `연산 #${i} (G4 위반): 기존 문서에 setup_document를 실행하면 전체 서식이 초기화됩니다.`
      );
      continue;
    }

    // Nested table policy rules
    if (kind === "insert_nested_table") {
      if (!isHwpx) {
        errors.push(`연산 #${i} (insert_nested_table): HWP 바이너리는 중첩 표 미지원 — HWPX로 저장 후 시도`);
        continue;
      }
      const rows = Number(op.rows ?? 2);
      const cols = Number(op.cols ?? 2);
      if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || rows > 8 || cols < 1 || cols > 8) {
        errors.push(
          `연산 #${i} (insert_nested_table): 중첩 표 크기는 1x1 ~ 8x8 정수 범위여야 합니다 (요청: ${rows}x${cols}).`
        );
        continue;
      }
      if (op.widthMode && op.widthMode !== "fit_cell") {
        errors.push(
          `연산 #${i} (insert_nested_table): 지원되지 않는 widthMode입니다 ('fit_cell'만 허용됨, 요청: ${op.widthMode}).`
        );
        continue;
      }
    }

    // Cell coordinate & G2 excluded-region validation
    if (CELL_TARGET_OPS.has(kind)) {
      const tIdx = Number(op.tableIndex ?? op.table ?? 0);
      const row = Number(op.row ?? 0);
      const col = Number(op.col ?? 0);
      const endRow = typeof op.endRow === "number" ? op.endRow : typeof op.to_row === "number" ? op.to_row : row;
      const endCol = typeof op.endCol === "number" ? op.endCol : typeof op.to_col === "number" ? op.to_col : col;

      if (!Number.isInteger(tIdx) || !Number.isInteger(row) || !Number.isInteger(col) || tIdx < 0 || row < 0 || col < 0) {
        errors.push(
          `연산 #${i} (${kind}): 음수 또는 비정수 표/셀 좌표는 허용되지 않습니다 (table=${tIdx}, row=${row}, col=${col}).`
        );
        continue;
      }

      // G2: Excluded cell region check
      let hitExcluded = false;
      for (let r = Math.min(row, endRow); r <= Math.max(row, endRow); r++) {
        for (let c = Math.min(col, endCol); c <= Math.max(col, endCol); c++) {
          const key = `${tIdx}:${r}:${c}`;
          if (excludedCellKeys.has(key)) {
            errors.push(
              `연산 #${i} (G2 위반): 셀 (${tIdx}번 표 [${r}, ${c}])은 사용자가 AI 수정 제외로 지정한 보호 영역입니다.`
            );
            hitExcluded = true;
            break;
          }
        }
        if (hitExcluded) break;
      }
      if (hitExcluded) continue;

      if (Array.isArray(tablesMeta) && tablesMeta.length > 0) {
        const tbl = tablesMeta.find((t) => t.tableIndex === tIdx) || tablesMeta[tIdx];
        if (!tbl) {
          if (kind === "insert_nested_table") {
            errors.push(`연산 #${i} (insert_nested_table): 대상 표를 찾을 수 없습니다 (tableIndex: ${tIdx}).`);
            continue;
          } else {
            warnings.push(`연산 #${i} (${kind}): 표 #${tIdx}가 현재 표 목록(총 ${tablesMeta.length}개)에 없습니다.`);
          }
        } else {
          if (kind === "insert_nested_table" && (tbl.depth ?? 0) >= 2) {
            errors.push(
              `연산 #${i} (insert_nested_table): 중첩 깊이 초과 (nesting depth limit exceeded) — 최대 중첩 깊이는 2단계까지만 허용됩니다 (현재 depth=${tbl.depth}).`
            );
            continue;
          }
          if (tbl.rowCount > 0 && tbl.colCount > 0) {
            if (row >= tbl.rowCount || col >= tbl.colCount) {
              errors.push(
                `연산 #${i} (${kind}): 표 #${tIdx} 범위(${tbl.rowCount}x${tbl.colCount})를 벗어난 셀 좌표([${row}, ${col}])입니다.`
              );
              continue;
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
