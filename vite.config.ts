import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createHopOverrides } from "./hop-overrides";
import { handleFontAssetRequest } from "./src/hop-host/core/font-asset-middleware";

const WORKSPACE_ROOT = path.resolve(__dirname);
const HOP_HOST_SRC = path.resolve(WORKSPACE_ROOT, "src/hop-host");
const RHWP_STUDIO_SRC = path.resolve(WORKSPACE_ROOT, "third_party/rhwp/rhwp-studio/src");
const FONTS_DIR = path.resolve(WORKSPACE_ROOT, "assets/fonts");
const SAMPLES_DIR = path.resolve(WORKSPACE_ROOT, "samples");
const CLAW_SCRIPTS_DIR = path.resolve(WORKSPACE_ROOT, "resources/claw-hwp/scripts");
const SKILLS_DIR = path.resolve(WORKSPACE_ROOT, "resources/skills");
const SKILLS_BIN_DIR = path.resolve(SKILLS_DIR, "bin");

function getStagingDir(): string {
  const dir = path.join(os.tmpdir(), "hop_claw_staging");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function computeFileHash(filePath: string): { exists: boolean; mtimeMs: number; size: number; sha256: string } {
  if (!filePath || !fs.existsSync(filePath)) {
    return { exists: false, mtimeMs: 0, size: 0, sha256: "" };
  }
  const stat = fs.statSync(filePath);
  const bytes = fs.readFileSync(filePath);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  return {
    exists: true,
    mtimeMs: Math.round(stat.mtimeMs),
    size: stat.size,
    sha256,
  };
}

function runNodeScript(
  scriptPath: string,
  args: string[] = [],
  stdinData?: string,
  extraEnv?: Record<string, string>
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("node", [scriptPath, ...args], {
      cwd: WORKSPACE_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (d) => outChunks.push(Buffer.from(d)));
    child.stderr.on("data", (d) => errChunks.push(Buffer.from(d)));
    child.on("error", (err) => rejectPromise(err));
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 0,
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
      });
    });
    if (stdinData !== undefined) {
      child.stdin.write(stdinData);
    }
    child.stdin.end();
  });
}

