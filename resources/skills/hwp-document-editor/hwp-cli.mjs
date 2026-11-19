#!/usr/bin/env node
/**
 * HOP-Claw Agent Skill CLI: hwp-document-editor (hwp-cli.mjs)
 * License: GNU General Public License v3.0 or later (GPL-3.0-or-later)
 *
 * Provides standalone CLI operations for inspecting, linting, editing,
 * formatting (Korean Official Document rules), inserting nested tables,
 * and checking layout overflow on HWP/HWPX documents.
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
const RHWP_VENDOR_DIR = path.resolve(CLAW_SCRIPTS_DIR, "vendor/rhwp");

function runNodeScript(scriptPath, args = [], stdinData) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("node", [scriptPath, ...args], {
      cwd: WORKSPACE_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(Buffer.from(d)));
    child.stderr.on("data", (d) => err.push(Buffer.from(d)));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 0,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
    if (stdinData !== undefined) {
      child.stdin.write(stdinData);
    }
    child.stdin.end();
  });
}

function runPythonScript(scriptPath, args = []) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("python3", [scriptPath, ...args], {
      cwd: WORKSPACE_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(Buffer.from(d)));
    child.stderr.on("data", (d) => err.push(Buffer.from(d)));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 0,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

/**
 * Parse HWPX tables (including nested tables) from bytes using fflate.
 */
async function parseHwpxTablesHierarchy(fileBytes) {
  const fflate = await import(pathToFileURL(FFLATE_PATH).href);
  const unzipped = fflate.unzipSync(new Uint8Array(fileBytes));
  const sectionFiles = Object.keys(unzipped)
    .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
    .sort();

  const tables = [];
  let globalTableIndex = 0;

  for (let secIdx = 0; secIdx < sectionFiles.length; secIdx++) {
    const xml = fflate.strFromU8(unzipped[sectionFiles[secIdx]]);
    const tokenRe = /<hp:tbl\b[^>]*>|<\/hp:tbl>|<hp:tc\b[^>]*>|<\/hp:tc>|<hp:cellAddr\b[^>]*>|<hp:cellSpan\b[^>]*>|<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/g;
    const tblStack = [];
    let m;
    while ((m = tokenRe.exec(xml)) !== null) {
      const token = m[0];
      if (token.startsWith("<hp:tbl")) {
        const rowCntM = token.match(/\browCnt="(\d+)"/);
        const colCntM = token.match(/\bcolCnt="(\d+)"/);
        const depth = tblStack.length;
        const parent = depth > 0 ? tblStack[depth - 1] : null;
        const entry = {
          tableIndex: globalTableIndex++,
          sec: secIdx,
          depth,
          parentTableIndex: parent ? parent.tableIndex : undefined,
          parentCell: parent && parent.currentCell ? { row: parent.currentCell.row, col: parent.currentCell.col } : undefined,
          rowCount: rowCntM ? parseInt(rowCntM[1], 10) : 0,
          colCount: colCntM ? parseInt(colCntM[1], 10) : 0,
          cells: [],
          currentCell: null,
        };
        tables.push(entry);
        tblStack.push(entry);
      } else if (token === "</hp:tbl>") {
        tblStack.pop();
      } else if (token.startsWith("<hp:tc")) {
        const top = tblStack[tblStack.length - 1];
        if (top) {
          top.currentCell = {
            idx: top.cells.length,
            row: 0,
            col: 0,
            rowSpan: 1,
            colSpan: 1,
            texts: [],
          };
        }
      } else if (token === "</hp:tc>") {
        const top = tblStack[tblStack.length - 1];
        if (top && top.currentCell) {
          top.cells.push({
            idx: top.currentCell.idx,
            row: top.currentCell.row,
            col: top.currentCell.col,
            rowSpan: top.currentCell.rowSpan,
            colSpan: top.currentCell.colSpan,
            text: top.currentCell.texts.join(" ").trim(),
          });
          top.currentCell = null;
        }
      } else if (token.startsWith("<hp:cellAddr")) {
        const top = tblStack[tblStack.length - 1];
        if (top && top.currentCell) {
          const rM = token.match(/\browAddr="(\d+)"/);
          const cM = token.match(/\bcolAddr="(\d+)"/);
          if (rM) top.currentCell.row = parseInt(rM[1], 10);
          if (cM) top.currentCell.col = parseInt(cM[1], 10);
        }
      } else if (token.startsWith("<hp:cellSpan")) {
        const top = tblStack[tblStack.length - 1];
        if (top && top.currentCell) {
          const rsM = token.match(/\browSpan="(\d+)"/);
          const csM = token.match(/\bcolSpan="(\d+)"/);
          if (rsM) top.currentCell.rowSpan = parseInt(rsM[1], 10);
          if (csM) top.currentCell.colSpan = parseInt(csM[1], 10);
        }
      } else if (token.startsWith("<hp:t")) {
        const top = tblStack[tblStack.length - 1];
        if (top && top.currentCell && m[1]) {
          const clean = m[1]
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"');
          if (clean.trim()) top.currentCell.texts.push(clean.trim());
        }
      }
    }
  }

  return tables.map(({ currentCell, ...rest }) => rest);
}

