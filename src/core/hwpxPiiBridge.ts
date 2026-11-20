import { zipSync, strFromU8, strToU8 } from "fflate";
import { safeUnzipBytes } from "./safeUnzip.ts";
import { scanTopLevel } from "./hwpxTableIndex.ts";
import type { PrivacySessionMasker } from "./privacyMasker.ts";
import type { ExcludedRegion } from "../types/privacy.ts";

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeXmlEntities(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function repackHwpx(files: Record<string, Uint8Array>): Uint8Array {
  const zippable: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  if (files["mimetype"]) {
    zippable["mimetype"] = [files["mimetype"], { level: 0 }];
  }
  for (const [name, bytes] of Object.entries(files)) {
    if (name === "mimetype") continue;
    zippable[name] = bytes;
  }
  return zipSync(zippable as any, { level: 6 });
}

interface CellCoordinateSpan {
  key: string; // `${tableIndex}:${row}:${col}`
  start: number;
  end: number;
  xml: string;
}

/**
 * Finds outer byte/char ranges of `<hp:tc>` elements matching excluded table cell coordinates
 * within a section XML string, using pre-order table indexing matching `hwpxTableIndex.ts`.
 */
function findExcludedCellSpansInSection(
  xml: string,
  startTableIndex: number,
  excludedKeys: Set<string>
): { spans: CellCoordinateSpan[]; nextTableIndex: number } {
  const spans: CellCoordinateSpan[] = [];
  let tableCounter = startTableIndex;

  function walk(fragment: string, baseOffset: number) {
    const tblList = scanTopLevel(fragment, "hp:tbl");
    for (const tbl of tblList) {
      const currentTableIndex = tableCounter++;
      const tblInnerOffset = baseOffset + tbl.openEnd;
      const trList = scanTopLevel(tbl.inner, "hp:tr");
      for (let ri = 0; ri < trList.length; ri++) {
        const tr = trList[ri];
        const trInnerOffset = tblInnerOffset + tr.openEnd;
        const tcList = scanTopLevel(tr.inner, "hp:tc");
        for (let ci = 0; ci < tcList.length; ci++) {
          const tc = tcList[ci];
          const subEnd = tc.inner.lastIndexOf("</hp:subList>");
          const directInner = subEnd >= 0 ? tc.inner.slice(subEnd) : tc.inner;
          const am = directInner.match(
            /<hp:cellAddr [^>]*colAddr="(\d+)"[^>]*rowAddr="(\d+)"|<hp:cellAddr [^>]*rowAddr="(\d+)"[^>]*colAddr="(\d+)"/
          );
          const col = am ? (am[1] !== undefined ? Number(am[1]) : Number(am[4])) : ci;
          const row = am ? (am[2] !== undefined ? Number(am[2]) : Number(am[3])) : ri;
          const key = `${currentTableIndex}:${row}:${col}`;
          if (excludedKeys.has(key)) {
            const absStart = trInnerOffset + tc.start;
            const absEnd = trInnerOffset + tc.end;
            spans.push({
              key,
              start: absStart,
              end: absEnd,
              xml: xml.slice(absStart, absEnd),
            });
          }
        }
      }

      // Recurse into child tables in pre-order
      const childTbls = scanTopLevel(tbl.inner, "hp:tbl");
      for (const childTbl of childTbls) {
        walk(tbl.inner.slice(childTbl.start, childTbl.end), tblInnerOffset + childTbl.start);
      }
    }
  }

  walk(xml, 0);
  return { spans, nextTableIndex: tableCounter };
}

export interface MaskedHwpxCopyResult {
  maskedBytes: Uint8Array;
  maskedNodeCount: number;
  excludedCellSnapshots: Record<string, string>;
}

/**
 * Produces a masked temporary copy of an HWPX package for external Agent CLI consumption:
 * - Replaces PII patterns (RRN, phone, email, account) and excluded regions in `<hp:t>` text runs
 *   with reversible session tokens (`[[PII_*]]`, `[[AI_EXCLUDED_*]]`).
 * - Captures original `<hp:tc>` snapshots for excluded table cells so any accidental CLI edit
 *   to protected cells can be automatically reverted on unmasking.
 */
export function maskHwpxPackageBytes(
  hwpxBytes: Uint8Array,
  masker: PrivacySessionMasker,
  excludedRegions: ExcludedRegion[] = [],
  autoMaskPii = true
): MaskedHwpxCopyResult {
  const unzipped = safeUnzipBytes(hwpxBytes, "hwpx-pii-mask");
  const sectionFiles = Object.keys(unzipped)
    .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const ma = a.match(/section(\d+)\.xml/i);
      const mb = b.match(/section(\d+)\.xml/i);
      return (ma ? parseInt(ma[1], 10) : 0) - (mb ? parseInt(mb[1], 10) : 0);
    });

  const excludedCellKeys = new Set(
    excludedRegions
      .filter((r) => r.targetType === "cell")
      .map((r) => `${r.tableIndex}:${r.row}:${r.col}`)
  );

  const excludedCellSnapshots: Record<string, string> = {};
  let maskedNodeCount = 0;
  let tableCounter = 0;

  for (const secName of sectionFiles) {
    let xml = strFromU8(unzipped[secName]);

    // 1. Snapshot original excluded cell XML before masking
    if (excludedCellKeys.size > 0) {
      const { spans, nextTableIndex } = findExcludedCellSpansInSection(
        xml,
        tableCounter,
        excludedCellKeys
      );
      tableCounter = nextTableIndex;
      for (const span of spans) {
        excludedCellSnapshots[span.key] = span.xml;
      }
    }

    // 2. Mask every <hp:t> text run safely (entity-decoded -> masked -> entity-encoded)
    const maskedXml = xml.replace(
      /(<hp:t\b[^>]*>)([\s\S]*?)(<\/hp:t>)/g,
      (_full, openTag: string, rawInner: string, closeTag: string) => {
        if (!rawInner) return `${openTag}${rawInner}${closeTag}`;
        const decoded = decodeXmlEntities(rawInner);
        const masked = masker.maskTextForPrompt(decoded, excludedRegions, autoMaskPii);
        if (masked !== decoded) {
          maskedNodeCount += 1;
          return `${openTag}${encodeXmlEntities(masked)}${closeTag}`;
        }
        return `${openTag}${rawInner}${closeTag}`;
      }
    );

    if (maskedXml !== xml) {
      unzipped[secName] = strToU8(maskedXml);
    }
  }

  return {
    maskedBytes: repackHwpx(unzipped),
    maskedNodeCount,
    excludedCellSnapshots,
  };
}

