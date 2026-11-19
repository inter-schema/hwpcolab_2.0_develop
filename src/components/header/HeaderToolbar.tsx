import React, { useState } from "react";
import { useDocStore } from "../../store/useDocStore";
import { runtimeInvoke as invoke, isTauriEnv } from "../../core/runtimeInvoke";
import {
  FolderOpen,
  Save,
  Undo2,
  Clock,
  MoreHorizontal,
  Scale,
  FilePlus2,
  BookMarked,
  Terminal,
  PanelRight,
  PanelBottom,
  ShieldCheck,
} from "lucide-react";

export const HeaderToolbar: React.FC = () => {
  const {
    fileName,
    isHwpx,
    isDirty,
    undoHistoryBytes,
    cliPanelOpen,
    cliPanelDock,
    autoMaskPii,
    excludedRegions,
    openDocument,
    openDocumentBytes,
    createBlankDocument,
    saveToOriginalFile,
    undoLastChange,
    toggleCliPanel,
    toggleCliPanelDock,
    setPiiModalOpen,
    setLicenseModalOpen,
    openMemoryModal,
    activeMemoryIds,
  } = useDocStore();

  const [sampleMenuOpen, setSampleMenuOpen] = useState(false);

  const handleOpen = async () => {
    try {
      if (isTauriEnv()) {
        const selected = await invoke<string | null>("pick_local_file", {
          extensions: ["hwp", "hwpx"],
        });
        if (selected) {
          await openDocument(selected);
        }
      } else {
        const fileInput = document.getElementById(
          "header-hwp-file-input"
        ) as HTMLInputElement | null;
        fileInput?.click();
      }
    } catch (e: any) {
      console.error("[HeaderToolbar] 파일 열기 오류:", e);
    }
  };

  const handleSave = async () => {
    try {
      await saveToOriginalFile();
    } catch (e: any) {
      console.error("[HeaderToolbar] 저장 실패:", e);
    }
  };

  return (
    <header
      id="top-studio-header"
      className="h-11 bg-white border-b border-slate-200 px-3 flex items-center justify-between z-30 select-none shrink-0"
    >
      {/* Hidden browser file input for non-Tauri open */}
      <input
        id="header-hwp-file-input"
        type="file"
        accept=".hwp,.hwpx"
        className="hidden"
        onChange={async (e) => {
          const input = e.target;
          const f = input.files?.[0];
          if (!f) return;
          try {
            const bytes = new Uint8Array(await f.arrayBuffer());
            await openDocumentBytes(bytes, f.name);
          } catch (err: any) {
            console.error("[HeaderToolbar] 파일 열기 실패:", err);
          } finally {
            input.value = "";
          }
        }}
      />

      {/* Left: Brand + Document Title + Sample Switcher + File Ops */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-extrabold text-slate-900 text-sm tracking-tight whitespace-nowrap">
            HOP-Claw Studio
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
              isHwpx
                ? "bg-indigo-100 text-indigo-700 border border-indigo-200"
                : "bg-slate-100 text-slate-700 border border-slate-200"
            }`}
          >
            {isHwpx ? "HWPX" : "HWP"}
          </span>
        </div>

        <span
          id="header-doc-filename"
          data-testid="header-doc-name"
          className="text-xs text-slate-600 font-medium max-w-[260px] truncate"
          title={fileName}
        >
          {fileName.replace(/\.(hwp|hwpx)$/i, "")}
        </span>

        {/* Sample / Quick Switcher Menu */}
        <div className="relative">
          <button
            id="header-more-doc-btn"
            data-testid="header-more-doc-btn"
            onClick={() => setSampleMenuOpen((v) => !v)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
            title="샘플 문서 전환 및 새 문서 메뉴"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {sampleMenuOpen && (
            <div
              onMouseLeave={() => setSampleMenuOpen(false)}
              className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl py-1.5 min-w-[270px] z-50 text-xs"
            >
              <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase">
                샘플 문서 불러오기
              </div>
              <button
                id="load-sample-lesson-hwpx"
                onClick={async () => {
                  setSampleMenuOpen(false);
                  await openDocument(
                    "samples/(날짜)(교시)(과목명)교수.학습과정안(이름).hwpx"
                  );
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-50 text-slate-700 flex items-center justify-between cursor-pointer"
              >
                <span>📄 교수·학습 과정안 양식 (.hwpx · 중첩 표 지원)</span>
              </button>
              <button
                id="load-sample-ai-plan-hwpx"
                onClick={async () => {
                  setSampleMenuOpen(false);
                  await openDocument("samples/2026_AI_행정업무_혁신계획(기획안).hwpx");
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-50 text-slate-700 flex items-center justify-between cursor-pointer"
              >
                <span>🏛️ 2026 AI 행정업무 혁신계획 기획안 (.hwpx)</span>
              </button>
              <button
                id="load-sample-official-hwpx"
                onClick={async () => {
                  setSampleMenuOpen(false);
                  await openDocument("samples/demo_official_report.hwpx");
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-50 text-slate-700 flex items-center justify-between cursor-pointer"
              >
                <span>🏛️ 행정기관 공문서 샘플 (.hwpx)</span>
              </button>
              <button
                id="load-sample-lesson-hwp"
                onClick={async () => {
                  setSampleMenuOpen(false);
                  await openDocument(
                    "samples/(날짜)(교시)(과목명)교수.학습과정안(이름).hwp"
                  );
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-50 text-slate-700 flex items-center justify-between cursor-pointer"
              >
                <span>📄 교수·학습 과정안 양식 (.hwp)</span>
              </button>
              <button
                id="load-sample-official-hwp"
                onClick={async () => {
                  setSampleMenuOpen(false);
                  await openDocument("samples/demo_official_report.hwp");
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-50 text-slate-700 flex items-center justify-between cursor-pointer"
              >
                <span>🏛️ 행정기관 공문서 샘플 (.hwp)</span>
              </button>
              <div className="my-1 border-t border-slate-100" />
              <button
                id="header-new-hwpx-btn"
                onClick={async () => {
                  setSampleMenuOpen(false);
                  await createBlankDocument(true);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5 text-indigo-600" />
                <span>새 빈 문서 (.hwpx · 표준 권장)</span>
              </button>
              <button
                id="header-new-hwp-btn"
                onClick={async () => {
                  setSampleMenuOpen(false);
                  await createBlankDocument(false);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5 text-slate-500" />
                <span>새 빈 문서 (.hwp)</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 text-xs text-slate-500 ml-1 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>{isDirty ? "수정됨 ●" : "저장됨"}</span>
        </div>

        <div className="h-4 w-px bg-slate-200 mx-1.5" />

        {/* File Open / Save / Undo quick buttons */}
        <button
          id="header-open-btn"
          onClick={handleOpen}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded text-slate-700 hover:bg-slate-100 font-medium cursor-pointer"
          title="로컬 HWP/HWPX 열기 (Ctrl+O)"
        >
          <FolderOpen className="w-3.5 h-3.5 text-slate-600" />
          <span>열기</span>
        </button>

        <button
          id="header-save-btn"
          onClick={handleSave}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded font-medium transition-colors cursor-pointer ${
            isDirty
              ? "bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100"
              : "text-slate-500 hover:bg-slate-100"
          }`}
          title="스테이징 변경사항을 원본 파일에 저장 (Ctrl+S)"
        >
          <Save className="w-3.5 h-3.5" />
          <span>저장{isDirty ? "*" : ""}</span>
        </button>

        <button
          id="header-undo-btn"
          onClick={undoLastChange}
          disabled={undoHistoryBytes.length === 0}
          className={`p-1 rounded transition-colors ${
            undoHistoryBytes.length > 0
              ? "text-slate-700 hover:bg-slate-100 cursor-pointer"
              : "text-slate-300 cursor-not-allowed"
          }`}
          title="패치/스테이징 변경 되돌리기 (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right: Writing Memory + PII Protection + Agent CLI Terminal Controls + GPL v3.0 */}
      <div className="flex items-center gap-2">
        <button
          id="header-writing-memory-btn"
          data-testid="header-writing-memory-btn"
          onClick={() => openMemoryModal("list")}
          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          title="작성 선호사항 메모리 관리 ($HWP_WRITING_MEMORY_PATH)"
        >
          <BookMarked className="w-3.5 h-3.5 text-teal-600" />
          <span>작성 선호사항</span>
          {activeMemoryIds.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-teal-100 text-teal-800">
              {activeMemoryIds.length}
            </span>
          )}
        </button>

        <button
          id="header-pii-privacy-btn"
          data-testid="header-pii-privacy-btn"
          onClick={() => setPiiModalOpen(true)}
          className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border transition-colors cursor-pointer ${
            autoMaskPii || excludedRegions.length > 0
              ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold"
              : "border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
          title="개인정보(PII) 자동 마스킹 및 제외 영역 관리"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>PII 보호</span>
          {(autoMaskPii || excludedRegions.length > 0) && (
            <span className="text-[10px] font-bold px-1 rounded bg-emerald-200/80 text-emerald-900">
              {autoMaskPii ? "ON" : `제외${excludedRegions.length}`}
            </span>
          )}
        </button>

        <button
          id="header-dock-toggle-btn"
          data-testid="header-dock-toggle-btn"
          onClick={toggleCliPanelDock}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
          title="에이전트 CLI 터미널 도킹 위치 전환 (우측 / 하단)"
        >
          {cliPanelDock === "right" ? (
            <PanelRight className="w-3.5 h-3.5 text-indigo-600" />
          ) : (
            <PanelBottom className="w-3.5 h-3.5 text-indigo-600" />
          )}
          <span>CLI 도킹: {cliPanelDock === "right" ? "우측" : "하단"}</span>
        </button>

        <button
          id="header-cli-toggle-btn"
          data-testid="header-cli-toggle-btn"
          onClick={toggleCliPanel}
          className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded font-semibold transition-colors cursor-pointer ${
            cliPanelOpen
              ? "bg-indigo-600 text-white shadow-xs"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
          title="에이전트 CLI 터미널 패널 열기/닫기 (Ctrl+B)"
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Agent CLI</span>
        </button>

        <button
          id="header-license-btn"
          data-testid="header-license-btn"
          onClick={() => setLicenseModalOpen(true)}
          className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 px-2 py-1 rounded transition-colors cursor-pointer"
          title="GNU General Public License v3.0 라이선스 정보"
        >
          <Scale className="w-3.5 h-3.5 text-slate-500" />
          <span>GPL v3.0</span>
        </button>
      </div>
    </header>
  );
};
