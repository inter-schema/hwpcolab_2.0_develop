import { create } from "zustand";
import { runtimeInvoke as invoke } from "../core/runtimeInvoke";
import { hopBridge } from "../core/hopBridge";
import { UnifiedOp, DiffItem } from "../types/operations";
import { SelectionTarget, TableCoordinateMeta, OpenedDocSession, DirectEditingTarget } from "../types/hwp";
import { ExcludedRegion } from "../types/privacy";
import { OpTranslator } from "../core/opTranslator";
import { buildTablesMetaForHwpx, mapInspectedTables } from "../core/hwpxTableIndex";
import { ParsedAttachment } from "../core/multiFileParser";
import { PrivacySessionMasker } from "../core/privacyMasker";
import { maskHwpxPackageBytes, unmaskHwpxPackageBytes } from "../core/hwpxPiiBridge";
import { mapSelectionFromHopContext } from "../core/hitTestSelection";
import type { MemoryMeta } from "../memory/index.ts";
import { createMemoryStore, buildMemoryContext } from "../memory/index.ts";
import { compareDocuments } from "@/compare/diff-engine";
import type { CompareSession, DiffKind } from "@/compare/types";

export { type DiffItem };

export type ProviderId = string;
export type AgentLoopMode = "legacy" | "v2";
export type CliPresetId = "claude" | "gemini" | "codex" | "hwp-shell" | string;

export interface CustomCliPreset {
  id: string;
  label: string;
  commandPrefix: string;
}

export interface CliTerminalTab {
  id: string;
  title: string;
  preset: CliPresetId;
}

export interface CliTerminalLogEntry {
  id: string;
  tabId?: string;
  timestamp: number;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  preset: CliPresetId;
}

export interface AgentLogStats {
  docChecks: number;
  pagesRead: number;
  editsCount: number;
  details: string[];
}

const DEFAULT_COMPARE_KINDS: DiffKind[] = [
  "text",
  "table",
  "shape",
  "image",
  "chart",
  "paragraphMeta",
];

interface DocState {
  originalPath: string | null;
  stagingPath: string | null;
  fileName: string;
  isHwpx: boolean;
  isDirty: boolean;
  isHopDirectDirty: boolean;
  fileBytes: Uint8Array | null;
  baselineBytes: Uint8Array | null;
  lastKnownStagingMtimeMs: number;
  undoHistoryBytes: Uint8Array[];
  tablesMeta: TableCoordinateMeta[];
  selection: SelectionTarget | null;
  editingTarget: DirectEditingTarget | null;
  excludedRegions: ExcludedRegion[];
  autoMaskPii: boolean;
  pendingDiffs: DiffItem[];
  stagingDiffSession: CompareSession | null;
  stagingDiffBytes: Uint8Array | null;
  stagingDiffLoading: boolean;
  zoom: number;
  currentPage: number;
  pageCount: number;
  docMarkdown: string;
  attachments: ParsedAttachment[];

  // Dockable Agent CLI Panel State
  cliPanelOpen: boolean;
  cliPanelDock: "right" | "bottom";
  cliPanelWidth: number;
  cliPanelHeight: number;
  activeCliPreset: CliPresetId;
  customCliPresets: CustomCliPreset[];
  cliTabs: CliTerminalTab[];
  activeCliTabId: string;
  cliHistory: CliTerminalLogEntry[];
  cliRunning: boolean;
  writingMemoryFilePath: string | null;
  selectionContextPath: string | null;
  toastMessage: string | null;

  // Legacy aliases kept for backwards test compatibility
  sidebarOpen: boolean;
  sidebarDock: "left" | "right";
  sidebarWidth: number;
  licenseModalOpen: boolean;
  piiModalOpen: boolean;
  aiApplyMode: "diff_review" | "immediate";
  settingsModalOpen: boolean;
  provider: ProviderId;
  apiKey: string;
  model: string;
  customEndpoint: string;
  reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh";
  sessionMasker: PrivacySessionMasker;
  agentLoopMode: AgentLoopMode;
  customName: string;
  customSupportsTools: boolean;
  customSendReasoning: boolean;

  memoryModalOpen: boolean;
  memoryModalInitialTab: "list" | "create_multi" | "create_current";
  memoriesIndex: MemoryMeta[];
  activeMemoryIds: string[];

  // Actions
  setCliPanelOpen: (open: boolean) => void;
  toggleCliPanel: () => void;
  setCliPanelDock: (dock: "right" | "bottom") => void;
  toggleCliPanelDock: () => void;
  setCliPanelWidth: (width: number) => void;
  setCliPanelHeight: (height: number) => void;
  setActiveCliPreset: (preset: CliPresetId) => void;
  addCustomCliPreset: (label: string, commandPrefix: string) => void;
  removeCustomCliPreset: (id: string) => void;
  addCliTab: (preset?: CliPresetId) => void;
  closeCliTab: (tabId: string) => void;
  setActiveCliTab: (tabId: string) => void;
  clearCliHistory: () => void;
  runCliCommand: (command: string, preset?: CliPresetId) => Promise<CliTerminalLogEntry>;
  runSkillCommand: (
    skill: "ref-extract" | "hwp-cli",
    args: string[],
    displayCommand?: string
  ) => Promise<CliTerminalLogEntry>;
  syncWritingMemoryFileToDisk: (maskedOverride?: boolean) => Promise<string | null>;
  syncWritingMemoryEnvFile: () => Promise<string | null>;
  showToastMessage: (msg: string | null) => void;
  checkExternalStagingModification: (forceCompare?: boolean) => Promise<boolean>;
  acceptStagingDiff: () => Promise<void>;
  rejectStagingDiff: () => Promise<void>;

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarDock: (dock: "left" | "right") => void;
  toggleSidebarDock: () => void;
  setSidebarWidth: (width: number) => void;
  setLicenseModalOpen: (open: boolean) => void;
  setPiiModalOpen: (open: boolean) => void;
  setAiApplyMode: (mode: "diff_review" | "immediate") => void;
  setSettingsModalOpen: (open: boolean) => void;
  setReasoningEffort: (effort: "none" | "low" | "medium" | "high" | "xhigh") => void;
  setAgentLoopMode: (mode: AgentLoopMode) => void;
  setProviderSettings: (settings: {
    provider?: ProviderId;
    apiKey?: string;
    model?: string;
    customEndpoint?: string;
    customName?: string;
    customSupportsTools?: boolean;
    customSendReasoning?: boolean;
    agentLoopMode?: AgentLoopMode;
  }) => void;
  setZoom: (zoom: number) => void;
  setCurrentPage: (page: number) => void;
  setPageCount: (count: number) => void;
  setTablesMeta: (meta: TableCoordinateMeta[]) => void;
  setSelection: (sel: SelectionTarget | null) => void;
  setEditingTarget: (target: DirectEditingTarget | null) => void;
  markHopDirectEdited: () => void;
  syncHopToStaging: () => Promise<void>;
  applyHumanCellEdit: (tableIndex: number, row: number, col: number, newText: string) => Promise<void>;
  applyHumanParagraphEdit: (sec: number, para: number, newText: string, oldText: string) => Promise<void>;
  applyHumanInsertParagraph: (text: string) => Promise<void>;
  applyHumanNestedTableInsert: (
    tableIndex: number,
    row: number,
    col: number,
    rows: number,
    cols: number
  ) => Promise<void>;
  insertNestedTableAtCurrentCell: (rows: number, cols: number) => Promise<boolean>;
  setAutoMaskPii: (autoMask: boolean) => void;
  toggleExcludeSelection: () => void;
  removeExcludedRegion: (id: string) => void;
  clearExcludedRegions: () => void;
  addAttachment: (att: ParsedAttachment) => void;
  removeAttachment: (id: string) => void;