export interface UnmaskedHwpxResult {
  restoredBytes: Uint8Array;
  restoredNodeCount: number;
  revertedExcludedCells: string[];
}

/**
 * Restores all session PII/exclusion tokens inside an edited HWPX package back to original values
 * and reverts any unauthorized modifications to excluded table cells.
 */
export function unmaskHwpxPackageBytes(
  hwpxBytes: Uint8Array,
  masker: PrivacySessionMasker,
  excludedCellSnapshots: Record<string, string> = {}
): UnmaskedHwpxResult {
  const unzipped = safeUnzipBytes(hwpxBytes, "hwpx-pii-unmask");
  const sectionFiles = Object.keys(unzipped)
    .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const ma = a.match(/section(\d+)\.xml/i);
      const mb = b.match(/section(\d+)\.xml/i);
      return (ma ? parseInt(ma[1], 10) : 0) - (mb ? parseInt(mb[1], 10) : 0);
    });

  const snapshotKeys = new Set(Object.keys(excludedCellSnapshots));
  const revertedExcludedCells: string[] = [];
  let restoredNodeCount = 0;
  let tableCounter = 0;

  for (const secName of sectionFiles) {
    let xml = strFromU8(unzipped[secName]);
    let modified = false;

    // 1. Restore session tokens inside <hp:t> text nodes
    if (xml.includes("[[PII_") || xml.includes("[[AI_EXCLUDED_")) {
      const restoredXml = xml.replace(
        /(<hp:t\b[^>]*>)([\s\S]*?)(<\/hp:t>)/g,
        (_full, openTag: string, rawInner: string, closeTag: string) => {
          if (!rawInner.includes("[[PII_") && !rawInner.includes("[[AI_EXCLUDED_")) {
            return `${openTag}${rawInner}${closeTag}`;
          }
          const decoded = decodeXmlEntities(rawInner);
          const restored = masker.unmaskText(decoded);
          if (restored !== decoded) {
            restoredNodeCount += 1;
            return `${openTag}${encodeXmlEntities(restored)}${closeTag}`;
          }
          return `${openTag}${rawInner}${closeTag}`;
        }
      );
      if (restoredXml !== xml) {
        xml = restoredXml;
        modified = true;
      }
    }

    // 2. Verify excluded table cells were not altered; revert if modified
    if (snapshotKeys.size > 0) {
      const { spans, nextTableIndex } = findExcludedCellSpansInSection(
        xml,
        tableCounter,
        snapshotKeys
      );
      tableCounter = nextTableIndex;
      // Apply replacements from back to front so offsets remain valid
      const sortedDesc = [...spans].sort((a, b) => b.start - a.start);
      for (const span of sortedDesc) {
        const expectedXml = excludedCellSnapshots[span.key];
        if (expectedXml && span.xml !== expectedXml) {
          xml = xml.slice(0, span.start) + expectedXml + xml.slice(span.end);
          revertedExcludedCells.push(span.key);
          modified = true;
        }
      }
    }

    if (modified) {
      unzipped[secName] = strToU8(xml);
    }
  }

  return {
    restoredBytes: repackHwpx(unzipped),
    restoredNodeCount,
    revertedExcludedCells,
  };
}
