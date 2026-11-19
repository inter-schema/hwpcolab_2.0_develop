import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getStagingDir(): string {
  const dir = path.join(os.tmpdir(), 'hop-staging');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function isZipHeader(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  );
}

function resolveRequestedPath(rawPath: string): string {
  if (!rawPath) return '';
  if (fs.existsSync(rawPath)) return rawPath;
  const workspaceCandidate = path.resolve(__dirname, rawPath.replace(/^\/+/, ''));
  if (fs.existsSync(workspaceCandidate)) return workspaceCandidate;
  return rawPath;
}

function runNodeScript(scriptPath: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile('node', [scriptPath, ...args], { cwd: __dirname, maxBuffer: 25 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? (err ? err.message : '')),
        code: err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0,
      });
    });
  });
}

function runNodeScriptWithStdin(
  scriptPath: string,
  stdinText: string
): Promise<{ ok: boolean; stdout_json: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      resolve({ ok: false, stdout_json: '', stderr: err.message });
    });
    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        stdout_json: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
    child.stdin.write(stdinText);
    child.stdin.end();
  });
}

function runAgentShellCommand(params: {
  command: string;
  stagingPath?: string;
  writingMemoryPath?: string;
  selectionJson?: string;
}): Promise<{
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  stagingModified: boolean;
  stagingMtimeMs: number;
}> {
  const startMs = Date.now();
  const stagingPath = params.stagingPath ? String(params.stagingPath) : '';
  const beforeMtime =
    stagingPath && fs.existsSync(stagingPath) ? Math.floor(fs.statSync(stagingPath).mtimeMs) : 0;

  const skillBinDir = path.resolve(__dirname, 'resources/skills/bin');
  for (const binName of ['hwp-cli', 'ref-extract']) {
    const binPath = path.join(skillBinDir, binName);
    try {
      if (fs.existsSync(binPath)) fs.chmodSync(binPath, 0o755);
    } catch {}
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${skillBinDir}${path.delimiter}${process.env.PATH || ''}`,
  };
  if (stagingPath) {
    env.HWP_STAGING_PATH = stagingPath;
  }
  if (params.writingMemoryPath) {
    env.HWP_WRITING_MEMORY_PATH = String(params.writingMemoryPath);
  }
  if (params.selectionJson) {
    env.HWP_SELECTION_JSON = String(params.selectionJson);
  }

  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', params.command], {
      cwd: __dirname,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      const afterMtime =
        stagingPath && fs.existsSync(stagingPath) ? Math.floor(fs.statSync(stagingPath).mtimeMs) : 0;
      resolve({
        ok: false,
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        durationMs: Date.now() - startMs,
        stagingModified: afterMtime > beforeMtime && beforeMtime > 0,
        stagingMtimeMs: afterMtime,
      });
    });
    child.on('close', (code) => {
      const afterMtime =
        stagingPath && fs.existsSync(stagingPath) ? Math.floor(fs.statSync(stagingPath).mtimeMs) : 0;
      resolve({
        ok: code === 0,
        exitCode: typeof code === 'number' ? code : 1,
        stdout,
        stderr,
        durationMs: Date.now() - startMs,
        stagingModified: afterMtime > beforeMtime && beforeMtime > 0,
        stagingMtimeMs: afterMtime,
      });
    });
  });
}

function hopClawBridgePlugin(): Plugin {
  const VIRTUAL_HWPCTRL_ID = '\0virtual:rhwp-hwpctrl-stub';
  return {
    name: 'hop-claw-dev-bridge',
    resolveId(id) {
      if (id === '@rhwp/hwpctrl/studio-plugin') {
        return VIRTUAL_HWPCTRL_ID;
      }
      return null;
    },
    load(id) {
      if (id === VIRTUAL_HWPCTRL_ID) {
        return 'export const hwpctrlStudioPlugin = null; export function installHwpCtrlStudioPlugin() { return null; } export default null;';
      }
      return null;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';

        if (url.startsWith('/fonts/')) {
          const rel = decodeURIComponent(url.replace(/^\/fonts\//, '').split('?')[0]);
          const fontFile = path.resolve(__dirname, 'assets/fonts', rel);
          if (fs.existsSync(fontFile) && fs.statSync(fontFile).isFile()) {
            res.setHeader('Content-Type', fontFile.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
            fs.createReadStream(fontFile).pipe(res);
            return;
          }
        }

        if (url.startsWith('/samples/')) {
          const rel = decodeURIComponent(url.replace(/^\/samples\//, '').split('?')[0]);
          const sampleFile = path.resolve(__dirname, 'samples', rel);
          if (fs.existsSync(sampleFile) && fs.statSync(sampleFile).isFile()) {
            res.setHeader('Content-Type', 'application/octet-stream');
            fs.createReadStream(sampleFile).pipe(res);
            return;
          }
        }

        if (!url.startsWith('/__hop_claw_api/')) {
          next();
          return;
        }

        const cmd = url.replace(/^\/__hop_claw_api\//, '').split('?')[0];
        let rawBody = '';
        req.on('data', (chunk) => {
          rawBody += String(chunk);
        });
        req.on('end', async () => {
          const sendJson = (status: number, payload: unknown) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
          };

          try {
            const args = rawBody ? JSON.parse(rawBody) : {};
            const stagingDir = getStagingDir();

            switch (cmd) {
              case 'get_startup_file': {
                sendJson(200, { ok: true, result: null });
                return;
              }

              case 'open_document_session': {
                const filePath = resolveRequestedPath(String(args.filePath || args.file_path || ''));
                if (!filePath || !fs.existsSync(filePath)) {
                  sendJson(400, { ok: false, error: `File not found: ${filePath}` });
                  return;
                }
                const bytes = fs.readFileSync(filePath);
                const fileName = path.basename(filePath);
                const ext = path.extname(fileName).toLowerCase();
                const isHwpx = ext === '.hwpx' || isZipHeader(bytes);
                const stagingName = `${Date.now()}_${fileName}`;
                const stagingPath = path.join(stagingDir, stagingName);
                fs.writeFileSync(stagingPath, bytes);
                sendJson(200, {
                  ok: true,
                  result: {
                    original_path: filePath,
                    staging_path: stagingPath,
                    file_name: fileName,
                    is_hwpx: isHwpx,
                    bytes: Array.from(bytes),
                  },
                });
                return;
              }

              case 'create_blank_session': {
                const isHwpx = args.isHwpx !== false;
                const fileName = String(args.fileName || (isHwpx ? '제목없음.hwpx' : '제목없음.hwp'));
                const stagingName = `${Date.now()}_${fileName}`;
                const stagingPath = path.join(stagingDir, stagingName);
                sendJson(200, {
                  ok: true,
                  result: {
                    original_path: '',
                    staging_path: stagingPath,
                    file_name: fileName,
                    is_hwpx: isHwpx,
                    bytes: [],
                  },
                });
                return;
              }

              case 'read_file_bytes':
              case 'read_attachment_bytes': {
                const filePath = resolveRequestedPath(String(args.filePath || args.file_path || ''));
                if (!filePath || !fs.existsSync(filePath)) {
                  sendJson(404, { ok: false, error: `File not found: ${filePath}` });
                  return;
                }
                const bytes = fs.readFileSync(filePath);
                sendJson(200, { ok: true, result: Array.from(bytes) });
                return;
              }

              case 'write_file_bytes': {
                const filePath = String(args.filePath || args.file_path || '');
                const bytesArr = Array.isArray(args.bytes) ? args.bytes : [];
                if (!filePath) {
                  sendJson(400, { ok: false, error: 'Missing filePath' });
                  return;
                }
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, Buffer.from(bytesArr));
                sendJson(200, { ok: true, result: null });
                return;
              }

              case 'commit_staging_to_original': {
                const stagingPath = String(args.stagingPath || args.staging_path || '');
                const originalPath = String(args.originalPath || args.original_path || '');
                if (!stagingPath || !fs.existsSync(stagingPath)) {
                  sendJson(400, { ok: false, error: `Staging file not found: ${stagingPath}` });
                  return;
                }
                const targetPath =
                  originalPath && originalPath.trim().length > 0
                    ? originalPath
                    : path.join(stagingDir, `saved_${path.basename(stagingPath)}`);
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                fs.copyFileSync(stagingPath, targetPath);
                sendJson(200, { ok: true, result: targetPath });
                return;
              }

              case 'check_staging_status': {
                const filePath = String(args.filePath || args.file_path || '');
                if (!filePath || !fs.existsSync(filePath)) {
                  sendJson(200, { ok: true, result: { exists: false, mtimeMs: 0, size: 0 } });
                  return;
                }
                const stat = fs.statSync(filePath);
                sendJson(200, {
                  ok: true,
                  result: {
                    exists: true,
                    mtimeMs: Math.floor(stat.mtimeMs),
                    size: stat.size,
                  },
                });
                return;
              }

              case 'sync_writing_memory_file': {
                const content = String(args.content ?? '');
                const memPath = path.join(stagingDir, 'active_writing_memory.md');
                fs.writeFileSync(memPath, content, 'utf-8');
                sendJson(200, { ok: true, result: memPath });
                return;
              }

              case 'inspect_document': {
                const filePath = resolveRequestedPath(String(args.filePath || args.file_path || ''));
                const script = path.resolve(__dirname, 'resources/claw-hwp/scripts/extract_text.js');
                const { stdout, stderr, code } = await runNodeScript(script, [filePath, '--inspect']);
                if (code !== 0) {
                  sendJson(500, { ok: false, error: stderr || `extract_text --inspect exited with ${code}` });
                  return;
                }
                const parsed = JSON.parse(stdout);
                sendJson(200, { ok: true, result: parsed });
                return;
              }

              case 'extract_markdown': {
                const filePath = resolveRequestedPath(String(args.filePath || args.file_path || ''));
                const script = path.resolve(__dirname, 'resources/claw-hwp/scripts/extract_text.js');
                const { stdout, stderr, code } = await runNodeScript(script, [filePath, '--format', 'markdown']);
                if (code !== 0) {
                  sendJson(500, { ok: false, error: stderr || `extract_text --format markdown exited with ${code}` });
                  return;
                }
                sendJson(200, { ok: true, result: stdout });
                return;
              }

              case 'execute_claw_ops': {
                const isHwpx = Boolean(args.isHwpx ?? args.is_hwpx ?? true);
                const payloadJson = String(args.payloadJson ?? args.payload_json ?? '{}');
                const script = path.resolve(
                  __dirname,
                  isHwpx
                    ? 'resources/claw-hwp/scripts/hwpx-edit.js'
                    : 'resources/claw-hwp/scripts/create.js'
                );
                const execRes = await runNodeScriptWithStdin(script, payloadJson);
                let parsedStdout: unknown = { status: execRes.ok ? 'success' : 'error', raw_stdout: execRes.stdout_json };
                try {
                  if (execRes.stdout_json) {
                    parsedStdout = JSON.parse(execRes.stdout_json);
                  }
                } catch {}
                sendJson(200, {
                  ok: true,
                  result: {
                    ok: execRes.ok,
                    stdout_json: parsedStdout,
                    stderr: execRes.stderr,
                  },
                });
                return;
              }

              case 'execute_agent_cli_command': {
                const command = String(args.command || '');
                const execRes = await runAgentShellCommand({
                  command,
                  stagingPath: args.stagingPath,
                  writingMemoryPath: args.writingMemoryPath,
                  selectionJson: args.selectionJson,
                });
                sendJson(200, { ok: true, result: execRes });
                return;
              }

              case 'list_local_fonts':
              case 'read_local_font': {
                sendJson(200, { ok: true, result: [] });
                return;
              }

              default: {
                sendJson(404, { ok: false, error: `Unknown HOP-Claw command: ${cmd}` });
                return;
              }
            }
          } catch (err: any) {
            sendJson(500, { ok: false, error: err?.message || String(err) });
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), hopClawBridgePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'third_party/rhwp/rhwp-studio/src'),
      '@wasm': path.resolve(__dirname, 'resources/claw-hwp/scripts/vendor/rhwp'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify('2.0.0'),
    __RHWP_DISABLE_EXTERNAL_WEBFONTS__: JSON.stringify(false),
    __RHWP_HWPCTRL__: JSON.stringify(false),
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
});
