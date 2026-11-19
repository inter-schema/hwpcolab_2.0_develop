import React, { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Save,
  Undo2,
  ShieldAlert,
  ShieldCheck,
  FilePlus2,
  Scale,
  BookMarked,
  Terminal,
  PanelRight,
  PanelBottom,
  GitCompare,
  Sun,
  Moon,
  Monitor,
  X,
} from "lucide-react";
import { useDocStore } from "../../store/useDocStore";
import { runtimeInvoke as invoke, isTauriRuntime } from "../../core/runtimeInvoke";
import { hopBridge } from "../../core/hopBridge";

export const HeaderToolbar: React.FC = () => {
  const {
    fileName,
    isHwpx,
    isDirty,
    stagingPath,
    undoHistoryBytes,
    excludedRegions,
    autoMaskPii,
    stagingDiffSession,
    openDocument,
    openDocumentBytes,
    createBlankDocument,
    undoLastChange,
    saveToOriginalFile,
    cliPanelOpen,
    cliPanelDock,
    toggleCliPanel,
    toggleCliPanelDock,
    setLicenseModalOpen,
    setPiiModalOpen,
    openMemoryModal,
    activeMemoryIds,
    memoriesIndex,
    toastMessage,
    showToastMessage,
  } = useDocStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [themeMode, setThemeModeState] = useState<"system" | "light" | "dark">(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("rhwp-theme-mode");
      if (saved === "light" || saved === "dark" || saved === "system") return saved;
    }
    return "system";
  });

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => {
      showToastMessage(null);
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [toastMessage, showToastMessage]);

  const handleCycleTheme = () => {
    const order: Array<"system" | "light" | "dark"> = ["system", "light", "dark"];
    const next = order[(order.indexOf(themeMode) + 1) % order.length];
    setThemeModeState(next);
    hopBridge.setHopThemeMode(next);
  };

  const handleOpen = async () => {
    if (!isTauriRuntime()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const path = await invoke<string | null>("pick_local_file", {
        extensions: ["hwp", "hwpx"],
      });
      if (path) {
        await openDocument(path);
      }
    } catch {
      fileInputRef.current?.click();
    }
  };

  const handleWebFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    await openDocumentBytes(buf, file.name);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSave = async () => {
    try {
      await saveToOriginalFile();
      showToastMessage("원본 파일에 변경사항이 원자적으로 저장되었습니다.");
    } catch (err: any) {
      showToastMessage(`저장 실패: ${err?.message || err}`);
    }
  };

  const diffCount = stagingDiffSession?.diffItems.length ?? 0;

  return (
    <header className="h-11 bg-[#F8FAFC] dark:bg-[#0D1117] border-b border-[#E2E8F0] dark:border-[#21262D] px-3.5 flex items-center justify-between select-none shrink-0 z-20 text-[#0F172A] dark:text-[#F0F6FC] relative">
      {/* Left: Brand & File Actions */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 mr-1.5">
          <div className="w-6 h-6 rounded-md bg-teal-600 flex items-center justify-center text-white font-bold text-xs tracking-tight">
            HC
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-bold text-[#0F172A] dark:text-[#F0F6FC] text-xs tracking-tight">
              HOP-Claw
            </span>
            <span className="text-[11px] text-[#64748B] dark:text-[#8B949E] font-mono tabular-nums">
              v2.0 · Agent CLI Studio
            </span>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".hwp,.hwpx"
          className="hidden"
          onChange={handleWebFileSelect}
        />

        <button
          id="btn-new-hwpx"
          onClick={() => createBlankDocument(true)}
          className="flex items-center gap-1.5 text-xs font-medium bg-white dark:bg-[#161B22] hover:bg-slate-100 dark:hover:bg-[#1F242C] text-[#0F172A] dark:text-[#F0F6FC] px-2.5 py-1.5 rounded-md transition-colors border border-[#E2E8F0] dark:border-[#21262D]"
          title="새 HWPX 표준 문서 만들기"
        >
          <FilePlus2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
          <span>새 문서</span>
        </button>

        <button
          id="btn-open-doc"
          onClick={handleOpen}
          className="flex items-center gap-1.5 text-xs font-medium bg-white dark:bg-[#161B22] hover:bg-slate-100 dark:hover:bg-[#1F242C] text-[#0F172A] dark:text-[#F0F6FC] px-2.5 py-1.5 rounded-md transition-colors border border-[#E2E8F0] dark:border-[#21262D]"
        >
          <FolderOpen className="w-3.5 h-3.5 text-[#475569] dark:text-[#8B949E]" />
          <span>열기</span>
        </button>

        {stagingPath && (
          <>
            <button
              id="btn-save-doc"
              onClick={handleSave}
              disabled={!isDirty}
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors border ${
                isDirty
                  ? "bg-teal-600 hover:bg-teal-700 text-white border-teal-600"
                  : "bg-slate-100 dark:bg-[#161B22] text-slate-400 dark:text-[#484F58] border-[#E2E8F0] dark:border-[#21262D] cursor-not-allowed"
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              <span>원본 저장</span>
            </button>

            <button
              id="btn-undo-change"
              onClick={undoLastChange}
              disabled={undoHistoryBytes.length === 0}
              className="flex items-center gap-1 text-xs font-medium text-[#475569] dark:text-[#8B949E] hover:text-[#0F172A] dark:hover:text-[#F0F6FC] px-2 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-[#161B22] disabled:opacity-40 tabular-nums"
              title="스테이징 스냅샷 되돌리기"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>실행취소 ({undoHistoryBytes.length})</span>
            </button>
          </>
        )}
      </div>

      {/* Center: Unboxed Document Metadata with Middle-Dot Separators */}
      <div className="flex items-center gap-2 text-xs text-[#475569] dark:text-[#8B949E] tabular-nums">
        <span className="font-semibold text-[#0F172A] dark:text-[#F0F6FC] truncate max-w-[260px]">
          {fileName}
        </span>
        {stagingPath && (
          <>
            <span className="text-slate-300 dark:text-[#30363D]">·</span>
            <span
              className={`font-mono font-semibold ${
                isHwpx
                  ? "text-teal-700 dark:text-teal-400"
                  : "text-amber-700 dark:text-amber-400"
              }`}
            >
              {isHwpx ? "HWPX" : "HWP"}
            </span>
          </>
        )}
        {isDirty && (
          <>
            <span className="text-slate-300 dark:text-[#30363D]">·</span>
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              미저장 변경사항
            </span>
          </>
        )}
        {diffCount > 0 && (
          <>
            <span className="text-slate-300 dark:text-[#30363D]">·</span>
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
              <GitCompare className="w-3.5 h-3.5" />
              Diff 대기 {diffCount}건
            </span>
          </>
        )}
      </div>

      {/* Right: Writing Memory, Privacy Masking, Theme & Agent CLI Controls */}
      <div className="flex items-center gap-1.5">
        {/* Writing Memory Trigger */}
        <button
          id="btn-open-writing-memory"
          data-testid="header-writing-memory-btn"
          onClick={() => openMemoryModal("list")}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors font-medium tabular-nums ${
            activeMemoryIds.length > 0
              ? "bg-teal-50/70 dark:bg-teal-950/40 border-teal-300 dark:border-teal-800 text-teal-800 dark:text-teal-300"
              : "bg-white dark:bg-[#161B22] border-[#E2E8F0] dark:border-[#21262D] text-[#475569] dark:text-[#8B949E] hover:bg-slate-100 dark:hover:bg-[#1F242C]"
          }`}
          title="작성 선호사항 (양식 메모리) 관리 및 $HWP_WRITING_MEMORY_PATH 주입 설정"
        >
          <BookMarked
            className={`w-3.5 h-3.5 ${
              activeMemoryIds.length > 0
                ? "text-teal-600 dark:text-teal-400"
                : "text-[#64748B] dark:text-[#8B949E]"
            }`}
          />
          <span>
            작성 메모리
            {activeMemoryIds.length > 0
              ? ` · 활성 ${activeMemoryIds.length}`
              : memoriesIndex.length > 0
              ? ` · ${memoriesIndex.length}`
              : ""}
          </span>
        </button>

        {/* PII Privacy Protection Trigger */}
        <button
          id="btn-open-pii-modal"
          onClick={() => setPiiModalOpen(true)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors font-medium tabular-nums ${
            autoMaskPii || excludedRegions.length > 0
              ? "bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
              : "bg-white dark:bg-[#161B22] border-[#E2E8F0] dark:border-[#21262D] text-[#475569] dark:text-[#8B949E] hover:bg-slate-100 dark:hover:bg-[#1F242C]"
          }`}
          title="개인정보(PII) 12종 자동 마스킹 및 제외 영역 관리"
        >
          {autoMaskPii || excludedRegions.length > 0 ? (
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <ShieldAlert className="w-3.5 h-3.5 text-[#64748B] dark:text-[#8B949E]" />
          )}
          <span>
            PII 보호
            {autoMaskPii ? " · ON" : ""}
            {excludedRegions.length > 0 ? ` · 제외 ${excludedRegions.length}` : ""}
          </span>
        </button>

        {/* Theme Mode Switcher */}
        <button
          id="btn-cycle-theme"
          onClick={handleCycleTheme}
          className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-md border border-[#E2E8F0] dark:border-[#21262D] bg-white dark:bg-[#161B22] text-[#475569] dark:text-[#8B949E] hover:text-[#0F172A] dark:hover:text-[#F0F6FC] hover:bg-slate-100 dark:hover:bg-[#1F242C] transition-colors"
          title={`테마 전환 (현재: ${
            themeMode === "light" ? "밝게" : themeMode === "dark" ? "어둡게" : "시스템"
          })`}
        >
          {themeMode === "light" ? (
            <Sun className="w-3.5 h-3.5 text-amber-500" />
          ) : themeMode === "dark" ? (
            <Moon className="w-3.5 h-3.5 text-teal-400" />
          ) : (
            <Monitor className="w-3.5 h-3.5" />
          )}
        </button>

        {/* GPL v3 License Modal Trigger */}
        <button
          id="btn-open-gpl-license"
          onClick={() => setLicenseModalOpen(true)}
          className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-md border border-[#E2E8F0] dark:border-[#21262D] bg-white dark:bg-[#161B22] text-[#475569] dark:text-[#8B949E] hover:text-[#0F172A] dark:hover:text-[#F0F6FC] hover:bg-slate-100 dark:hover:bg-[#1F242C] transition-colors"
          title="GNU GPL v3.0 오픈소스 라이선스 고지"
        >
          <Scale className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
          <span className="font-medium">GPL v3</span>
        </button>

        <div className="h-4 w-px bg-[#E2E8F0] dark:bg-[#21262D] mx-0.5" />

        {/* Dock Position Toggle (Right / Bottom) */}
        {cliPanelOpen && (
          <button
            id="btn-toggle-cli-dock"
            onClick={toggleCliPanelDock}
            className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-md border border-[#E2E8F0] dark:border-[#21262D] bg-white dark:bg-[#161B22] text-[#475569] dark:text-[#8B949E] hover:bg-slate-100 dark:hover:bg-[#1F242C] transition-colors"
            title={
              cliPanelDock === "right"
                ? "에이전트 CLI 패널을 하단(Bottom)으로 도킹"
                : "에이전트 CLI 패널을 우측(Right)으로 도킹"
            }
          >
            {cliPanelDock === "right" ? (
              <PanelBottom className="w-3.5 h-3.5 text-[#475569] dark:text-[#8B949E]" />
            ) : (
              <PanelRight className="w-3.5 h-3.5 text-[#475569] dark:text-[#8B949E]" />
            )}
            <span className="text-[11px] font-medium">
              {cliPanelDock === "right" ? "하단 도킹" : "우측 도킹"}
            </span>
          </button>
        )}

        {/* Agent CLI Panel Open/Close Toggle */}
        <button
          id="btn-toggle-cli-panel"
          onClick={toggleCliPanel}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border font-semibold transition-colors ${
            cliPanelOpen
              ? "bg-[#0D1117] text-[#2DD4BF] border-[#0D1117] dark:bg-teal-600 dark:text-white dark:border-teal-600"
              : "bg-white dark:bg-[#161B22] text-[#0F172A] dark:text-[#F0F6FC] border-[#E2E8F0] dark:border-[#21262D] hover:bg-slate-100 dark:hover:bg-[#1F242C]"
          }`}
          title="에이전트 CLI 터미널 패널 열기/닫기"
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Agent CLI</span>
        </button>
      </div>

      {/* Non-blocking Toast Notification Banner */}
      {toastMessage && (
        <div
          id="hop-claw-toast"
          role="status"
          className="fixed top-13 right-4 z-50 flex items-center gap-2.5 px-3.5 py-2 rounded-lg bg-[#0F172A] dark:bg-[#161B22] text-white text-xs font-medium border border-[#334155] dark:border-[#30363D] shadow-lg"
        >
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => showToastMessage(null)}
            className="text-slate-400 hover:text-white transition-colors"
            title="알림 닫기"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </header>
  );
};