  openDocument: (filePath: string) => Promise<void>;
  openDocumentBytes: (bytes: Uint8Array, fileName: string, originalPath?: string) => Promise<void>;
  adoptHopDocument: (info: { fileName: string; sourceBytes: Uint8Array | null }) => Promise<void>;
  createBlankDocument: (isHwpx: boolean) => Promise<void>;
  refreshDocMarkdown: () => Promise<void>;
  addProposedDiffs: (items: DiffItem[]) => Promise<void>;
  acceptDiffItem: (diffId: string) => Promise<void>;
  rejectDiffItem: (diffId: string) => void;
  acceptAllDiffs: () => Promise<void>;
  rejectAllDiffs: () => void;
  undoLastChange: () => Promise<void>;
  saveToOriginalFile: () => Promise<void>;

  openMemoryModal: (tab?: "list" | "create_multi" | "create_current") => void;
  closeMemoryModal: () => void;
  refreshMemoriesIndex: () => Promise<void>;
  toggleActiveMemory: (id: string) => void;
  moveActiveMemoryPriority: (id: string, direction: "up" | "down") => void;
  clearActiveMemories: () => void;
}

function areByteArraysEqual(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b) return false;
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const useDocStore = create<DocState>((set, get) => ({
  originalPath: null,
  stagingPath: null,
  fileName: "열린 문서 없음",
  isHwpx: true,
  isDirty: false,
  isHopDirectDirty: false,
  fileBytes: null,
  baselineBytes: null,
  lastKnownStagingMtimeMs: 0,
  undoHistoryBytes: [],
  tablesMeta: [],
  selection: null,
  editingTarget: null,
  excludedRegions: [],
  autoMaskPii: false,
  pendingDiffs: [],
  stagingDiffSession: null,
  stagingDiffBytes: null,
  stagingDiffLoading: false,
  zoom: 1.0,
  currentPage: 1,
  pageCount: 1,
  docMarkdown: "",
  attachments: [],

  cliPanelOpen: true,
  cliPanelDock:
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem("hop_cli_dock") as "right" | "bottom")) ||
    "right",
  cliPanelWidth:
    typeof localStorage !== "undefined"
      ? Math.min(900, Math.max(320, Number(localStorage.getItem("hop_cli_width")) || 440))
      : 440,
  cliPanelHeight:
    typeof localStorage !== "undefined"
      ? Math.min(600, Math.max(200, Number(localStorage.getItem("hop_cli_height")) || 280))
      : 280,
  activeCliPreset:
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem("hop_cli_preset") as CliPresetId)) ||
    "claude",
  customCliPresets: (() => {
    if (typeof localStorage === "undefined") return [];
    try {
      const raw = localStorage.getItem("hop_custom_cli_presets_v2");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  })(),
  cliTabs: [{ id: "tab-1", title: "세션 1", preset: "claude" }],
  activeCliTabId: "tab-1",
  cliHistory: [],
  cliRunning: false,
  writingMemoryFilePath: null,
  selectionContextPath: null,
  toastMessage: null,

  sidebarOpen: true,
  sidebarDock: "right",
  sidebarWidth: 440,
  licenseModalOpen: false,
  piiModalOpen: false,
  aiApplyMode: "diff_review",
  settingsModalOpen: false,
  provider: "baze",
  apiKey: "",
  model: "gpt-6-luna",
  customEndpoint: "",
  reasoningEffort: "high",
  sessionMasker: new PrivacySessionMasker(),
  agentLoopMode: "legacy",
  customName: "사용자 지정",
  customSupportsTools: true,
  customSendReasoning: false,
  memoryModalOpen: false,
  memoryModalInitialTab: "list",
  memoriesIndex: [],
  activeMemoryIds: [],

  setCliPanelOpen: (cliPanelOpen) => set({ cliPanelOpen, sidebarOpen: cliPanelOpen }),
  toggleCliPanel: () =>
    set((s) => ({ cliPanelOpen: !s.cliPanelOpen, sidebarOpen: !s.cliPanelOpen })),
  setCliPanelDock: (cliPanelDock) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("hop_cli_dock", cliPanelDock);
    }
    set({ cliPanelDock });
  },
  toggleCliPanelDock: () => {
    const next = get().cliPanelDock === "right" ? "bottom" : "right";
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("hop_cli_dock", next);
    }
    set({ cliPanelDock: next });
  },
  setCliPanelWidth: (width: number) => {
    const maxW = Math.min(1000, typeof window !== "undefined" ? Math.floor(window.innerWidth * 0.65) : 860);
    const clamped = Math.min(maxW, Math.max(320, width));
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("hop_cli_width", String(clamped));
    }
    set({ cliPanelWidth: clamped, sidebarWidth: clamped });
  },
  setCliPanelHeight: (height: number) => {
    const maxH = Math.min(680, typeof window !== "undefined" ? Math.floor(window.innerHeight * 0.62) : 560);
    const clamped = Math.min(maxH, Math.max(190, height));
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("hop_cli_height", String(clamped));
    }
    set({ cliPanelHeight: clamped });
  },
  setActiveCliPreset: (activeCliPreset) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("hop_cli_preset", activeCliPreset);
    }
    set((s) => ({
      activeCliPreset,
      cliTabs: s.cliTabs.map((t) =>
        t.id === s.activeCliTabId ? { ...t, preset: activeCliPreset } : t
      ),
    }));
  },
  addCustomCliPreset: (label, commandPrefix) => {
    const trimmedLabel = label.trim();
    const trimmedCmd = commandPrefix.trim();
    if (!trimmedLabel || !trimmedCmd) return;
    const newPreset: CustomCliPreset = {
      id: `custom-${Date.now()}`,
      label: trimmedLabel,
      commandPrefix: trimmedCmd,
    };
    const next = [...get().customCliPresets, newPreset];
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("hop_custom_cli_presets_v2", JSON.stringify(next));
    }
    set({ customCliPresets: next, activeCliPreset: newPreset.id });
  },
  removeCustomCliPreset: (id) => {
    const next = get().customCliPresets.filter((p) => p.id !== id);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("hop_custom_cli_presets_v2", JSON.stringify(next));
    }
    set((s) => ({
      customCliPresets: next,
      activeCliPreset: s.activeCliPreset === id ? "claude" : s.activeCliPreset,
    }));
  },
  addCliTab: (preset) => {
    const usedPreset = preset || get().activeCliPreset;
    const nextIdx = get().cliTabs.length + 1;
    const newTab: CliTerminalTab = {
      id: `tab-${Date.now()}`,
      title: `세션 ${nextIdx}`,
      preset: usedPreset,
    };
    set((s) => ({
      cliTabs: [...s.cliTabs, newTab],
      activeCliTabId: newTab.id,
      activeCliPreset: usedPreset,
    }));
  },
  closeCliTab: (tabId) => {
    const { cliTabs, activeCliTabId } = get();
    if (cliTabs.length <= 1) return;
    const remaining = cliTabs.filter((t) => t.id !== tabId);
    const nextActive =
      activeCliTabId === tabId ? remaining[remaining.length - 1] : remaining.find((t) => t.id === activeCliTabId) || remaining[0];
    set((s) => ({
      cliTabs: remaining,
      activeCliTabId: nextActive.id,
      activeCliPreset: nextActive.preset,
      cliHistory: s.cliHistory.filter((h) => h.tabId !== tabId),
    }));
  },
  setActiveCliTab: (tabId) => {
    const target = get().cliTabs.find((t) => t.id === tabId);
    if (!target) return;
    set({ activeCliTabId: tabId, activeCliPreset: target.preset });
  },
  clearCliHistory: () =>
    set((s) => ({
      cliHistory: s.cliHistory.filter((h) => h.tabId && h.tabId !== s.activeCliTabId),
    })),
  showToastMessage: (toastMessage) => set({ toastMessage }),
  syncWritingMemoryEnvFile: async () => get().syncWritingMemoryFileToDisk(),

  syncWritingMemoryFileToDisk: async (maskedOverride?: boolean) => {
    try {
      const store = createMemoryStore();
      const { activeMemoryIds, autoMaskPii, excludedRegions, sessionMasker } = get();
      const shouldMask = maskedOverride ?? autoMaskPii;
      const activeDocs: any[] = [];
      for (const id of activeMemoryIds) {
        const doc = await store.get(id);
        if (doc) activeDocs.push(doc);
      }
      const rawMarkdown =
        activeDocs.length > 0
          ? buildMemoryContext(activeDocs).text
          : "# 활성화된 작성 메모리가 없습니다.\n";
      const content = shouldMask
        ? sessionMasker.maskTextForPrompt(rawMarkdown, excludedRegions, true)
        : rawMarkdown;
      const filePath = await invoke<string>("sync_writing_memory_file", {
        content,
        masked: shouldMask,
      });
      set({ writingMemoryFilePath: filePath });
      return filePath;
    } catch (err) {
      console.warn("[DocStore] syncWritingMemoryFileToDisk skipped:", err);
      return null;
    }
  },

  runCliCommand: async (command: string, preset?: CliPresetId) => {
    const trimmed = command.trim();
    const usedPreset = preset || get().activeCliPreset;
    await get().syncHopToStaging();
    const { stagingPath, isHwpx, selection, excludedRegions, autoMaskPii, sessionMasker } = get();
    const memoryPath = await get().syncWritingMemoryFileToDisk(autoMaskPii);

    set({ cliRunning: true });
    let effectiveStagingPath = stagingPath || "";
    let maskedCopyPath: string | null = null;
    let excludedCellSnapshots: Record<string, string> = {};

    try {
      // When PII Protection Mode is ON, create a masked temporary HWPX copy so external CLIs
      // never directly read unmasked PII or excluded cell content from $HWP_STAGING_PATH.
      if (autoMaskPii && stagingPath && isHwpx) {
        try {
          const rawBytesArr = await invoke<number[]>("read_file_bytes", { filePath: stagingPath });
          const rawBytes = new Uint8Array(rawBytesArr);
          const { maskedBytes, excludedCellSnapshots: snapshots } = maskHwpxPackageBytes(
            rawBytes,
            sessionMasker,
            excludedRegions,
            true
          );
          maskedCopyPath = `${stagingPath}.masked.hwpx`;
          excludedCellSnapshots = snapshots;
          await invoke("write_file_bytes", {
            filePath: maskedCopyPath,
            bytes: Array.from(maskedBytes),
          });
          effectiveStagingPath = maskedCopyPath;
        } catch (maskErr) {
          console.warn("[DocStore] Failed to create masked staging copy:", maskErr);
          maskedCopyPath = null;
        }
      }

      const selectionPayload = selection
        ? {
            ...selection,
            excludedRegionsCount: excludedRegions.length,
            autoMaskPii,
          }
        : null;

      // Mask PII tokens in command if autoMaskPii is enabled
      const finalCommand =
        autoMaskPii || excludedRegions.length > 0
          ? sessionMasker.maskTextForPrompt(trimmed, excludedRegions, autoMaskPii)
          : trimmed;

      const res = await invoke<{
        ok: boolean;
        exitCode: number;
        stdout: string;
        stderr: string;
        durationMs: number;
        stagingModified?: boolean;
        stagingMtimeMs?: number;
      }>("execute_agent_cli_command", {
        command: finalCommand,
        stagingPath: effectiveStagingPath,
        writingMemoryPath: memoryPath || "",
        selectionJson: selectionPayload ? JSON.stringify(selectionPayload) : "",
      });

      // If CLI modified the masked staging copy, restore PII tokens & revert any excluded-cell edits
      // into the real staging file before running Visual Diff Review.
      let stagingUpdated = Boolean(res.stagingModified);
      if (maskedCopyPath && stagingPath && res.stagingModified) {
        try {
          const editedMaskedArr = await invoke<number[]>("read_file_bytes", {
            filePath: maskedCopyPath,
          });
          const { restoredBytes, revertedExcludedCells } = unmaskHwpxPackageBytes(
            new Uint8Array(editedMaskedArr),
            sessionMasker,
            excludedCellSnapshots
          );
          await invoke("write_file_bytes", {
            filePath: stagingPath,
            bytes: Array.from(restoredBytes),
          });
          stagingUpdated = true;
          if (revertedExcludedCells.length > 0) {
            get().showToastMessage(
              `보호 제외 셀 ${revertedExcludedCells.length}곳의 변경을 차단하고 원래 내용을 유지했습니다.`
            );
          }
        } catch (restoreErr) {
          console.warn("[DocStore] Failed to unmask edited staging copy:", restoreErr);
        }
      }

      const entry: CliTerminalLogEntry = {
        id: crypto.randomUUID(),
        tabId: get().activeCliTabId,
        timestamp: Date.now(),
        command: trimmed,
        stdout: res.stdout || "",
        stderr: res.stderr || "",
        exitCode: typeof res.exitCode === "number" ? res.exitCode : res.ok ? 0 : 1,
        durationMs: res.durationMs || 0,
        preset: usedPreset,
      };

      set((s) => ({
        cliHistory: [...s.cliHistory, entry],
        cliRunning: false,
      }));

      // Automatically inspect if staging file was modified by the CLI command
      await get().checkExternalStagingModification(stagingUpdated);
      return entry;
    } catch (err: any) {
      const entry: CliTerminalLogEntry = {
        id: crypto.randomUUID(),
        tabId: get().activeCliTabId,
        timestamp: Date.now(),
        command: trimmed,
        stdout: "",
        stderr: String(err?.message || err),
        exitCode: 1,
        durationMs: 0,
        preset: usedPreset,
      };
      set((s) => ({
        cliHistory: [...s.cliHistory, entry],
        cliRunning: false,
      }));
      return entry;
    }
  },

  runSkillCommand: async (
    skill: "ref-extract" | "hwp-cli",
    args: string[],
    displayCommand?: string
  ) => {
    await get().syncHopToStaging();
    const { stagingPath, isHwpx, selection, excludedRegions, autoMaskPii, sessionMasker } = get();
    const memoryPath = await get().syncWritingMemoryFileToDisk(autoMaskPii);
    const label = displayCommand || `${skill} ${args.join(" ")}`;

    set({ cliRunning: true });
    let effectiveStagingPath = stagingPath || "";
    let maskedCopyPath: string | null = null;
    let excludedCellSnapshots: Record<string, string> = {};

    try {
      if (skill === "hwp-cli" && autoMaskPii && stagingPath && isHwpx) {
        try {
          const rawBytesArr = await invoke<number[]>("read_file_bytes", { filePath: stagingPath });
          const { maskedBytes, excludedCellSnapshots: snapshots } = maskHwpxPackageBytes(
            new Uint8Array(rawBytesArr),
            sessionMasker,
            excludedRegions,
            true
          );
          maskedCopyPath = `${stagingPath}.masked.hwpx`;
          excludedCellSnapshots = snapshots;
          await invoke("write_file_bytes", {
            filePath: maskedCopyPath,
            bytes: Array.from(maskedBytes),
          });
          effectiveStagingPath = maskedCopyPath;
        } catch (maskErr) {
          console.warn("[DocStore] Failed to create masked staging copy for skill:", maskErr);
          maskedCopyPath = null;
        }
      }

      // Substitute $HWP_STAGING_PATH sentinel safely inside argument array without shell expansion
      const resolvedArgs = args.map((a) =>
        a === "$HWP_STAGING_PATH" ? effectiveStagingPath : a
      );

      const selectionPayload = selection
        ? {
            ...selection,
            excludedRegionsCount: excludedRegions.length,
            autoMaskPii,
          }
        : null;

      const res = await invoke<{
        ok: boolean;
        exitCode: number;
        stdout: string;
        stderr: string;
        durationMs: number;
        stagingModified?: boolean;
        stagingMtimeMs?: number;
      }>("execute_skill_command", {
        skill,
        args: resolvedArgs,
        stagingPath: effectiveStagingPath,
        writingMemoryPath: memoryPath || "",
        selectionJson: selectionPayload ? JSON.stringify(selectionPayload) : "",
      });

      let stagingUpdated = Boolean(res.stagingModified);
      if (maskedCopyPath && stagingPath && res.stagingModified) {
        try {
          const editedMaskedArr = await invoke<number[]>("read_file_bytes", {
            filePath: maskedCopyPath,
          });
          const { restoredBytes, revertedExcludedCells } = unmaskHwpxPackageBytes(
            new Uint8Array(editedMaskedArr),
            sessionMasker,
            excludedCellSnapshots
          );
          await invoke("write_file_bytes", {
            filePath: stagingPath,
            bytes: Array.from(restoredBytes),
          });
          stagingUpdated = true;
          if (revertedExcludedCells.length > 0) {
            get().showToastMessage(
              `보호 제외 셀 ${revertedExcludedCells.length}곳의 변경을 차단하고 원래 내용을 유지했습니다.`
            );
          }
        } catch (restoreErr) {
          console.warn("[DocStore] Failed to unmask edited skill staging copy:", restoreErr);
        }
      }

      const entry: CliTerminalLogEntry = {
        id: crypto.randomUUID(),
        tabId: get().activeCliTabId,
        timestamp: Date.now(),
        command: label,
        stdout: res.stdout || "",
        stderr: res.stderr || "",
        exitCode: typeof res.exitCode === "number" ? res.exitCode : res.ok ? 0 : 1,
        durationMs: res.durationMs || 0,
        preset: "hwp-shell",
      };

      set((s) => ({
        cliHistory: [...s.cliHistory, entry],
        cliRunning: false,
      }));

      if (skill === "hwp-cli") {
        await get().checkExternalStagingModification(stagingUpdated);
      }
      return entry;
    } catch (err: any) {
      const entry: CliTerminalLogEntry = {
        id: crypto.randomUUID(),
        tabId: get().activeCliTabId,
        timestamp: Date.now(),
        command: label,
        stdout: "",
        stderr: String(err?.message || err),
        exitCode: 1,
        durationMs: 0,
        preset: "hwp-shell",
      };
      set((s) => ({
        cliHistory: [...s.cliHistory, entry],
        cliRunning: false,
      }));
      return entry;
    }
  },

  checkExternalStagingModification: async (forceCompare = false) => {
    const { stagingPath, baselineBytes, fileBytes, fileName, lastKnownStagingMtimeMs, stagingDiffLoading } = get();
    if (!stagingPath || stagingDiffLoading) return false;

    try {
      const status = await invoke<{ exists: boolean; mtimeMs: number; size: number }>(
        "check_staging_status",
        { filePath: stagingPath }
      );
      if (!status?.exists) return false;

      if (!forceCompare && lastKnownStagingMtimeMs > 0 && status.mtimeMs <= lastKnownStagingMtimeMs) {
        return false;
      }

      const rawArr = await invoke<number[]>("read_file_bytes", { filePath: stagingPath });
      const currentStagingBytes = new Uint8Array(rawArr);
      const base = baselineBytes || fileBytes;

      set({ lastKnownStagingMtimeMs: status.mtimeMs });

      if (!base || areByteArraysEqual(base, currentStagingBytes)) {
        return false;
      }

      set({ stagingDiffLoading: true });
      const session = await compareDocuments(
        base,
        `${fileName} (원본)`,
        currentStagingBytes,
        `${fileName} (에이전트 CLI 수정본)`,
        {
          caseSensitive: true,
          ignoreWhitespace: false,
          kinds: DEFAULT_COMPARE_KINDS,
          strategy: "alignment",
        }
      );

      set({
        stagingDiffSession: session,
        stagingDiffBytes: currentStagingBytes,
        stagingDiffLoading: false,
      });

      if (get().aiApplyMode === "immediate") {
        await get().acceptStagingDiff();
      }
      return true;
    } catch (err) {
      console.warn("[DocStore] checkExternalStagingModification error:", err);
      set({ stagingDiffLoading: false });
      return false;
    }
  },

  acceptStagingDiff: async () => {
    const { stagingPath, stagingDiffBytes, fileBytes, undoHistoryBytes, fileName, sessionMasker } = get();
    if (!stagingDiffBytes) {
      set({ stagingDiffSession: null, stagingDiffBytes: null });
      return;
    }

    const isHwpx =
      stagingDiffBytes.length >= 4 &&
      stagingDiffBytes[0] === 0x50 &&
      stagingDiffBytes[1] === 0x4b &&
      stagingDiffBytes[2] === 0x03 &&
      stagingDiffBytes[3] === 0x04;

    let finalBytes = stagingDiffBytes;

    // If PII masking tokens exist in the session, restore any [[PII_*]] / [[AI_EXCLUDED_*]] tokens safely
    if (isHwpx && sessionMasker.getTokenMap().length > 0) {
      try {
        const { restoredBytes, restoredNodeCount } = unmaskHwpxPackageBytes(
          stagingDiffBytes,
          sessionMasker
        );
        if (restoredNodeCount > 0) {
          finalBytes = restoredBytes;
          if (stagingPath) {
            await invoke("write_file_bytes", {
              filePath: stagingPath,
              bytes: Array.from(finalBytes),
            });
          }
        }
      } catch (err) {
        console.warn("[DocStore] PII unmasking on diff accept skipped:", err);
      }
    }

    set({
      fileBytes: finalBytes,
      baselineBytes: finalBytes,
      isHwpx,
      isDirty: true,
      isHopDirectDirty: false,
      undoHistoryBytes: fileBytes ? [...undoHistoryBytes, fileBytes] : undoHistoryBytes,
      stagingDiffSession: null,
      stagingDiffBytes: null,
      pendingDiffs: [],
    });

    const scrollContainer =
      typeof document !== "undefined" ? document.getElementById("scroll-container") : null;
    const savedScrollTop = scrollContainer?.scrollTop ?? 0;
    const savedScrollLeft = scrollContainer?.scrollLeft ?? 0;

    await hopBridge.loadDocumentIntoHop(finalBytes, fileName);
    const rt = hopBridge.getRuntime();
    if (rt) {
      set({ pageCount: Math.max(1, rt.wasm.pageCount) });
    }
    if (scrollContainer) {
      scrollContainer.scrollTop = savedScrollTop;
      scrollContainer.scrollLeft = savedScrollLeft;
    }
    if (stagingPath) {
      try {
        const status = await invoke<{ exists: boolean; mtimeMs: number; size: number }>(
          "check_staging_status",
          { filePath: stagingPath }
        );
        if (status?.mtimeMs) {
          set({ lastKnownStagingMtimeMs: status.mtimeMs });
        }
      } catch {}
    }
    await get().refreshDocMarkdown();
  },

  rejectStagingDiff: async () => {
    const { stagingPath, baselineBytes, fileBytes } = get();
    const restoreBytes = baselineBytes || fileBytes;
    if (stagingPath && restoreBytes) {
      try {
        await invoke("write_file_bytes", {
          filePath: stagingPath,
          bytes: Array.from(restoreBytes),
        });
        const status = await invoke<{ exists: boolean; mtimeMs: number; size: number }>(
          "check_staging_status",
          { filePath: stagingPath }
        );
        set({ lastKnownStagingMtimeMs: status?.mtimeMs || Date.now() });
      } catch (err) {
        console.warn("[DocStore] rejectStagingDiff write rollback failed:", err);
      }
    }
    set({
      stagingDiffSession: null,
      stagingDiffBytes: null,
    });
  },

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen, cliPanelOpen: sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen, cliPanelOpen: !s.cliPanelOpen })),
  setSidebarDock: (sidebarDock) => set({ sidebarDock }),
  toggleSidebarDock: () =>
    set((s) => ({ sidebarDock: s.sidebarDock === "left" ? "right" : "left" })),
  setSidebarWidth: (width: number) => {
    const maxW = Math.min(1000, typeof window !== "undefined" ? Math.floor(window.innerWidth * 0.72) : 900);
    const clamped = Math.min(maxW, Math.max(300, width));
    set({ sidebarWidth: clamped, cliPanelWidth: clamped });
  },
  setLicenseModalOpen: (licenseModalOpen) => set({ licenseModalOpen }),
  setPiiModalOpen: (piiModalOpen) => set({ piiModalOpen }),
  setAiApplyMode: (aiApplyMode) => set({ aiApplyMode }),
  setSettingsModalOpen: (settingsModalOpen) => set({ settingsModalOpen, piiModalOpen: settingsModalOpen }),
  setReasoningEffort: (reasoningEffort) => set({ reasoningEffort }),
  setAgentLoopMode: (agentLoopMode) => set({ agentLoopMode }),
  setProviderSettings: (settings) => set((s) => ({ ...s, ...settings })),
  setZoom: (zoom) => {
    set({ zoom });
    const rt = hopBridge.getRuntime();
    if (rt) {
      rt.canvasView.getViewportManager().setZoom(zoom);
    }
  },
  setCurrentPage: (currentPage) => set({ currentPage }),
  setPageCount: (pageCount) => set({ pageCount }),
  setTablesMeta: (tablesMeta) => set({ tablesMeta }),
  setSelection: (selection) => set({ selection }),
  setEditingTarget: (editingTarget) => set({ editingTarget }),
  setAutoMaskPii: (autoMaskPii) => set({ autoMaskPii }),
  removeExcludedRegion: (id) =>
    set((s) => ({ excludedRegions: s.excludedRegions.filter((r) => r.id !== id) })),
  clearExcludedRegions: () => set({ excludedRegions: [] }),
  addAttachment: (att) => set((s) => ({ attachments: [...s.attachments, att] })),
  removeAttachment: (id) => set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),

  markHopDirectEdited: () => {
    set({ isDirty: true, isHopDirectDirty: true });
  },

  syncHopToStaging: async () => {
    const { stagingPath, isHwpx, isHopDirectDirty } = get();
    if (!stagingPath || !isHopDirectDirty) return;
    const exported = hopBridge.exportHopBytes(isHwpx);
    if (!exported || exported.byteLength === 0) return;

    await invoke("write_file_bytes", {
      filePath: stagingPath,
      bytes: Array.from(exported),
    });
    let mtimeMs = Date.now();
    try {
      const st = await invoke<{ exists: boolean; mtimeMs: number }>("check_staging_status", {
        filePath: stagingPath,
      });
      if (st?.mtimeMs) mtimeMs = st.mtimeMs;
    } catch {}
    set({
      fileBytes: exported,
      baselineBytes: exported,
      lastKnownStagingMtimeMs: mtimeMs,
      isHopDirectDirty: false,
      isDirty: true,
    });
    await get().refreshDocMarkdown();
  },

  openDocument: async (filePath: string) => {
    const session = await invoke<OpenedDocSession>("open_document_session", { filePath });
    const bytes = new Uint8Array(session.bytes);
    let mtimeMs = Date.now();
    try {
      const st = await invoke<{ exists: boolean; mtimeMs: number }>("check_staging_status", {
        filePath: session.staging_path,
      });
      if (st?.mtimeMs) mtimeMs = st.mtimeMs;
    } catch {}
    set({
      originalPath: session.original_path,
      stagingPath: session.staging_path,
      fileName: session.file_name,
      isHwpx: session.is_hwpx,
      fileBytes: bytes,
      baselineBytes: bytes,
      lastKnownStagingMtimeMs: mtimeMs,
      isDirty: false,
      isHopDirectDirty: false,
      undoHistoryBytes: [],
      pendingDiffs: [],
      stagingDiffSession: null,
      stagingDiffBytes: null,
      selection: null,
      excludedRegions: [],
      docMarkdown: "",
      tablesMeta: [],
      sessionMasker: new PrivacySessionMasker(),
    });
    await hopBridge.loadDocumentIntoHop(bytes, session.file_name);
    const rt = hopBridge.getRuntime();
    if (rt) {
      set({ pageCount: Math.max(1, rt.wasm.pageCount) });
    }
    await get().refreshDocMarkdown();
  },

  openDocumentBytes: async (bytes: Uint8Array, fileName: string, originalPath?: string) => {
    const isHwpx =
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04;
    let stagingPath = "";
    let mtimeMs = Date.now();
    try {
      const session = await invoke<OpenedDocSession>("create_blank_session", { isHwpx });
      await invoke("write_file_bytes", {
        filePath: session.staging_path,
        bytes: Array.from(bytes),
      });
      stagingPath = session.staging_path;
      const st = await invoke<{ exists: boolean; mtimeMs: number }>("check_staging_status", {
        filePath: stagingPath,
      });
      if (st?.mtimeMs) mtimeMs = st.mtimeMs;
    } catch (err) {
      console.warn("[DocStore] 스테이징 세션 생성 생략(정적 브라우저 모드):", err);
    }
    set({
      originalPath: originalPath || null,
      stagingPath: stagingPath || null,
      fileName,
      isHwpx,
      fileBytes: bytes,
      baselineBytes: bytes,
      lastKnownStagingMtimeMs: mtimeMs,
      isDirty: false,
      isHopDirectDirty: false,
      undoHistoryBytes: [],
      pendingDiffs: [],
      stagingDiffSession: null,
      stagingDiffBytes: null,
      selection: null,
      excludedRegions: [],
      docMarkdown: "",
      tablesMeta: [],
      sessionMasker: new PrivacySessionMasker(),
    });
    await hopBridge.loadDocumentIntoHop(bytes, fileName);
    const rt = hopBridge.getRuntime();
    if (rt) {
      set({ pageCount: Math.max(1, rt.wasm.pageCount) });
    }
    if (stagingPath) {
      await get().refreshDocMarkdown();
    }
  },

  adoptHopDocument: async ({ fileName, sourceBytes }) => {
    let bytes = sourceBytes;
    if (!bytes) bytes = hopBridge.exportHopBytes(/\.hwpx$/i.test(fileName));
    if (!bytes || bytes.byteLength === 0) return;
    const isHwpx =
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04;
    let stagingPath = "";
    let mtimeMs = Date.now();
    try {
      const session = await invoke<OpenedDocSession>("create_blank_session", { isHwpx });
      await invoke("write_file_bytes", {
        filePath: session.staging_path,
        bytes: Array.from(bytes),
      });
      stagingPath = session.staging_path;
      const st = await invoke<{ exists: boolean; mtimeMs: number }>("check_staging_status", {
        filePath: stagingPath,
      });
      if (st?.mtimeMs) mtimeMs = st.mtimeMs;
    } catch (err) {
      console.warn("[DocStore] HOP 문서 스테이징 생략(정적 브라우저 모드):", err);
    }
    set({
      originalPath: null,
      stagingPath: stagingPath || null,
      fileName,
      isHwpx,
      fileBytes: bytes,
      baselineBytes: bytes,
      lastKnownStagingMtimeMs: mtimeMs,
      isDirty: false,
      isHopDirectDirty: false,
      undoHistoryBytes: [],
      pendingDiffs: [],
      stagingDiffSession: null,
      stagingDiffBytes: null,
      selection: null,
      excludedRegions: [],
      docMarkdown: "",
      tablesMeta: [],
      sessionMasker: new PrivacySessionMasker(),
    });
    const rt = hopBridge.getRuntime();
    if (rt) set({ pageCount: Math.max(1, rt.wasm.pageCount) });
    await get().refreshDocMarkdown();
  },

  createBlankDocument: async (isHwpx: boolean) => {
    const session = await invoke<OpenedDocSession>("create_blank_session", { isHwpx });
    const payload = OpTranslator.toEnginePayload(session.staging_path, isHwpx, [], [], true);
    await invoke("execute_claw_ops", {
      isHwpx: payload.isHwpx,
      payloadJson: payload.stdinJson,
    });
    const bytesArr = await invoke<number[]>("read_file_bytes", { filePath: session.staging_path });
    const bytes = new Uint8Array(bytesArr);
    let mtimeMs = Date.now();
    try {
      const st = await invoke<{ exists: boolean; mtimeMs: number }>("check_staging_status", {
        filePath: session.staging_path,
      });
      if (st?.mtimeMs) mtimeMs = st.mtimeMs;
    } catch {}
    set({
      originalPath: null,
      stagingPath: session.staging_path,
      fileName: session.file_name,
      isHwpx,
      fileBytes: bytes,
      baselineBytes: bytes,
      lastKnownStagingMtimeMs: mtimeMs,
      isDirty: false,
      isHopDirectDirty: false,
      undoHistoryBytes: [],
      pendingDiffs: [],
      stagingDiffSession: null,
      stagingDiffBytes: null,
      selection: null,
      excludedRegions: [],
      docMarkdown: "",
      sessionMasker: new PrivacySessionMasker(),
    });
    await hopBridge.loadDocumentIntoHop(bytes, session.file_name);
    await get().refreshDocMarkdown();
  },

  refreshDocMarkdown: async () => {
    const { stagingPath, isHwpx, fileBytes } = get();
    if (!stagingPath) return;
    try {
      const md = await invoke<string>("extract_markdown", { filePath: stagingPath });
      set({ docMarkdown: md });
    } catch (err) {
      console.warn("[DocStore] Failed to extract markdown:", err);
    }

    const isHwpxDoc = isHwpx ?? /\.hwpx$/i.test(stagingPath);
    if (isHwpxDoc) {
      try {
        let bytes = fileBytes;
        if (!bytes || bytes.byteLength === 0) {
          try {
            const arr = await invoke<number[]>("read_file_bytes", { filePath: stagingPath });
            bytes = new Uint8Array(arr);
            set({ fileBytes: bytes });
          } catch (e) {
            console.warn("[DocStore] Failed to read bytes from stagingPath:", e);
          }
        }
        if (bytes && bytes.byteLength > 0) {
          const existingMeta = get().tablesMeta;
          const parsed = buildTablesMetaForHwpx(bytes, existingMeta);
          const enriched = hopBridge.enrichTablesMetaWithBboxes(parsed);
          set({ tablesMeta: enriched });
        }
      } catch (err) {
        console.warn("[DocStore] Failed to build tablesMeta for HWPX:", err);
      }
    } else {
      try {
        const inspected = await invoke<any>("inspect_document", { filePath: stagingPath });
        if (inspected && Array.isArray(inspected.tables)) {
          const existingMeta = get().tablesMeta;
          const merged = mapInspectedTables(inspected.tables, existingMeta);
          const enriched = hopBridge.enrichTablesMetaWithBboxes(merged);
          set({ tablesMeta: enriched });
        }
      } catch (err) {
        console.warn("[DocStore] Failed to refresh tablesMeta for HWP:", err);
      }
    }
  },

  toggleExcludeSelection: () => {
    const { selection, excludedRegions } = get();
    if (!selection) return;

    if (selection.kind === "table_cells") {
      const next = [...excludedRegions];
      for (const cell of selection.selectedCells) {
        const existsIdx = next.findIndex(
          (r) =>
            r.targetType === "cell" &&
            r.tableIndex === selection.tableIndex &&
            r.row === cell.row &&
            r.col === cell.col
        );
        if (existsIdx >= 0) {
          next.splice(existsIdx, 1);
        } else {
          next.push({
            id: crypto.randomUUID(),
            label: `표 ${selection.tableIndex + 1} (${cell.row + 1}행 ${cell.col + 1}열)`,
            targetType: "cell",
            tableIndex: selection.tableIndex,
            row: cell.row,
            col: cell.col,
            rawText: cell.text,
          });
        }
      }
      set({ excludedRegions: next });
    } else if (selection.kind === "body_range" && selection.selectedText.trim()) {
      const existsIdx = excludedRegions.findIndex(
        (r) => r.targetType === "body_text" && r.rawText === selection.selectedText
      );
      if (existsIdx >= 0) {
        const next = [...excludedRegions];
        next.splice(existsIdx, 1);
        set({ excludedRegions: next });
      } else {
        set({
          excludedRegions: [
            ...excludedRegions,
            {
              id: crypto.randomUUID(),
              label: `본문 문단 ${selection.startPara + 1}`,
              targetType: "body_text",
              rawText: selection.selectedText,
              rects: selection.rects,
            },
          ],
        });
      }
    }
  },

  addProposedDiffs: async (items) => {
    const { aiApplyMode, tablesMeta } = get();
    const enrichedItems = items.map((item) => {
      if (!item.bbox && item.targetCoord && typeof item.targetCoord.tableIndex === "number") {
        const t = tablesMeta[item.targetCoord.tableIndex];
        const c = t?.cells.find(
          (cell) => cell.row === item.targetCoord?.row && cell.col === item.targetCoord?.col
        );
        if (c?.bbox) {
          return {
            ...item,
            bbox: {
              pageIndex: c.bbox.pageIndex,
              x: c.bbox.x,
              y: c.bbox.y,
              w: c.bbox.w,
              h: c.bbox.h,
            },
          };
        }
      }
      return item;
    });

    set({ pendingDiffs: enrichedItems });
    if (aiApplyMode === "immediate" && enrichedItems.length > 0) {
      await get().acceptAllDiffs();
    }
  },

  rejectDiffItem: (diffId) =>
    set((state) => ({
      pendingDiffs: state.pendingDiffs.filter((d) => d.id !== diffId),
    })),

  rejectAllDiffs: () => set({ pendingDiffs: [] }),

  acceptDiffItem: async (diffId) => {
    await get().syncHopToStaging();
    const { stagingPath, isHwpx, pendingDiffs, tablesMeta, fileBytes, undoHistoryBytes, fileName, excludedRegions } = get();
    const target = pendingDiffs.find((d) => d.id === diffId);
    if (!target || !stagingPath) return;

    const isHwpxDoc = Boolean(isHwpx ?? /\.hwpx$/i.test(stagingPath));
    const payload = OpTranslator.toEnginePayload(
      stagingPath,
      isHwpxDoc,
      target.unifiedOps,
      tablesMeta,
      false
    );

    let finalPayloadJson = payload.stdinJson;
    if (payload.isHwpx && excludedRegions.length > 0) {
      try {
        const parsed = JSON.parse(payload.stdinJson);
        parsed.policyContext = { isNewDocument: false, excludedRegions };
        finalPayloadJson = JSON.stringify(parsed);
      } catch {}
    }

    const res = await invoke<{ ok: boolean; stdout_json: any; stderr: string }>("execute_claw_ops", {
      isHwpx: payload.isHwpx,
      payloadJson: finalPayloadJson,
    });

    if (!res.ok) {
      throw new Error(`패치 적용 실패: ${JSON.stringify(res.stdout_json)} ${res.stderr}`);
    }

    const updatedBytesArr = await invoke<number[]>("read_file_bytes", { filePath: stagingPath });
    const updatedBytes = new Uint8Array(updatedBytesArr);

    set({
      fileBytes: updatedBytes,
      baselineBytes: updatedBytes,
      isDirty: true,
      isHopDirectDirty: false,
      undoHistoryBytes: fileBytes ? [...undoHistoryBytes, fileBytes] : undoHistoryBytes,
      pendingDiffs: pendingDiffs.filter((d) => d.id !== diffId),
    });

    const scrollContainer =
      typeof document !== "undefined" ? document.getElementById("scroll-container") : null;
    const savedScrollTop = scrollContainer?.scrollTop ?? 0;
    const savedScrollLeft = scrollContainer?.scrollLeft ?? 0;

    await hopBridge.loadDocumentIntoHop(updatedBytes, fileName);
    if (scrollContainer) {
      scrollContainer.scrollTop = savedScrollTop;
      scrollContainer.scrollLeft = savedScrollLeft;
    }
    await get().refreshDocMarkdown();
  },

  acceptAllDiffs: async () => {
    await get().syncHopToStaging();
    const { stagingPath, isHwpx, pendingDiffs, tablesMeta, fileBytes, undoHistoryBytes, fileName, excludedRegions } = get();
    if (!stagingPath || pendingDiffs.length === 0) return;

    const isHwpxDoc = Boolean(isHwpx ?? /\.hwpx$/i.test(stagingPath));
    const batchedOps = pendingDiffs.flatMap((d) => d.unifiedOps);
    const payload = OpTranslator.toEnginePayload(stagingPath, isHwpxDoc, batchedOps, tablesMeta, false);

    let finalPayloadJson = payload.stdinJson;
    if (payload.isHwpx && excludedRegions.length > 0) {
      try {
        const parsed = JSON.parse(payload.stdinJson);
        parsed.policyContext = { isNewDocument: false, excludedRegions };
        finalPayloadJson = JSON.stringify(parsed);
      } catch {}
    }

    const res = await invoke<{ ok: boolean; stdout_json: any; stderr: string }>("execute_claw_ops", {
      isHwpx: payload.isHwpx,
      payloadJson: finalPayloadJson,
    });

    if (!res.ok) {
      throw new Error(`일괄 패치 적용 실패: ${JSON.stringify(res.stdout_json)} ${res.stderr}`);
    }

    const updatedBytesArr = await invoke<number[]>("read_file_bytes", { filePath: stagingPath });
    const updatedBytes = new Uint8Array(updatedBytesArr);

    set({
      fileBytes: updatedBytes,
      baselineBytes: updatedBytes,
      isDirty: true,
      isHopDirectDirty: false,
      undoHistoryBytes: fileBytes ? [...undoHistoryBytes, fileBytes] : undoHistoryBytes,
      pendingDiffs: [],
    });

    const scrollContainer =
      typeof document !== "undefined" ? document.getElementById("scroll-container") : null;
    const savedScrollTop = scrollContainer?.scrollTop ?? 0;
    const savedScrollLeft = scrollContainer?.scrollLeft ?? 0;

    await hopBridge.loadDocumentIntoHop(updatedBytes, fileName);
    if (scrollContainer) {
      scrollContainer.scrollTop = savedScrollTop;
      scrollContainer.scrollLeft = savedScrollLeft;
    }
    await get().refreshDocMarkdown();
  },

  undoLastChange: async () => {
    const { stagingPath, undoHistoryBytes, fileName } = get();
    if (!stagingPath || undoHistoryBytes.length === 0) return;
    const prevBytes = undoHistoryBytes[undoHistoryBytes.length - 1];
    await invoke("write_file_bytes", { filePath: stagingPath, bytes: Array.from(prevBytes) });
    set({
      fileBytes: prevBytes,
      baselineBytes: prevBytes,
      isHopDirectDirty: false,
      undoHistoryBytes: undoHistoryBytes.slice(0, -1),
      stagingDiffSession: null,
      stagingDiffBytes: null,
    });
    await hopBridge.loadDocumentIntoHop(prevBytes, fileName);
    await get().refreshDocMarkdown();
  },

  applyHumanCellEdit: async (tableIndex: number, row: number, col: number, newText: string) => {
    await get().syncHopToStaging();
    const { stagingPath, isHwpx, tablesMeta, fileBytes, undoHistoryBytes, fileName } = get();
    if (!stagingPath) return;

    const op: UnifiedOp = {
      type: "set_cell_text",
      tableIndex,
      row,
      col,
      text: newText,
    };

    const payload = OpTranslator.toEnginePayload(stagingPath, isHwpx, [op], tablesMeta, false);
    const res = await invoke<{ ok: boolean; stdout_json: any; stderr: string }>("execute_claw_ops", {
      isHwpx: payload.isHwpx,
      payloadJson: payload.stdinJson,
    });

    if (!res.ok) {
      throw new Error(`셀 수정 실패: ${JSON.stringify(res.stdout_json)} ${res.stderr}`);
    }

    const updatedBytesArr = await invoke<number[]>("read_file_bytes", { filePath: stagingPath });
    const updatedBytes = new Uint8Array(updatedBytesArr);

    set({
      fileBytes: updatedBytes,
      baselineBytes: updatedBytes,
      isDirty: true,
      isHopDirectDirty: false,
      undoHistoryBytes: fileBytes ? [...undoHistoryBytes, fileBytes] : undoHistoryBytes,
      editingTarget: null,
      selection: null,
    });
    await hopBridge.loadDocumentIntoHop(updatedBytes, fileName);
    await get().refreshDocMarkdown();
  },

  applyHumanNestedTableInsert: async (
    tableIndex: number,
    row: number,
    col: number,
    rows: number,
    cols: number
  ) => {
    await get().syncHopToStaging();
    let { stagingPath, isHwpx, tablesMeta, fileBytes, undoHistoryBytes, fileName } = get();
    if (!stagingPath) return;

    // If user is on an HWP document in WASM, seamlessly upgrade the staging session to HWPX if possible
    if (!isHwpx) {
      const exportedHwpx = hopBridge.exportHopBytes(true);
      if (exportedHwpx && exportedHwpx.byteLength > 0) {
        const hwpxSession = await invoke<OpenedDocSession>("create_blank_session", { isHwpx: true });
        await invoke("write_file_bytes", {
          filePath: hwpxSession.staging_path,
          bytes: Array.from(exportedHwpx),
        });
        stagingPath = hwpxSession.staging_path;
        isHwpx = true;
        fileName = fileName.replace(/\.hwp$/i, ".hwpx");
        set({
          stagingPath,
          isHwpx: true,
          fileName,
          fileBytes: exportedHwpx,
          baselineBytes: exportedHwpx,
        });
        await get().refreshDocMarkdown();
        tablesMeta = get().tablesMeta;
      } else {
        throw new Error(
          "중첩 표는 국가 표준 HWPX 문서에서만 지원됩니다. HWPX로 저장 후 시도해 주세요."
        );
      }
    }

    const op: UnifiedOp = {
      type: "insert_nested_table",
      tableIndex,
      row,
      col,
      rows,
      cols,
      widthMode: "fit_cell",
    };

    const payload = OpTranslator.toEnginePayload(stagingPath, isHwpx, [op], tablesMeta, false);
    const res = await invoke<{ ok: boolean; stdout_json: any; stderr: string }>("execute_claw_ops", {
      isHwpx: payload.isHwpx,
      payloadJson: payload.stdinJson,
    });

    if (!res.ok) {
      throw new Error(`중첩 표 삽입 실패: ${JSON.stringify(res.stdout_json)} ${res.stderr}`);
    }

    const updatedBytesArr = await invoke<number[]>("read_file_bytes", { filePath: stagingPath });
    const updatedBytes = new Uint8Array(updatedBytesArr);

    let mtimeMs = Date.now();
    try {
      const st = await invoke<{ exists: boolean; mtimeMs: number }>("check_staging_status", {
        filePath: stagingPath,
      });
      if (st?.mtimeMs) mtimeMs = st.mtimeMs;
    } catch {}

    set({
      fileBytes: updatedBytes,
      baselineBytes: updatedBytes,
      lastKnownStagingMtimeMs: mtimeMs,
      isDirty: true,
      isHopDirectDirty: false,
      undoHistoryBytes: fileBytes ? [...undoHistoryBytes, fileBytes] : undoHistoryBytes,
      editingTarget: null,
      selection: null,
    });
    await hopBridge.loadDocumentIntoHop(updatedBytes, fileName);
    await get().refreshDocMarkdown();
  },

  insertNestedTableAtCurrentCell: async (rows: number, cols: number) => {
    try {
      let currentSelection = get().selection;
      if (!currentSelection || currentSelection.kind !== "table_cells") {
        const ctx = hopBridge.getSelectionContext();
        if (ctx) {
          currentSelection = mapSelectionFromHopContext(ctx, get().tablesMeta);
          if (currentSelection) {
            set({ selection: currentSelection });
          }
        }
      }
      if (!currentSelection || currentSelection.kind !== "table_cells") {
        get().showToastMessage("중첩 표를 삽입할 표 셀 내부에 먼저 커서를 위치시켜 주세요.");
        return false;
      }
      await get().applyHumanNestedTableInsert(
        currentSelection.tableIndex,
        currentSelection.startRow,
        currentSelection.startCol,
        rows,
        cols
      );
      get().showToastMessage(
        `표 #${currentSelection.tableIndex + 1} (${currentSelection.startRow + 1}행 ${currentSelection.startCol + 1}열) 내부에 ${rows}×${cols} 중첩 표가 삽입되었습니다.`
      );
      return true;
    } catch (err: any) {
      get().showToastMessage(String(err?.message || err));
      return false;
    }
  },

  applyHumanParagraphEdit: async (sec: number, para: number, newText: string, oldText: string) => {
    await get().syncHopToStaging();
    const { stagingPath, isHwpx, tablesMeta, fileBytes, undoHistoryBytes, fileName } = get();
    if (!stagingPath) return;

    const op: UnifiedOp = isHwpx
      ? { type: "set_paragraph_text", paraIndex: para, text: newText }
      : oldText && oldText.trim()
      ? { type: "replace_body_text", find: oldText.trim(), replace: newText.trim() }
      : { type: "set_paragraph_text", paraIndex: para, text: newText, oldTextForHwp: oldText };

    const payload = OpTranslator.toEnginePayload(stagingPath, isHwpx, [op], tablesMeta, false);
    const res = await invoke<{ ok: boolean; stdout_json: any; stderr: string }>("execute_claw_ops", {
      isHwpx: payload.isHwpx,
      payloadJson: payload.stdinJson,
    });

    if (!res.ok) {
      throw new Error(`문단 수정 실패: ${JSON.stringify(res.stdout_json)} ${res.stderr}`);
    }

    const updatedBytesArr = await invoke<number[]>("read_file_bytes", { filePath: stagingPath });
    const updatedBytes = new Uint8Array(updatedBytesArr);

    set({
      fileBytes: updatedBytes,
      baselineBytes: updatedBytes,
      isDirty: true,
      isHopDirectDirty: false,
      undoHistoryBytes: fileBytes ? [...undoHistoryBytes, fileBytes] : undoHistoryBytes,
      editingTarget: null,
      selection: null,
    });
    await hopBridge.loadDocumentIntoHop(updatedBytes, fileName);
    await get().refreshDocMarkdown();
  },

  applyHumanInsertParagraph: async (text: string) => {
    await get().syncHopToStaging();
    const { stagingPath, isHwpx, tablesMeta, fileBytes, undoHistoryBytes, fileName } = get();
    if (!stagingPath) return;

    const op: UnifiedOp = { type: "append_paragraph", text };
    const payload = OpTranslator.toEnginePayload(stagingPath, isHwpx, [op], tablesMeta, false);
    const res = await invoke<{ ok: boolean; stdout_json: any; stderr: string }>("execute_claw_ops", {
      isHwpx: payload.isHwpx,
      payloadJson: payload.stdinJson,
    });

    if (!res.ok) {
      throw new Error(`문단 추가 실패: ${JSON.stringify(res.stdout_json)} ${res.stderr}`);
    }

    const updatedBytesArr = await invoke<number[]>("read_file_bytes", { filePath: stagingPath });
    const updatedBytes = new Uint8Array(updatedBytesArr);

    set({
      fileBytes: updatedBytes,
      baselineBytes: updatedBytes,
      isDirty: true,
      isHopDirectDirty: false,
      undoHistoryBytes: fileBytes ? [...undoHistoryBytes, fileBytes] : undoHistoryBytes,
    });
    await hopBridge.loadDocumentIntoHop(updatedBytes, fileName);
    await get().refreshDocMarkdown();
  },

  saveToOriginalFile: async () => {
    await get().syncHopToStaging();
    const { originalPath, stagingPath } = get();
    if (!stagingPath) return;
    const finalPath = await invoke<string>("commit_staging_to_original", {
      stagingPath,
      originalPath: originalPath || "",
    });
    set({ originalPath: finalPath, isDirty: false, isHopDirectDirty: false });
  },

  openMemoryModal: (tab) => {
    set({ memoryModalOpen: true, memoryModalInitialTab: tab ?? "list" });
    void get().refreshMemoriesIndex();
  },
  closeMemoryModal: () => set({ memoryModalOpen: false }),
  refreshMemoriesIndex: async () => {
    const store = createMemoryStore();
    const list = await store.list();
    const currentActive = get().activeMemoryIds;
    const validIds = currentActive.filter((id) => list.some((m) => m.id === id));
    set({ memoriesIndex: list, activeMemoryIds: validIds });
    void get().syncWritingMemoryFileToDisk();
  },
  toggleActiveMemory: (id) => {
    const { activeMemoryIds } = get();
    if (activeMemoryIds.includes(id)) {
      set({ activeMemoryIds: activeMemoryIds.filter((x) => x !== id) });
    } else {
      set({ activeMemoryIds: [...activeMemoryIds, id] });
    }
    void get().syncWritingMemoryFileToDisk();
  },
  moveActiveMemoryPriority: (id, direction) => {
    const { activeMemoryIds } = get();
    const idx = activeMemoryIds.indexOf(id);
    if (idx === -1) return;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= activeMemoryIds.length) return;
    const next = [...activeMemoryIds];
    const [item] = next.splice(idx, 1);
    next.splice(targetIdx, 0, item);
    set({ activeMemoryIds: next });
    void get().syncWritingMemoryFileToDisk();
  },
  clearActiveMemories: () => {
    set({ activeMemoryIds: [] });
    void get().syncWritingMemoryFileToDisk();
  },
}));

if (typeof window !== "undefined") {
  (window as any).__docStore = useDocStore;
}
