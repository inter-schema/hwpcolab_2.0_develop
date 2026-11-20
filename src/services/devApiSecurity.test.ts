import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isAllowedDevApiRequest, resolveSafeStaticFile } from "./devApiSecurity";

describe("Dev API Host/Origin & Static Path Security Boundary", () => {
  let tmpRoot: string;
  let allowedDir: string;
  let secretFile: string;
  let validFile: string;
  let escapingSymlink: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hop-sec-static-"));
    allowedDir = path.join(tmpRoot, "allowed");
    fs.mkdirSync(allowedDir, { recursive: true });
    validFile = path.join(allowedDir, "Pretendard-Regular.woff2");
    fs.writeFileSync(validFile, Buffer.from("woff2-demo-bytes"));

    secretFile = path.join(tmpRoot, "outside-secret.txt");
    fs.writeFileSync(secretFile, "TOP_SECRET_OUTSIDE_ROOT");

    escapingSymlink = path.join(allowedDir, "escape.woff2");
    fs.symlinkSync(secretFile, escapingSymlink);
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("isAllowedDevApiRequest", () => {
    it("allows loopback localhost / 127.0.0.1 / [::1] same-origin requests", () => {
      expect(
        isAllowedDevApiRequest({
          host: "localhost:3000",
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        }).allowed
      ).toBe(true);

      expect(
        isAllowedDevApiRequest({
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
        }).allowed
      ).toBe(true);

      expect(
        isAllowedDevApiRequest({
          host: "[::1]:3000",
        }).allowed
      ).toBe(true);
    });

    it("rejects untrusted LAN IP Host headers by default", () => {
      const res = isAllowedDevApiRequest({
        host: "192.168.1.42:3000",
        origin: "http://192.168.1.42:3000",
      });
      expect(res.allowed).toBe(false);
    });

    it("rejects cross-origin CSRF requests targeting localhost", () => {
      const res = isAllowedDevApiRequest({
        host: "localhost:3000",
        origin: "https://evil.example.com",
      });
      expect(res.allowed).toBe(false);
    });

    it("rejects Sec-Fetch-Site: cross-site requests", () => {
      const res = isAllowedDevApiRequest({
        host: "localhost:3000",
        "sec-fetch-site": "cross-site",
      });
      expect(res.allowed).toBe(false);
    });

    it("rejects null Origin headers", () => {
      const res = isAllowedDevApiRequest({
        host: "localhost:3000",
        origin: "null",
      });
      expect(res.allowed).toBe(false);
    });
  });

  describe("resolveSafeStaticFile", () => {
    it("serves normal files inside the allowed root", () => {
      const res = resolveSafeStaticFile(allowedDir, "Pretendard-Regular.woff2?v=1");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.filePath).toBe(fs.realpathSync(validFile));
      }
    });

    it("blocks plain .. path traversal", () => {
      const res = resolveSafeStaticFile(allowedDir, "../outside-secret.txt");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(403);
    });

    it("blocks percent-encoded and double-encoded traversal", () => {
      const singleEnc = resolveSafeStaticFile(allowedDir, "%2e%2e%2foutside-secret.txt");
      expect(singleEnc.ok).toBe(false);

      const doubleEnc = resolveSafeStaticFile(allowedDir, "%252e%252e%252foutside-secret.txt");
      expect(doubleEnc.ok).toBe(false);
    });

    it("blocks backslashes, Windows drive letters, UNC paths, and malformed encoding", () => {
      expect(resolveSafeStaticFile(allowedDir, "..\\outside-secret.txt").ok).toBe(false);
      expect(resolveSafeStaticFile(allowedDir, "C:/Windows/win.ini").ok).toBe(false);
      expect(resolveSafeStaticFile(allowedDir, "//server/share/file.txt").ok).toBe(false);
      expect(resolveSafeStaticFile(allowedDir, "%E0%A4%A").ok).toBe(false);
    });

    it("blocks symlinks pointing outside the allowed root", () => {
      const res = resolveSafeStaticFile(allowedDir, "escape.woff2");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(403);
    });
  });
});
