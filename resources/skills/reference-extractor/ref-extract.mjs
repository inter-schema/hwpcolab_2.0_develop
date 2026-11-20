#!/usr/bin/env node
/**
 * HOP-Claw Agent Skill CLI: reference-extractor (ref-extract.mjs)
 * License: GNU General Public License v3.0 or later (GPL-3.0-or-later)
 *
 * Extracts structured Markdown and JSON tables from DOCX, XLSX/XLS/CSV,
 * HWP/HWPX, TXT/MD/JSON with Zip-Bomb expansion protection.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");
const CLAW_SCRIPTS_DIR = path.resolve(WORKSPACE_ROOT, "resources/claw-hwp/scripts");
const FFLATE_PATH = path.resolve(CLAW_SCRIPTS_DIR, "vendor/fflate/index.mjs");

import {
  MAX_ZIP_COMPRESSED_BYTES,
  MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
  MAX_ZIP_SINGLE_ENTRY_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_COMPRESSION_RATIO,
  safeUnzipHwpxBytes,
} from "../../claw-hwp/scripts/security-guard.mjs";

export {
  MAX_ZIP_COMPRESSED_BYTES,
  MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
  MAX_ZIP_SINGLE_ENTRY_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_COMPRESSION_RATIO,
};

export async function safeUnzipBytes(zipBytes, label = "archive") {
  const fflate = await import(pathToFileURL(FFLATE_PATH).href);
  const unzipped = safeUnzipHwpxBytes(new Uint8Array(zipBytes), label);
  return { unzipped, fflate };
}

function decodeXmlEntities(str) {
  return String(str || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function rowsToMarkdownTable(rows) {
  if (!rows || rows.length === 0) return "";
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  const normalized = rows.map((r) => {
    const padded = [...r];
    while (padded.length < colCount) padded.push("");
    return padded.map((cell) => String(cell ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim());
  });
  const header = `| ${normalized[0].join(" | ")} |`;
  const sep = `| ${normalized[0].map(() => "---").join(" | ")} |`;
  const body = normalized.slice(1).map((r) => `| ${r.join(" | ")} |`);
  return [header, sep, ...body].join("\n");
}

async function extractDocxFile(filePath) {
  const bytes = fs.readFileSync(filePath);
  const { unzipped, fflate } = await safeUnzipBytes(bytes, path.basename(filePath));
  const docXmlBytes = unzipped["word/document.xml"];
  if (!docXmlBytes) {
    throw new Error("유효한 DOCX 파일이 아닙니다 (word/document.xml 누락)");
  }
  const xml = fflate.strFromU8(docXmlBytes);
  const paragraphs = [];
  const tables = [];

  const tblRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
  let tblMatch;
  let tblIdx = 0;
  while ((tblMatch = tblRegex.exec(xml)) !== null) {
    const tblXml = tblMatch[0];
    const rowRegex = /<w:tr\b[\s\S]*?<\/w:tr>/g;
    const rows = [];
    let rMatch;
    while ((rMatch = rowRegex.exec(tblXml)) !== null) {
      const cellRegex = /<w:tc\b[\s\S]*?<\/w:tc>/g;
      const rowCells = [];
      let cMatch;
      while ((cMatch = cellRegex.exec(rMatch[0])) !== null) {
        const texts = [];
        const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
        let tMatch;
        while ((tMatch = tRegex.exec(cMatch[0])) !== null) {
          texts.push(decodeXmlEntities(tMatch[1]));
        }
        rowCells.push(texts.join("").trim());
      }
      if (rowCells.length > 0) rows.push(rowCells);
    }
    if (rows.length > 0) {
      tables.push({ name: `Table_${++tblIdx}`, rows });
    }
  }

  const bodyWithoutTables = xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, "");
  const pRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(bodyWithoutTables)) !== null) {
    const texts = [];
    const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let tMatch;
    while ((tMatch = tRegex.exec(pMatch[0])) !== null) {
      texts.push(decodeXmlEntities(tMatch[1]));
    }
    const line = texts.join("").trim();
    if (line) paragraphs.push(line);
  }

  const mdParts = [`## [DOCX] ${path.basename(filePath)}`];
  if (paragraphs.length > 0) {
    mdParts.push(paragraphs.join("\n\n"));
  }
  for (const tbl of tables) {
    mdParts.push(`### ${tbl.name}\n${rowsToMarkdownTable(tbl.rows)}`);
  }

  return {
    fileName: path.basename(filePath),
    filePath,
    format: "docx",
    paragraphs,
    tables,
    markdown: mdParts.join("\n\n"),
  };
}

async function extractSpreadsheetFile(filePath) {
  const bytes = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".xlsx") {
    await safeUnzipBytes(bytes, path.basename(filePath));
  }
  const XLSX = await import("xlsx");
  const mod = XLSX.default || XLSX;
  const wb = mod.read(bytes, { type: "buffer" });

  const tables = [];
  const mdParts = [`## [Spreadsheet] ${path.basename(filePath)}`];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = mod.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const nonEmptyRows = rows.filter((r) => Array.isArray(r) && r.some((cell) => String(cell ?? "").trim() !== ""));
    if (nonEmptyRows.length > 0) {
      tables.push({ name: sheetName, rows: nonEmptyRows });
      mdParts.push(`### 시트: ${sheetName}\n${rowsToMarkdownTable(nonEmptyRows)}`);
    }
  }

  return {
    fileName: path.basename(filePath),
    filePath,
    format: ext.replace(".", ""),
    paragraphs: [],
    tables,
    markdown: mdParts.join("\n\n"),
  };
}

function extractHwpOrHwpxFile(filePath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const extractScript = path.join(CLAW_SCRIPTS_DIR, "extract_text.js");
    const child = spawn("node", [extractScript, filePath, "--json"], {
      cwd: WORKSPACE_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(Buffer.from(d)));
    child.stderr.on("data", (d) => err.push(Buffer.from(d)));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(Buffer.concat(err).toString("utf8") || "HWP/HWPX 추출 실패"));
        return;
      }
      const parsed = JSON.parse(Buffer.concat(out).toString("utf8"));
      const paragraphs = (parsed.paragraphs || []).map((p) => p.text).filter(Boolean);
      const tables = (parsed.tables || []).map((t, idx) => ({
        name: `Table_${idx + 1}`,
        rows: t.rows || [],
      }));
      const mdParts = [`## [HWP/HWPX] ${path.basename(filePath)}`];
      if (paragraphs.length > 0) mdParts.push(paragraphs.join("\n\n"));
      for (const tbl of tables) {
        if (tbl.rows.length > 0) {
          mdParts.push(`### ${tbl.name}\n${rowsToMarkdownTable(tbl.rows)}`);
        }
      }
      resolvePromise({
        fileName: path.basename(filePath),
        filePath,
        format: /\.hwpx$/i.test(filePath) ? "hwpx" : "hwp",
        paragraphs,
        tables,
        markdown: mdParts.join("\n\n"),
      });
    });
  });
}

export async function extractReferenceFile(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`참고자료 파일을 찾을 수 없습니다: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".docx") {
    return extractDocxFile(resolved);
  }
  if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
    return extractSpreadsheetFile(resolved);
  }
  if (ext === ".hwp" || ext === ".hwpx") {
    return extractHwpOrHwpxFile(resolved);
  }
  const text = fs.readFileSync(resolved, "utf8");
  return {
    fileName: path.basename(resolved),
    filePath: resolved,
    format: ext.replace(".", "") || "txt",
    paragraphs: text.split(/\r?\n/).filter((l) => l.trim().length > 0),
    tables: [],
    markdown: `## [${ext.toUpperCase() || "TEXT"}] ${path.basename(resolved)}\n\n${text}`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`HOP-Claw Reference Extractor Skill CLI (GPL-3.0-or-later)
사용법:
  ref-extract <file1> [file2 ...] [--json] [--output <outFile>]`);
    return;
  }

  let asJson = false;
  let outputFile = null;
  const files = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") {
      asJson = true;
    } else if (args[i] === "--format" && args[i + 1]) {
      const fmt = String(args[++i]).toLowerCase();
      asJson = fmt === "json";
    } else if (args[i].startsWith("--format=")) {
      const fmt = args[i].slice("--format=".length).toLowerCase();
      asJson = fmt === "json";
    } else if (args[i] === "--output" && args[i + 1]) {
      outputFile = path.resolve(args[++i]);
    } else if (!args[i].startsWith("--")) {
      files.push(args[i]);
    }
  }

  const results = [];
  for (const f of files) {
    results.push(await extractReferenceFile(f));
  }

  const outputText = asJson
    ? JSON.stringify({ ok: true, count: results.length, files: results }, null, 2)
    : results.map((r) => r.markdown).join("\n\n---\n\n");

  if (outputFile) {
    fs.writeFileSync(outputFile, outputText, "utf8");
    console.log(JSON.stringify({ ok: true, output: outputFile, count: results.length }));
  } else {
    console.log(outputText);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
}