/**
 * Policy Guard Static Lint for unified edit operations.
 */
export function lintOperations(ops, tablesMeta = [], isHwpx = true) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(ops) || ops.length === 0) {
    errors.push("편집 연산 배열(ops)이 비어 있거나 유효하지 않습니다.");
    return { valid: false, errors, warnings };
  }

  const ALLOWED_TYPES = new Set([
    "set_cell_text",
    "cell_ByCoord",
    "cell",
    "insert_nested_table",
    "set_paragraph_text",
    "paragraph",
    "replace_body_text",
    "replace_text",
    "append_paragraph",
    "insert_paragraph",
    "set_char_shape",
    "char_shape",
    "set_para_shape",
    "para_shape",
    "table_style",
  ]);

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const kind = op.type || op.op;
    if (!kind || !ALLOWED_TYPES.has(kind)) {
      errors.push(`연산 #${i}: 지원하지 않는 연산 타입입니다 (${kind || "undefined"}).`);
      continue;
    }

    if (kind === "insert_nested_table") {
      if (!isHwpx) {
        errors.push(`연산 #${i} (insert_nested_table): 중첩 표는 HWPX 문서에서만 지원됩니다.`);
      }
      const rows = Number(op.rows ?? 2);
      const cols = Number(op.cols ?? 2);
      if (rows < 1 || rows > 8 || cols < 1 || cols > 8) {
        errors.push(`연산 #${i} (insert_nested_table): 중첩 표 크기는 1x1 ~ 8x8 범위여야 합니다 (요청: ${rows}x${cols}).`);
      }
    }

    if (kind === "set_cell_text" || kind === "cell_ByCoord" || kind === "insert_nested_table") {
      const tIdx = Number(op.tableIndex ?? op.table ?? 0);
      const row = Number(op.row ?? 0);
      const col = Number(op.col ?? 0);
      if (tIdx < 0 || row < 0 || col < 0) {
        errors.push(`연산 #${i} (${kind}): 음수 좌표는 허용되지 않습니다 (table=${tIdx}, row=${row}, col=${col}).`);
      }
      if (tablesMeta.length > 0) {
        const tbl = tablesMeta.find((t) => t.tableIndex === tIdx) || tablesMeta[tIdx];
        if (!tbl) {
          warnings.push(`연산 #${i} (${kind}): 표 #${tIdx}가 현재 감지된 표 목록(총 ${tablesMeta.length}개)에 없습니다.`);
        } else if (tbl.rowCount > 0 && tbl.colCount > 0) {
          if (row >= tbl.rowCount || col >= tbl.colCount) {
            errors.push(
              `연산 #${i} (${kind}): 표 #${tIdx} 범위(${tbl.rowCount}x${tbl.colCount})를 벗어난 셀 좌표(${row}, ${col})입니다.`
            );
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

/**
 * Translate high-level unified ops to hwpx-edit.js or cell-patch.js native format.
 */
export function translateOpsToEnginePayload(filePath, isHwpx, ops, tablesMeta = []) {
  if (isHwpx) {
    const hwpxOps = ops.map((item) => {
      const kind = item.type || item.op;
      switch (kind) {
        case "set_cell_text":
        case "cell_ByCoord":
          return {
            op: "cell_ByCoord",
            table: Number(item.tableIndex ?? item.table ?? 0),
            row: Number(item.row ?? 0),
            col: Number(item.col ?? 0),
            text: String(item.text ?? ""),
            ...(item.charShape ? { charShape: item.charShape } : {}),
            ...(item.align ? { align: item.align } : {}),
          };
        case "insert_nested_table":
          return {
            op: "insert_nested_table",
            table: Number(item.tableIndex ?? item.table ?? 0),
            row: Number(item.row ?? 0),
            col: Number(item.col ?? 0),
            rows: Number(item.rows ?? 2),
            cols: Number(item.cols ?? 2),
            widthMode: item.widthMode || "fit_cell",
            ...(item.cells ? { cells: item.cells } : {}),
          };
        case "set_paragraph_text":
        case "paragraph":
          return {
            op: "paragraph",
            index: Number(item.paraIndex ?? item.index ?? 0),
            text: String(item.text ?? ""),
          };
        case "replace_body_text":
        case "replace_text":
          return {
            op: "replace_text",
            find: String(item.find ?? ""),
            replace: String(item.replace ?? ""),
          };
        case "append_paragraph":
        case "insert_paragraph":
          return {
            op: "insert_paragraph",
            afterIndex: typeof item.afterParaIndex === "number" ? item.afterParaIndex : (typeof item.afterIndex === "number" ? item.afterIndex : -1),
            text: String(item.text ?? ""),
          };
        case "set_char_shape":
        case "char_shape":
          return {
            op: "char_shape",
            target: item.target,
            ...item.props,
            ...item,
          };
        case "set_para_shape":
        case "para_shape":
          return {
            op: "para_shape",
            target: item.target,
            ...item.props,
            ...item,
          };
        default:
          return item;
      }
    });
    return {
      isHwpx: true,
      payload: {
        file: filePath,
        operations: hwpxOps,
      },
    };
  } else {
    const patches = [];
    const textReplacements = [];
    for (const item of ops) {
      const kind = item.type || item.op;
      if (kind === "set_cell_text" || kind === "cell_ByCoord") {
        const tIdx = Number(item.tableIndex ?? item.table ?? 0);
        const row = Number(item.row ?? 0);
        const col = Number(item.col ?? 0);
        const tbl = tablesMeta.find((t) => t.tableIndex === tIdx) || tablesMeta[tIdx];
        const matchedCell = tbl?.cells?.find((c) => c.row === row && c.col === col);
        patches.push({
          cell_index: matchedCell ? matchedCell.idx : row * (tbl?.colCount || 1) + col,
          expected_old: matchedCell?.text || "",
          text: String(item.text ?? ""),
        });
      } else if (kind === "replace_body_text" || kind === "replace_text") {
        textReplacements.push({
          find: String(item.find ?? ""),
          replace: String(item.replace ?? ""),
        });
      } else if (kind === "set_paragraph_text" && item.oldTextForHwp) {
        textReplacements.push({
          find: String(item.oldTextForHwp),
          replace: String(item.text ?? ""),
        });
      }
    }
    return {
      isHwpx: false,
      payload: {
        file: filePath,
        output: filePath,
        patches,
        text_replacements: textReplacements,
      },
    };
  }
}

/**
 * Inspect layout & overflow using @rhwp/core WASM.
 */
async function runLayoutCheck(filePath) {
  if (typeof globalThis.measureTextWidth !== "function") {
    globalThis.measureTextWidth = (font, text) => {
      const fsPx = parseFloat(font) || 10;
      let w = 0;
      for (const ch of String(text || "")) {
        const code = ch.charCodeAt(0);
        w += (code >= 0xac00 && code <= 0xd7a3) || (code >= 0x3000 && code <= 0x303f) ? fsPx * 1.0 : fsPx * 0.55;
      }
      return w * (96 / 72);
    };
  }

  const wasmBytes = fs.readFileSync(path.join(RHWP_VENDOR_DIR, "rhwp_bg.wasm"));
  const rhwp = await import(pathToFileURL(path.join(RHWP_VENDOR_DIR, "rhwp.js")).href);
  await rhwp.default({ module_or_path: wasmBytes });

  const fileBytes = new Uint8Array(fs.readFileSync(filePath));
  const doc = new rhwp.HwpDocument(fileBytes);
  try {
    doc.reflowLinesegs();
  } catch {}

  const pageCount = doc.pageCount();
  const pages = [];
  for (let p = 0; p < pageCount; p++) {
    try {
      const info = JSON.parse(doc.getPageInfo(p));
      pages.push({ pageIndex: p, width: info.width, height: info.height });
    } catch {
      pages.push({ pageIndex: p, width: 794, height: 1123 });
    }
  }

  const isHwpx = /\.hwpx$/i.test(filePath);
  const tables = isHwpx ? await parseHwpxTablesHierarchy(fileBytes) : [];
  const overflowRisks = [];

  for (const tbl of tables) {
    for (const cell of tbl.cells) {
      const textLen = (cell.text || "").length;
      const lineBreaks = ((cell.text || "").match(/\n/g) || []).length;
      if (textLen > 120 || lineBreaks >= 4) {
        overflowRisks.push({
          tableIndex: tbl.tableIndex,
          depth: tbl.depth,
          row: cell.row,
          col: cell.col,
          charCount: textLen,
          lineCount: lineBreaks + 1,
          reason: textLen > 120 ? "셀 내부 텍스트 과다(120자 초과)" : "다중 줄바꿈(4줄 이상)",
          preview: cell.text.slice(0, 60),
        });
      }
    }
  }

  return {
    ok: true,
    file: filePath,
    format: isHwpx ? "hwpx" : "hwp",
    pageCount,
    pages,
    tableCount: tables.length,
    nestedTableCount: tables.filter((t) => t.depth > 0).length,
    overflowRiskCount: overflowRisks.length,
    overflowRisks,
  };
}

/**
 * Korean Official Document (행정안전부 공문서 규격) audit & auto-formatting.
 */
async function runOfficialFormat(filePath, applyChanges = false) {
  const extractScript = path.join(CLAW_SCRIPTS_DIR, "extract_text.js");
  const res = await runNodeScript(extractScript, ["--format", "text", filePath]);
  if (res.code !== 0) {
    throw new Error(`문서 분석 실패: ${res.stderr}`);
  }
  const paragraphs = res.stdout
    .split(/\r?\n/)
    .map((line, idx) => ({ index: idx, text: line }));
  const isHwpx = /\.hwpx$/i.test(filePath);

  // Korean public official outline hierarchy patterns: 1. -> 가. -> 1) -> 가) -> (1) -> (가) -> ①
  const outlineDiagnostics = [];
  const ops = [];

  for (let idx = 0; idx < paragraphs.length; idx++) {
    const p = paragraphs[idx];
    const text = String(p.text || "").trim();
    if (!text) continue;

    // Detect non-standard bullet characters (-, *, •) at top level and normalize or recommend
    if (/^[-*•]\s+/.test(text)) {
      outlineDiagnostics.push({
        paraIndex: idx,
        currentText: text,
        suggestion: text.replace(/^[-*•]\s+/, "가. "),
        rule: "공문서 항목 기호 표준화 (블릿 기호 대신 '1. → 가. → 1)' 체계 권장)",
      });
    }

    if (isHwpx && applyChanges) {
      ops.push({
        op: "para_shape",
        target: { type: "paragraph", index: idx },
        lineSpacing: 160,
      });
    }
  }

  let appliedResult = null;
  if (applyChanges && isHwpx && ops.length > 0) {
    const editScript = path.join(CLAW_SCRIPTS_DIR, "hwpx-edit.js");
    const editRes = await runNodeScript(editScript, [], JSON.stringify({ file: filePath, operations: ops }));
    try {
      appliedResult = JSON.parse(editRes.stdout.trim());
    } catch {
      appliedResult = { raw: editRes.stdout.trim() };
    }
  }

  return {
    ok: true,
    file: filePath,
    standard: "행정안전부 공문서 작성 규격 (줄간격 160%, 항목 위계 1. → 가. → 1) → 가) → (1) → (가) → ①)",
    paragraphCount: paragraphs.length,
    diagnosticsCount: outlineDiagnostics.length,
    diagnostics: outlineDiagnostics,
    applied: Boolean(applyChanges && isHwpx),
    appliedOpsCount: applyChanges && isHwpx ? ops.length : 0,
    appliedResult,
  };
}

function parseCliArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function resolveTargetFile(positionalFile, flagsFile) {
  const candidate = positionalFile || flagsFile || process.env.HWP_STAGING_PATH;
  if (!candidate) {
    throw new Error(
      "대상 문서 경로가 지정되지 않았습니다. 파일 경로를 인자로 전달하거나 $HWP_STAGING_PATH 환경 변수를 설정하세요."
    );
  }
  const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
  if (!fs.existsSync(resolved)) {
    throw new Error(`문서 파일을 찾을 수 없습니다: ${resolved}`);
  }
  return resolved;
}

async function main() {
  const { positional, flags } = parseCliArgs(process.argv.slice(2));
  const subcommand = positional[0] || "help";

  if (subcommand === "help" || flags.help) {
    console.log(`HOP-Claw HWP/HWPX Document Editor Skill CLI (GPL-3.0-or-later)
사용법:
  hwp-cli inspect [file] [--markdown | --json | --tables]
  hwp-cli layout-check [file]
  hwp-cli lint-ops [file] --ops '<json>'
  hwp-cli edit [file] --ops '<json>' | --ops-file <path>
  hwp-cli nested-table [file] --table <idx> --row <r> --col <c> [--rows 2] [--cols 2]
  hwp-cli official-format [file] [--apply]
  hwp-cli create --output <file.hwpx> [--title <제목>]
  hwp-cli unpack <file.hwpx> <outDir>
  hwp-cli pack <inDir> <outFile.hwpx>
  hwp-cli validate <file.hwpx>`);
    return;
  }

  if (subcommand === "inspect") {
    const targetFile = resolveTargetFile(positional[1], flags.file);
    const isHwpx = /\.hwpx$/i.test(targetFile);
    if (flags.tables) {
      if (isHwpx) {
        const tables = await parseHwpxTablesHierarchy(fs.readFileSync(targetFile));
        console.log(JSON.stringify({ file: targetFile, format: "hwpx", tableCount: tables.length, tables }, null, 2));
      } else {
        const res = await runNodeScript(path.join(CLAW_SCRIPTS_DIR, "extract_text.js"), [
          "--inspect",
          "--with-cell-text",
          targetFile,
        ]);
        if (res.code !== 0) {
          throw new Error(res.stderr || "extract_text failed");
        }
        const parsed = JSON.parse(res.stdout);
        console.log(JSON.stringify({ file: targetFile, format: "hwp", tables: parsed.tables || [] }, null, 2));
      }
      return;
    }
    const extractArgs = flags.markdown
      ? ["--format", "markdown", targetFile]
      : isHwpx
        ? ["--inspect", targetFile]
        : ["--inspect", "--with-cell-text", targetFile];
    const res = await runNodeScript(path.join(CLAW_SCRIPTS_DIR, "extract_text.js"), extractArgs);
    if (res.code !== 0) {
      throw new Error(res.stderr || "extract_text failed");
    }
    if (!flags.markdown && isHwpx) {
      const parsed = JSON.parse(res.stdout);
      parsed.tablesHierarchy = await parseHwpxTablesHierarchy(fs.readFileSync(targetFile));
      console.log(JSON.stringify(parsed, null, 2));
    } else {
      console.log(res.stdout.trim());
    }
    return;
  }

  if (subcommand === "layout-check") {
    const targetFile = resolveTargetFile(positional[1], flags.file);
    const report = await runLayoutCheck(targetFile);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (subcommand === "lint-ops") {
    const rawOps = flags["ops-file"]
      ? fs.readFileSync(path.resolve(String(flags["ops-file"])), "utf8")
      : String(flags.ops || "[]");
    const parsedOps = JSON.parse(rawOps);
    const opsArray = Array.isArray(parsedOps) ? parsedOps : parsedOps.operations || [];
    let tablesMeta = [];
    let isHwpx = true;
    const candidateFile = positional[1] || flags.file || process.env.HWP_STAGING_PATH;
    if (candidateFile && fs.existsSync(candidateFile)) {
      isHwpx = /\.hwpx$/i.test(candidateFile);
      if (isHwpx) {
        tablesMeta = await parseHwpxTablesHierarchy(fs.readFileSync(candidateFile));
      }
    }
    const lintResult = lintOperations(opsArray, tablesMeta, isHwpx);
    console.log(JSON.stringify(lintResult, null, 2));
    if (!lintResult.valid) process.exitCode = 1;
    return;
  }

  if (subcommand === "edit") {
    const targetFile = resolveTargetFile(positional[1], flags.file);
    const isHwpx = /\.hwpx$/i.test(targetFile);
    const rawOps = flags["ops-file"]
      ? fs.readFileSync(path.resolve(String(flags["ops-file"])), "utf8")
      : String(flags.ops || "");
    if (!rawOps) {
      throw new Error("--ops '<json>' 또는 --ops-file <path> 인자가 필요합니다.");
    }
    const parsed = JSON.parse(rawOps);
    const opsArray = Array.isArray(parsed) ? parsed : parsed.operations || [];
    const tablesMeta = isHwpx ? await parseHwpxTablesHierarchy(fs.readFileSync(targetFile)) : [];

    const lintResult = lintOperations(opsArray, tablesMeta, isHwpx);
    if (!lintResult.valid) {
      console.error(JSON.stringify({ ok: false, stage: "policy-guard", ...lintResult }, null, 2));
      process.exitCode = 1;
      return;
    }

    const translated = translateOpsToEnginePayload(targetFile, isHwpx, opsArray, tablesMeta);
    const scriptName = isHwpx ? "hwpx-edit.js" : "cell-patch.js";
    const execRes = await runNodeScript(
      path.join(CLAW_SCRIPTS_DIR, scriptName),
      [],
      JSON.stringify(translated.payload)
    );
    let engineOut = null;
    try {
      engineOut = JSON.parse(execRes.stdout.trim());
    } catch {
      engineOut = { raw: execRes.stdout.trim() };
    }
    if (execRes.code !== 0 || engineOut?.error) {
      console.error(JSON.stringify({ ok: false, stage: "engine", engineOut, stderr: execRes.stderr }, null, 2));
      process.exitCode = 1;
      return;
    }

    const layoutReport = await runLayoutCheck(targetFile);
    console.log(
      JSON.stringify(
        {
          ok: true,
          file: targetFile,
          appliedOps: opsArray.length,
          engineResult: engineOut,
          layoutCheck: {
            pageCount: layoutReport.pageCount,
            tableCount: layoutReport.tableCount,
            nestedTableCount: layoutReport.nestedTableCount,
            overflowRiskCount: layoutReport.overflowRiskCount,
          },
        },
        null,
        2
      )
    );
    return;
  }

  if (subcommand === "nested-table") {
    const targetFile = resolveTargetFile(positional[1], flags.file);
    if (!/\.hwpx$/i.test(targetFile)) {
      throw new Error("중첩 표(nested-table) 삽입은 HWPX 문서에서만 지원됩니다.");
    }
    const tableIndex = Number(flags.table ?? 0);
    const row = Number(flags.row ?? 0);
    const col = Number(flags.col ?? 0);
    const rows = Number(flags.rows ?? 2);
    const cols = Number(flags.cols ?? 2);

    const payload = {
      file: targetFile,
      operations: [
        {
          op: "insert_nested_table",
          table: tableIndex,
          row,
          col,
          rows,
          cols,
          widthMode: "fit_cell",
        },
      ],
    };

    const execRes = await runNodeScript(
      path.join(CLAW_SCRIPTS_DIR, "hwpx-edit.js"),
      [],
      JSON.stringify(payload)
    );
    let engineOut = null;
    try {
      engineOut = JSON.parse(execRes.stdout.trim());
    } catch {
      engineOut = { raw: execRes.stdout.trim() };
    }
    if (execRes.code !== 0 || engineOut?.error) {
      throw new Error(`중첩 표 삽입 실패: ${execRes.stderr || JSON.stringify(engineOut)}`);
    }
    const tables = await parseHwpxTablesHierarchy(fs.readFileSync(targetFile));
    console.log(
      JSON.stringify(
        {
          ok: true,
          file: targetFile,
          insertedNestedTable: { parentTable: tableIndex, row, col, rows, cols },
          totalTables: tables.length,
          nestedTables: tables.filter((t) => t.depth > 0),
        },
        null,
        2
      )
    );
    return;
  }

  if (subcommand === "official-format") {
    const targetFile = resolveTargetFile(positional[1], flags.file);
    const report = await runOfficialFormat(targetFile, Boolean(flags.apply));
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (subcommand === "create") {
    const outPath = path.resolve(String(flags.output || positional[1] || "new_document.hwpx"));
    const isHwpx = /\.hwpx$/i.test(outPath);
    const title = String(flags.title || "새 공문서");
    const spec = flags.spec
      ? JSON.parse(String(flags.spec))
      : {
          format: isHwpx ? "hwpx" : "hwp",
          output: outPath,
          sections: [
            { type: "heading", level: 1, text: title },
            { type: "paragraph", text: "1. 추진 배경 및 목적" },
          ],
        };
    spec.output = outPath;
    const res = await runNodeScript(path.join(CLAW_SCRIPTS_DIR, "create.js"), [], JSON.stringify(spec));
    if (res.code !== 0) {
      throw new Error(res.stderr || res.stdout);
    }
    console.log(JSON.stringify({ ok: true, output: outPath, format: isHwpx ? "hwpx" : "hwp" }, null, 2));
    return;
  }

  if (subcommand === "unpack" || subcommand === "pack" || subcommand === "validate") {
    const pyScript = path.join(CLAW_SCRIPTS_DIR, `${subcommand}.py`);
    const pyArgs = positional.slice(1);
    const res = await runPythonScript(pyScript, pyArgs);
    if (res.code !== 0) {
      throw new Error(res.stderr || res.stdout);
    }
    console.log(res.stdout.trim() || JSON.stringify({ ok: true, command: subcommand }));
    return;
  }

  throw new Error(`알 수 없는 하위 명령입니다: ${subcommand} ('hwp-cli help'를 참고하세요)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
}
