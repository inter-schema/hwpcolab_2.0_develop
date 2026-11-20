import React, { useEffect, useRef } from "react";
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
  Flower2,
  Coffee,
  X,
} from "lucide-react";
import { useDocStore } from "../../store/useDocStore";
import { runtimeInvoke as invoke, isTauriRuntime } from "../../core/runtimeInvoke";

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
    uiPalette,
    setUiPalette,
  } = useDocStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => {
      showToastMessage(null);
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [toastMessage, showToastMessage]);

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
    <header className="hc-chrome h-11 bg-[var(--hc-surface)] border-b border-[var(--hc-border)] px-3.5 flex items-center justify-between gap-4 select-none shrink-0 z-20 text-[var(--hc-text)] relative transition-colors duration-200">
      {/* Left: Brand & File Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="flex items-center gap-2 mr-1.5 shrink-0">
          <div className="w-6 h-6 rounded-md bg-[var(--hc-accent)] flex items-center justify-center text-[var(--hc-accent-fg)] font-bold text-[11px] tracking-tight shrink-0">
            HC
          </div>
          <span className="font-bold text-[var(--hc-text)] text-xs tracking-tight whitespace-nowrap">
            HOP-Claw
          </span>
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
          type="button"
          onClick={() => createBlankDocument(true)}
          className="flex items-center gap-1.5 text-xs font-medium bg-[var(--hc-card)] hover:bg-[var(--hc-accent-soft)] text-[var(--hc-text)] px-2.5 py-1.5 rounded-md transition-colors border border-[var(--hc-border)] whitespace-nowrap shrink-0"
          title="새 HWPX 표준 문서 만들기"
        >
          <FilePlus2 className="w-3.5 h-3.5 text-[var(--hc-accent)]" />
          <span>새 문서</span>
        </button>

        <button
          id="btn-open-doc"
          type="button"
          onClick={handleOpen}
          className="flex items-center gap-1.5 text-xs font-medium bg-[var(--hc-card)] hover:bg-[var(--hc-accent-soft)] text-[var(--hc-text)] px-2.5 py-1.5 rounded-md transition-colors border border-[var(--hc-border)] whitespace-nowrap shrink-0"
        >
          <FolderOpen className="w-3.5 h-3.5 text-[var(--hc-muted)]" />
          <span>열기</span>
        </button>

        {stagingPath && (
          <>
            <button
              id="btn-save-doc"
              type="button"
              onClick={handleSave}
              disabled={!isDirty}
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors border whitespace-nowrap shrink-0 ${
                isDirty
                  ? "bg-[var(--hc-accent)] hover:bg-[var(--hc-accent-hover)] text-[var(--hc-accent-fg)] border-[var(--hc-accent)]"
                  : "bg-[var(--hc-surface-alt)] text-[var(--hc-muted)] opacity-55 border-[var(--hc-border-subtle)] cursor-not-allowed"
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              <span>원본 저장</span>
            </button>

            <button
              id="btn-undo-change"
              type="button"
              onClick={undoLastChange}
              disabled={undoHistoryBytes.length === 0}
              className="flex items-center gap-1 text-xs font-medium text-[var(--hc-muted)] hover:text-[var(--hc-text)] px-2 py-1.5 rounded-md hover:bg-[var(--hc-accent-soft)] disabled:opacity-40 tabular-nums whitespace-nowrap shrink-0 transition-colors"
              title="스테이징 스냅샷 되돌리기"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>실행취소 ({undoHistoryBytes.length})</span>
            </button>
          </>
        )}
      </div>

      {/* Center: Unboxed Document Metadata with Middle-Dot Separators */}
      <div className="flex items-center gap-2 text-xs text-[var(--hc-muted)] tabular-nums min-w-0">
        <span className="font-semibold text-[var(--hc-text)] truncate max-w-[240px]">
          {fileName}
        </span>
        {stagingPath && (
          <>
            <span className="opacity-45" aria-hidden="true">·</span>
            <span className="font-mono font-semibold text-[var(--hc-code)] whitespace-nowrap shrink-0">
              {isHwpx ? "HWPX" : "HWP"}
            </span>
          </>
        )}
        {isDirty && (
          <>
            <span className="opacity-45" aria-hidden="true">·</span>
            <span className="text-[var(--hc-warn)] font-medium whitespace-nowrap shrink-0">
              미저장
            </span>
          </>
        )}
        {diffCount > 0 && (
          <>
            <span className="opacity-45" aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 text-[var(--hc-warn)] font-semibold whitespace-nowrap shrink-0">
              <GitCompare className="w-3.5 h-3.5" />
              Diff {diffCount}건
            </span>
          </>
        )}
      </div>

      {/* Right: Writing Memory, Privacy Masking, 2-Style Palette Switch & Agent CLI */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Writing Memory Trigger */}
        <button
          id="btn-open-writing-memory"
          type="button"
          data-testid="header-writing-memory-btn"
          onClick={() => openMemoryModal("list")}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors font-medium tabular-nums whitespace-nowrap shrink-0 ${
            activeMemoryIds.length > 0
              ? "bg-[var(--hc-accent-soft)] border-[var(--hc-accent)] text-[var(--hc-text)]"
              : "bg-[var(--hc-card)] border-[var(--hc-border)] text-[var(--hc-muted)] hover:text-[var(--hc-text)] hover:bg-[var(--hc-accent-soft)]"
          }`}
          title="작성 선호사항 (양식 메모리) 관리 및 $HWP_WRITING_MEMORY_PATH 주입 설정"
        >
          <BookMarked className="w-3.5 h-3.5 text-[var(--hc-accent)]" />
          <span>
            작성 메모리
            {activeMemoryIds.length > 0
              ? ` · ${activeMemoryIds.length}`
              : memoriesIndex.length > 0
              ? ` · ${memoriesIndex.length}`
              : ""}
          </span>
        </button>

        {/* PII Privacy Protection Trigger */}
        <button
          id="btn-open-pii-modal"
          type="button"
          onClick={() => setPiiModalOpen(true)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors font-medium tabular-nums whitespace-nowrap shrink-0 ${
            autoMaskPii || excludedRegions.length > 0
              ? "bg-[var(--hc-success-soft)] border-[var(--hc-success)] text-[var(--hc-success)]"
              : "bg-[var(--hc-card)] border-[var(--hc-border)] text-[var(--hc-muted)] hover:text-[var(--hc-text)] hover:bg-[var(--hc-accent-soft)]"
          }`}
          title="개인정보(PII) 12종 자동 마스킹 및 제외 영역 관리"
        >
          {autoMaskPii || excludedRegions.length > 0 ? (
            <ShieldCheck className="w-3.5 h-3.5" />
          ) : (
            <ShieldAlert className="w-3.5 h-3.5 text-[var(--hc-muted)]" />
          )}
          <span>
            PII 보호
            {autoMaskPii ? " · ON" : ""}
            {excludedRegions.length > 0 ? ` · 제외 ${excludedRegions.length}` : ""}
          </span>
        </button>

        {/* Dual Palette Segmented Switcher (Rose Blossom / Amber Espresso) */}
        <div
          id="btn-cycle-theme"
          role="group"
          aria-label="배색 스타일 선택"
          className="inline-flex items-center p-0.5 rounded-md bg-[var(--hc-card)] border border-[var(--hc-border)] shrink-0"
        >
          <button
            id="btn-palette-rose"
            type="button"
            onClick={() => setUiPalette("rose")}
            aria-pressed={uiPalette === "rose"}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
              uiPalette === "rose"
                ? "bg-[var(--hc-accent)] text-[var(--hc-accent-fg)]"
                : "text-[var(--hc-muted)] hover:text-[var(--hc-text)]"
            }`}
            title="로즈 블라썸 스타일 (라이트 모드)"
          >
            <Flower2 className="w-3 h-3" />
            <span>로즈</span>
          </button>
          <button
            id="btn-palette-espresso"
            type="button"
            onClick={() => setUiPalette("espresso")}
            aria-pressed={uiPalette === "espresso"}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
              uiPalette === "espresso"
                ? "bg-[var(--hc-accent)] text-[var(--hc-accent-fg)]"
                : "text-[var(--hc-muted)] hover:text-[var(--hc-text)]"
            }`}
            title="앰버 에스프레소 스타일 (다크 모드)"
          >
            <Coffee className="w-3 h-3" />
            <span>에스프레소</span>
          </button>
        </div>

        {/* GPL v3 License Modal Trigger */}
        <button
          id="btn-open-gpl-license"
          type="button"
          onClick={() => setLicenseModalOpen(true)}
          className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-md border border-[var(--hc-border)] bg-[var(--hc-card)] text-[var(--hc-muted)] hover:text-[var(--hc-text)] hover:bg-[var(--hc-accent-soft)] transition-colors whitespace-nowrap shrink-0"
          title="GNU GPL v3.0 오픈소스 라이선스 고지"
        >
          <Scale className="w-3.5 h-3.5 text-[var(--hc-accent)]" />
          <span className="font-medium">GPL</span>
        </button>

        <div className="h-4 w-px bg-[var(--hc-border)] mx-0.5 shrink-0" />

        {/* Dock Position Toggle (Right / Bottom) */}
        {cliPanelOpen && (
          <button
            id="btn-toggle-cli-dock"
            type="button"
            onClick={toggleCliPanelDock}
            className="flex items-center gap-1 text-xs p-1.5 rounded-md border border-[var(--hc-border)] bg-[var(--hc-card)] text-[var(--hc-muted)] hover:text-[var(--hc-text)] hover:bg-[var(--hc-accent-soft)] transition-colors shrink-0"
            title={
              cliPanelDock === "right"
                ? "에이전트 CLI 패널을 하단(Bottom)으로 도킹"
                : "에이전트 CLI 패널을 우측(Right)으로 도킹"
            }
            aria-label={cliPanelDock === "right" ? "하단 도킹" : "우측 도킹"}
          >
            {cliPanelDock === "right" ? (
              <PanelBottom className="w-3.5 h-3.5" />
            ) : (
              <PanelRight className="w-3.5 h-3.5" />
            )}
          </button>
        )}

        {/* Agent CLI Panel Open/Close Toggle */}
        <button
          id="btn-toggle-cli-panel"
          type="button"
          onClick={toggleCliPanel}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border font-semibold transition-colors whitespace-nowrap shrink-0 ${
            cliPanelOpen
              ? "bg-[var(--hc-accent)] text-[var(--hc-accent-fg)] border-[var(--hc-accent)]"
              : "bg-[var(--hc-card)] text-[var(--hc-text)] border-[var(--hc-border)] hover:bg-[var(--hc-accent-soft)]"
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
          className="fixed top-13 right-4 z-50 flex items-center gap-2.5 px-3.5 py-2 rounded-lg bg-[var(--hc-card)] text-[var(--hc-text)] text-xs font-medium border border-[var(--hc-border)] shadow-lg"
        >
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => showToastMessage(null)}
            className="text-[var(--hc-muted)] hover:text-[var(--hc-text)] transition-colors"
            title="알림 닫기"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </header>
  );
};
