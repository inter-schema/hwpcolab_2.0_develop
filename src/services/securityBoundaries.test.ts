import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { zipSync, strToU8, strFromU8 } from "fflate";
import { safeUnzipBytes } from "../core/safeUnzip";
import { PrivacySessionMasker } from "../core/privacyMasker";
import { maskHwpxPackageBytes, unmaskHwpxPackageBytes } from "../core/hwpxPiiBridge";

const WORKSPACE_ROOT = process.cwd();
const HWPX_EDIT_SCRIPT = path.resolve(WORKSPACE_ROOT, "resources/claw-hwp/scripts/hwpx-edit.js");
const REF_EXTRACT_SCRIPT = path.resolve(
  WORKSPACE_ROOT,
  "resources/skills/reference-extractor/ref-extract.mjs"
);
const SAMPLE_HWPX = path.resolve(WORKSPACE_ROOT, "samples/demo_official_report.hwpx");

function buildSyntheticHwpxWithTable(cell00Text: string, cell01Text: string, bodyText: string): Uint8Array {
  const sectionXml = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p id="1"><hp:run charPrIDRef="0"><hp:t>${bodyText}</hp:t></hp:run></hp:p>
  <hp:p id="2"><hp:run charPrIDRef="0">
    <hp:tbl id="10" rowCnt="1" colCnt="2">
      <hp:tr>
        <hp:tc>
          <hp:subList><hp:p id="11"><hp:run charPrIDRef="0"><hp:t>${cell00Text}</hp:t></hp:run></hp:p></hp:subList>
          <hp:cellAddr colAddr="0" rowAddr="0"/>
          <hp:cellSpan colSpan="1" rowSpan="1"/>
        </hp:tc>
        <hp:tc>
          <hp:subList><hp:p id="12"><hp:run charPrIDRef="0"><hp:t>${cell01Text}</hp:t></hp:run></hp:p></hp:subList>
          <hp:cellAddr colAddr="1" rowAddr="0"/>
          <hp:cellSpan colSpan="1" rowSpan="1"/>
        </hp:tc>
      </hp:tr>
    </hp:tbl>
  </hp:run></hp:p>
</hs:sec>`;

  return zipSync(
    {
      mimetype: [strToU8("application/hwp+zip"), { level: 0 }],
      "Contents/content.hpf": strToU8("<opf:package/>"),
      "Contents/header.xml": strToU8("<hh:head/>"),
      "Contents/section0.xml": strToU8(sectionXml),
    },
    { level: 6 }
  );
}

describe("Security Boundaries: ZIP Guard, Engine Policy Guard, Argument-Array Skill Exec, File-Level PII Bridge", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hop-sec-boundary-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("1. Safe ZIP Decompression Limits", () => {
    it("accepts a normal HWPX archive", () => {
      const bytes = new Uint8Array(fs.readFileSync(SAMPLE_HWPX));
      const unzipped = safeUnzipBytes(bytes, "sample.hwpx");
      expect(unzipped["Contents/section0.xml"]).toBeDefined();
    });

    it("rejects ZIP archives containing path-traversal entry names", () => {
      const evilZip = zipSync({
        "../evil.txt": strToU8("pwn"),
      });
      expect(() => safeUnzipBytes(evilZip, "evil.hwpx")).toThrow(/허용되지 않은 ZIP 경로/);
    });

    it("rejects ZIP bombs exceeding compression ratio limit", () => {
      // 2.5 MiB of zeros compresses to ~2.5 KiB (~1000x ratio > 120x limit)
      const bombPayload = new Uint8Array(2.5 * 1024 * 1024);
      const bombZip = zipSync(
        {
          mimetype: [strToU8("application/hwp+zip"), { level: 0 }],
          "Contents/section0.xml": bombPayload,
        },
        { level: 9 }
      );
      expect(() => safeUnzipBytes(bombZip, "bomb.hwpx")).toThrow(/압축률|비율/);
    });

    it("rejects ZIP archives exceeding max entry count", () => {
      const entries: Record<string, Uint8Array> = {};
      for (let i = 0; i < 12; i++) {
        entries[`f${i}.txt`] = strToU8("x");
      }
      const zip = zipSync(entries);
      expect(() => safeUnzipBytes(zip, "many.hwpx", { maxEntries: 5 })).toThrow(/엔트리/);
    });
  });

  describe("2. Engine-Level Policy Guard inside hwpx-edit.js", () => {
    it("blocks setup_document on existing HWPX and preserves original file bytes untouched", () => {
      const targetPath = path.join(tmpDir, "existing_doc.hwpx");
      const originalBytes = buildSyntheticHwpxWithTable("항목", "금액", "본문");
      fs.writeFileSync(targetPath, originalBytes);

      const res = spawnSync("node", [HWPX_EDIT_SCRIPT], {
        input: JSON.stringify({
          path: targetPath,
          output: targetPath,
          operations: [{ type: "setup_document", title: "초기화" }],
        }),
        encoding: "utf8",
      });

      expect(res.status).not.toBe(0);
      expect(res.stdout).toContain("G4 위반");
      expect(Buffer.compare(fs.readFileSync(targetPath), Buffer.from(originalBytes))).toBe(0);
    });

    it("blocks editing an excluded cell (G2) directly at hwpx-edit.js engine level", () => {
      const targetPath = path.join(tmpDir, "excluded_cell.hwpx");
      const originalBytes = buildSyntheticHwpxWithTable("기밀 셀", "공개 셀", "본문");
      fs.writeFileSync(targetPath, originalBytes);

      const res = spawnSync("node", [HWPX_EDIT_SCRIPT], {
        input: JSON.stringify({
          path: targetPath,
          output: targetPath,
          policyContext: {
            isNewDocument: false,
            excludedRegions: [
              { id: "ex-1", targetType: "cell", tableIndex: 0, row: 0, col: 0, label: "기밀 셀", rawText: "기밀 셀" },
            ],
          },
          operations: [{ type: "set_cell_text", table: 0, row: 0, col: 0, text: "덮어쓰기" }],
        }),
        encoding: "utf8",
      });

      expect(res.status).not.toBe(0);
      expect(res.stdout).toContain("G2 위반");
      expect(Buffer.compare(fs.readFileSync(targetPath), Buffer.from(originalBytes))).toBe(0);
    });

    it("blocks out-of-bounds cell coordinates and oversized nested table (>8x8) at engine level", () => {
      const targetPath = path.join(tmpDir, "bounds_check.hwpx");
      const originalBytes = buildSyntheticHwpxWithTable("A", "B", "본문");
      fs.writeFileSync(targetPath, originalBytes);

      const oobRes = spawnSync("node", [HWPX_EDIT_SCRIPT], {
        input: JSON.stringify({
          path: targetPath,
          output: targetPath,
          operations: [{ type: "set_cell_text", table: 0, row: 5, col: 0, text: "범위초과" }],
        }),
        encoding: "utf8",
      });
      expect(oobRes.status).not.toBe(0);
      expect(oobRes.stdout).toContain("범위");

      const nestedRes = spawnSync("node", [HWPX_EDIT_SCRIPT], {
        input: JSON.stringify({
          path: targetPath,
          output: targetPath,
          operations: [{ type: "insert_nested_table", table: 0, row: 0, col: 0, rows: 9, cols: 2 }],
        }),
        encoding: "utf8",
      });
      expect(nestedRes.status).not.toBe(0);
      expect(nestedRes.stdout).toContain("1x1 ~ 8x8");
    });
  });

  describe("3. Argument-Array Skill Execution (Shell Injection Immunity)", () => {
    it("extracts a reference file whose filename contains spaces, quotes, semicolons, $(), and backticks without executing shell syntax", () => {
      const sentinelName = "shell_injection_sentinel";
      const sentinelFile = path.join(tmpDir, sentinelName);
      const weirdFileName = `2026 (예산안); $(touch ${sentinelName}) \`id\` 'test'.txt`;
      const weirdFilePath = path.join(tmpDir, weirdFileName);
      fs.writeFileSync(weirdFilePath, "안전한 참고자료 내용 12345", "utf8");

      const stdout = execFileSync("node", [REF_EXTRACT_SCRIPT, weirdFilePath, "--format", "markdown"], {
        cwd: tmpDir,
        encoding: "utf8",
      });

      expect(stdout).toContain("안전한 참고자료 내용 12345");
      expect(fs.existsSync(sentinelFile)).toBe(false);
    });
  });

  describe("4. File-Level PII Masking & Automatic Unmasking Round-Trip", () => {
    it("masks PII in temporary HWPX copy for external CLI, restores PII after edit, and reverts excluded cell edits", () => {
      const originalHwpx = buildSyntheticHwpxWithTable(
        "대외비 예산 500억원",
        "담당자 연락처 010-9876-5432",
        "신청인 주민번호 900101-1234567 이메일 test@korea.kr 원문"
      );

      const masker = new PrivacySessionMasker();
      const excludedRegions = [
        {
          id: "cell-0-0",
          targetType: "cell" as const,
          tableIndex: 0,
          row: 0,
          col: 0,
          label: "표 1 (1,1)",
          rawText: "대외비 예산 500억원",
        },
      ];

      // Step A: Create masked temporary HWPX copy passed to external CLI
      const { maskedBytes, maskedNodeCount, excludedCellSnapshots } = maskHwpxPackageBytes(
        originalHwpx,
        masker,
        excludedRegions,
        true
      );
      expect(maskedNodeCount).toBeGreaterThanOrEqual(3);

      const maskedFiles = safeUnzipBytes(maskedBytes, "masked-check");
      const maskedSectionXml = strFromU8(maskedFiles["Contents/section0.xml"]);

      // Raw PII and excluded text must NOT exist in the masked file visible to external CLI
      expect(maskedSectionXml).not.toContain("900101-1234567");
      expect(maskedSectionXml).not.toContain("010-9876-5432");
      expect(maskedSectionXml).not.toContain("test@korea.kr");
      expect(maskedSectionXml).not.toContain("대외비 예산 500억원");
      expect(maskedSectionXml).toContain("[[PII_RRN_");
      expect(maskedSectionXml).toContain("[[PII_PHONE_");
      expect(maskedSectionXml).toContain("[[PII_EMAIL_");
      expect(maskedSectionXml).toContain("[[AI_EXCLUDED_");

      // Step B: Simulate external CLI legitimately editing body text ("원문" -> "교정완료")
      // AND maliciously/accidentally altering the excluded cell (0,0)
      const cliEditedSectionXml = maskedSectionXml
        .replace("원문", "교정완료")
        .replace(/\[\[AI_EXCLUDED_\d+\]\]/, "외부CLI가_덮어쓴_값");
      const cliEditedHwpx = zipSync(
        {
          ...maskedFiles,
          mimetype: [maskedFiles["mimetype"], { level: 0 }],
          "Contents/section0.xml": strToU8(cliEditedSectionXml),
        },
        { level: 6 }
      );

      // Step C: Unmask back into main staging file
      const { restoredBytes, restoredNodeCount, revertedExcludedCells } = unmaskHwpxPackageBytes(
        cliEditedHwpx,
        masker,
        excludedCellSnapshots
      );

      expect(restoredNodeCount).toBeGreaterThanOrEqual(2);
      expect(revertedExcludedCells).toContain("0:0:0");

      const restoredSectionXml = strFromU8(
        safeUnzipBytes(restoredBytes, "restored-check")["Contents/section0.xml"]
      );
      // Original PII restored, legitimate CLI edit kept, excluded cell tampering reverted!
      expect(restoredSectionXml).toContain("900101-1234567");
      expect(restoredSectionXml).toContain("010-9876-5432");
      expect(restoredSectionXml).toContain("test@korea.kr");
      expect(restoredSectionXml).toContain("교정완료");
      expect(restoredSectionXml).toContain("대외비 예산 500억원");
      expect(restoredSectionXml).not.toContain("외부CLI가_덮어쓴_값");
    });
  });
});