function runShellCommand(
  commandLine: string,
  envVars: Record<string, string>,
  timeoutMs = 30000
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
  return new Promise((resolvePromise) => {
    const startTime = Date.now();
    const pathEnv = `${SKILLS_BIN_DIR}:${process.env.PATH || ""}`;
    const child = spawn("bash", ["-c", commandLine], {
      cwd: WORKSPACE_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...envVars,
        PATH: pathEnv,
        HWP_SKILLS_DIR: SKILLS_DIR,
        HWP_CLAW_SCRIPTS_DIR: CLAW_SCRIPTS_DIR,
        HWP_WORKSPACE_ROOT: WORKSPACE_ROOT,
      },
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (d) => outChunks.push(Buffer.from(d)));
    child.stderr.on("data", (d) => errChunks.push(Buffer.from(d)));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: 1,
        stdout: "",
        stderr: String(err.message || err),
        durationMs: Date.now() - startTime,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stderrStr = Buffer.concat(errChunks).toString("utf8");
      resolvePromise({
        exitCode: killed ? 124 : (code ?? 0),
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: killed ? `${stderrStr}\n[Timeout after ${timeoutMs}ms]` : stderrStr,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

function hopClawLocalBridgePlugin(): Plugin {
  const configure = (server: any) => {
    // 1. Serve /fonts/* from /assets/fonts/*
    server.middlewares.use("/fonts", (req: any, res: any, next: any) => {
      handleFontAssetRequest(FONTS_DIR, req.url, res, next);
    });

    // 2. Serve /samples/* from /samples/*
    server.middlewares.use("/samples", (req: any, res: any, next: any) => {
      const rawUrl = decodeURIComponent((req.url || "/").split("?")[0]);
      const safeRel = rawUrl.replace(/^\/+/, "");
      const candidate = path.resolve(SAMPLES_DIR, safeRel);
      if (!candidate.startsWith(SAMPLES_DIR) || !fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) {
        next();
        return;
      }
      res.setHeader("Content-Type", "application/octet-stream");
      res.end(fs.readFileSync(candidate));
    });

    // 3. Handle /__hop_claw_api/* RPC commands
    server.middlewares.use("/__hop_claw_api", (req: any, res: any) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }
      const cmd = decodeURIComponent((req.url || "").replace(/^\/+/, "").split("?")[0]);
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      req.on("end", async () => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        try {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          const args = rawBody ? JSON.parse(rawBody) : {};
          let result: any = null;

          switch (cmd) {
            case "get_startup_file": {
              result = process.env.HOP_STARTUP_FILE || null;
              break;
            }
            case "pick_local_file": {
              result = args.defaultPath || null;
              break;
            }
            case "get_workspace_info": {
              result = {
                workspaceRoot: WORKSPACE_ROOT,
                skillsDir: SKILLS_DIR,
                skillsBinDir: SKILLS_BIN_DIR,
                clawScriptsDir: CLAW_SCRIPTS_DIR,
                samplesDir: SAMPLES_DIR,
                stagingDir: getStagingDir(),
              };
              break;
            }
            case "list_sample_files": {
              const files = fs.existsSync(SAMPLES_DIR)
                ? fs.readdirSync(SAMPLES_DIR).filter((f) => /\.(hwp|hwpx|xlsx|docx|pdf)$/i.test(f))
                : [];
              result = files.map((f) => ({
                name: f,
                path: path.join(SAMPLES_DIR, f),
                isHwpx: /\.hwpx$/i.test(f),
              }));
              break;
            }
            case "create_staging_session": {
              const rawPath = String(args.originalPath || "");
              const resolvedOrig = path.isAbsolute(rawPath)
                ? rawPath
                : path.resolve(WORKSPACE_ROOT, rawPath);
              if (!fs.existsSync(resolvedOrig)) {
                throw new Error(`원본 파일이 존재하지 않습니다: ${resolvedOrig}`);
              }
              const fileName = path.basename(resolvedOrig);
              const isHwpx = /\.hwpx$/i.test(fileName);
              const ts = Date.now();
              const stagingPath = path.join(getStagingDir(), `staging_${ts}_${fileName}`);
              fs.copyFileSync(resolvedOrig, stagingPath);
              result = {
                original_path: resolvedOrig,
                staging_path: stagingPath,
                file_name: fileName,
                is_hwpx: isHwpx,
              };
              break;
            }
            case "create_blank_staging_session": {
              const rawFormat = String(args.format || "hwpx").toLowerCase();
              const isHwpx = rawFormat === "hwpx";
              const ext = isHwpx ? "hwpx" : "hwp";
              const ts = Date.now();
              const fileName = `새_문서_${ts}.${ext}`;
              const stagingPath = path.join(getStagingDir(), `staging_${ts}_${fileName}`);

              const createScript = path.join(CLAW_SCRIPTS_DIR, "create.js");
              const spec = JSON.stringify({
                format: ext,
                output: stagingPath,
                sections: [{ type: "paragraph", text: "" }],
              });
              const createRes = await runNodeScript(createScript, [], spec);
              if (createRes.code !== 0 || !fs.existsSync(stagingPath)) {
                const stubPath = path.join(CLAW_SCRIPTS_DIR, "templates/hancom_native_stub.hwpx");
                if (isHwpx && fs.existsSync(stubPath)) {
                  fs.copyFileSync(stubPath, stagingPath);
                } else {
                  throw new Error(`빈 문서 생성 실패: ${createRes.stderr || createRes.stdout}`);
                }
              }
              result = {
                original_path: "",
                staging_path: stagingPath,
                file_name: `새 문서.${ext}`,
                is_hwpx: isHwpx,
              };
              break;
            }
            case "read_file_bytes": {
              const targetPath = path.isAbsolute(String(args.filePath || ""))
                ? String(args.filePath)
                : path.resolve(WORKSPACE_ROOT, String(args.filePath || ""));
              if (!fs.existsSync(targetPath)) {
                throw new Error(`파일을 찾을 수 없습니다: ${targetPath}`);
              }
              const buf = fs.readFileSync(targetPath);
              result = Array.from(buf);
              break;
            }
            case "write_file_bytes": {
              const targetPath = path.isAbsolute(String(args.filePath || ""))
                ? String(args.filePath)
                : path.resolve(WORKSPACE_ROOT, String(args.filePath || ""));
              const dir = path.dirname(targetPath);
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
              }
              fs.writeFileSync(targetPath, Buffer.from(args.bytes || []));
              result = true;
              break;
            }
            case "commit_staging_to_original": {
              const stagingPath = String(args.stagingPath || "");
              let originalPath = String(args.originalPath || "").trim();
              if (!originalPath) {
                const fileName = path.basename(stagingPath).replace(/^staging_\d+_/, "");
                originalPath = path.join(getStagingDir(), `saved_${fileName}`);
              }
              fs.copyFileSync(stagingPath, originalPath);
              result = originalPath;
              break;
            }
            case "check_staging_status": {
              const stagingPath = String(args.stagingPath || "");
              result = computeFileHash(stagingPath);
              break;
            }
            case "extract_markdown": {
              const filePath = path.isAbsolute(String(args.filePath || ""))
                ? String(args.filePath)
                : path.resolve(WORKSPACE_ROOT, String(args.filePath || ""));
              const extractScript = path.join(CLAW_SCRIPTS_DIR, "extract_text.js");
              const resOut = await runNodeScript(extractScript, [filePath, "--markdown"]);
              if (resOut.code !== 0) {
                throw new Error(`extract_markdown failed: ${resOut.stderr}`);
              }
              result = resOut.stdout;
              break;
            }
            case "inspect_document": {
              const filePath = path.isAbsolute(String(args.filePath || ""))
                ? String(args.filePath)
                : path.resolve(WORKSPACE_ROOT, String(args.filePath || ""));
              const extractScript = path.join(CLAW_SCRIPTS_DIR, "extract_text.js");
              const resOut = await runNodeScript(extractScript, [filePath, "--json"]);
              if (resOut.code !== 0) {
                throw new Error(`inspect_document failed: ${resOut.stderr}`);
              }
              result = JSON.parse(resOut.stdout);
              break;
            }
            case "execute_claw_ops": {
              const isHwpx = Boolean(args.isHwpx);
              const payloadJson = String(args.payloadJson || "{}");
              const scriptName = isHwpx ? "hwpx-edit.js" : "cell-patch.js";
              const scriptPath = path.join(CLAW_SCRIPTS_DIR, scriptName);
              const resOut = await runNodeScript(scriptPath, [], payloadJson);
              let parsedJson: any = null;
              try {
                parsedJson = JSON.parse(resOut.stdout.trim());
              } catch {
                parsedJson = { raw: resOut.stdout.trim() };
              }
              result = {
                ok: resOut.code === 0 && parsedJson?.error === undefined,
                stdout_json: parsedJson,
                stderr: resOut.stderr,
              };
              break;
            }
            case "sync_writing_memory_file": {
              const content = String(args.content || "");
              const memPath = path.join(getStagingDir(), "active_writing_memory.md");
              fs.writeFileSync(memPath, content, "utf8");
              result = memPath;
              break;
            }
            case "execute_agent_cli_command": {
              const commandLine = String(args.commandLine || "").trim();
              const stagingPath = String(args.stagingPath || "");
              const originalPath = String(args.originalPath || "");
              const writingMemoryPath = String(args.writingMemoryPath || path.join(getStagingDir(), "active_writing_memory.md"));
              const selectionContextJson = String(args.selectionContextJson || "");
              const beforeHash = computeFileHash(stagingPath);

              const execRes = await runShellCommand(commandLine, {
                HWP_STAGING_PATH: stagingPath,
                HWP_ORIGINAL_PATH: originalPath,
                HWP_WRITING_MEMORY_PATH: writingMemoryPath,
                HWP_SELECTION_JSON: selectionContextJson,
              });
              const afterHash = computeFileHash(stagingPath);
              const stagingModified =
                beforeHash.exists &&
                afterHash.exists &&
                beforeHash.sha256 !== afterHash.sha256;

              result = {
                ...execRes,
                stagingModified,
                afterSha256: afterHash.sha256,
              };
              break;
            }
            default:
              throw new Error(`알 수 없는 브리지 명령: ${cmd}`);
          }

          res.statusCode = 200;
          res.end(JSON.stringify({ result }));
        } catch (err: any) {
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              __hop_error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      });
    });
  };

  return {
    name: "hop-claw-local-bridge",
    configureServer: configure,
    configurePreviewServer: configure,
  };
}

export default defineConfig({
  plugins: [react(), hopClawLocalBridgePlugin()],
  define: {
    __RHWP_HWPCTRL__: false,
  },
  resolve: {
    alias: [
      {
        find: "@/upstream",
        replacement: path.resolve(HOP_HOST_SRC, "upstream"),
      },
      ...createHopOverrides(HOP_HOST_SRC),
      {
        find: /^@\//,
        replacement: `${RHWP_STUDIO_SRC}/`,
      },
      {
        find: "@upstream",
        replacement: RHWP_STUDIO_SRC,
      },
      {
        find: "@wasm",
        replacement: path.resolve(WORKSPACE_ROOT, "public/vendor/rhwp"),
      },
    ],
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
    hmr: false,
  },
  preview: {
    port: 3000,
    host: "0.0.0.0",
  },
});
