import React, { useEffect, useState } from "react";
import { HeaderToolbar } from "./components/header/HeaderToolbar";
import { LicenseModal } from "./components/header/LicenseModal";
import { WritingMemoryModal } from "./components/memory/WritingMemoryModal";
import { PiiPrivacyModal } from "./components/modals/PiiPrivacyModal";
import { HopEditorHost } from "./components/viewer/HopEditorHost";
import { RhwpDiffReviewOverlay } from "./components/viewer/RhwpDiffReviewOverlay";
import { AgentCliPanel } from "./components/terminal/AgentCliPanel";
import { useDocStore } from "./store/useDocStore";
import { runtimeInvoke as invoke, isTauriRuntime } from "./core/runtimeInvoke";
import { parseLocalAttachment } from "./core/multiFileParser";

export const App: React.FC = () => {
  const {
    openDocument,
    openDocumentBytes,
    createBlankDocument,
    addAttachment,
    cliPanelOpen,
    cliPanelDock,
    stagingPath,
    isHwpx,
    activeMemoryIds,
    autoMaskPii,
    excludedRegions,
    stagingDiffSession,
  } = useDocStore();
  const [isWindowDragging, setIsWindowDragging] = useState(false);

  // 앱 시작 시: OS 파일 연결 인자 조회 또는 빈 HWPX 문서로 초기화 + 작성 메모리 인덱스 로드
  useEffect(() => {
    useDocStore
      .getState()
      .refreshMemoriesIndex()
      .catch((err) => {
        console.warn("Failed to load Writing Memory index:", err);
      });

    (async () => {
      try {
        const startupPath = await invoke<string | null>("get_startup_file");
        if (startupPath) {
          await openDocument(startupPath);
        } else {
          await createBlankDocument(true);
        }
      } catch (e) {
        console.warn("Startup init fallback:", e);
        try {
          await createBlankDocument(true);
        } catch {}
      }
    })();
  }, [openDocument, createBlankDocument]);

  // 전체 창 드래그 앤 드롭 (네이티브 Tauri 이벤트 + 웹 HTML5 드롭 지원)
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const handleFilePaths = async (paths: string[]) => {
      for (const filePath of paths) {
        const lower = filePath.toLowerCase();
        if (lower.endsWith(".hwp") || lower.endsWith(".hwpx")) {
          await openDocument(filePath);
        } else if (
          lower.endsWith(".xlsx") ||
          lower.endsWith(".xls") ||
          lower.endsWith(".csv") ||
          lower.endsWith(".pdf") ||
          lower.endsWith(".docx") ||
          lower.endsWith(".png") ||
          lower.endsWith(".jpg") ||
          lower.endsWith(".jpeg") ||
          lower.endsWith(".webp")
        ) {
          try {
            const rawBytes = await invoke<number[]>("read_attachment_bytes", { filePath });
            const fileName = filePath.split(/[\\/]/).pop() || "attachment";
            const parsed = await parseLocalAttachment(fileName, new Uint8Array(rawBytes));
            addAttachment(parsed);
          } catch (err) {
            console.error("Dropped attachment load error:", err);
          }
        }
      }
    };

    if (isTauriRuntime()) {
      import("@tauri-apps/api/webviewWindow")
        .then(({ getCurrentWebviewWindow }) => {
          const appWindow = getCurrentWebviewWindow();
          return appWindow.onDragDropEvent(async (event) => {
            if (event.payload.type === "over") {
              setIsWindowDragging(true);
            } else if (event.payload.type === "leave") {
              setIsWindowDragging(false);
            } else if (event.payload.type === "drop") {
              setIsWindowDragging(false);
              await handleFilePaths(event.payload.paths);
            }
          });
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    }

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsWindowDragging(false);
      if (isTauriRuntime()) return;
      const files = Array.from(e.dataTransfer?.files || []);
      for (const file of files) {
        const lower = file.name.toLowerCase();
        const buf = new Uint8Array(await file.arrayBuffer());
        if (lower.endsWith(".hwp") || lower.endsWith(".hwpx")) {
          await openDocumentBytes(buf, file.name);
        } else {
          const parsed = await parseLocalAttachment(file.name, buf);
          addAttachment(parsed);
        }
      }
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);

    return () => {
      if (unlisten) unlisten();
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [openDocument, openDocumentBytes, addAttachment]);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#F8FAFC] dark:bg-[#0D1117] text-[#0F172A] dark:text-[#F0F6FC] overflow-hidden relative">
      {/* 전체 창 드래그 앤 드롭 안내 오버레이 */}
      {isWindowDragging && (
        <div className="fixed inset-0 z-50 bg-teal-600/20 backdrop-blur-xs border-4 border-dashed border-teal-500 flex items-center justify-center pointer-events-none">
          <div className="bg-white dark:bg-[#161B22] px-8 py-6 rounded-xl shadow-2xl border border-teal-100 dark:border-teal-800 text-center">
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100">
              여기에 파일을 놓아 열기
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              HWP / HWPX 문서는 캔버스에서 즉시 열리고, 엑셀·워드·PDF·이미지는 참고 첨부 자료로 등록됩니다.
            </p>
          </div>
        </div>
      )}

      {/* 상단 통합 헤더 툴바 */}
      <HeaderToolbar />

      {/* 메인 워크스페이스: rhwp-studio 캔버스 + 도킹형 에이전트 CLI 패널 (우측 또는 하단) */}
      <div
        className={`flex-1 flex overflow-hidden relative ${
          cliPanelOpen && cliPanelDock === "bottom" ? "flex-col" : "flex-row"
        }`}
      >
        {/* 중앙: 최신 rhwp-studio 직접 호스팅 캔버스 + 시각적 Diff 리뷰 배너 */}
        <div className="flex-1 h-full min-w-0 min-h-0 overflow-hidden relative">
          <HopEditorHost />
          <RhwpDiffReviewOverlay />
        </div>

        {/* 우측 또는 하단 도킹형 에이전트 CLI 터미널 패널 */}
        <AgentCliPanel />
      </div>

      {/* 최하단 IDE 상태바 (24px) */}
      <footer
        id="hop-ide-status-bar"
        className="h-6 px-3 bg-[#F1F5F9] dark:bg-[#161B22] border-t border-[#E2E8F0] dark:border-[#21262D] flex items-center justify-between text-[11px] text-[#475569] dark:text-[#8B949E] font-mono tabular-nums select-none shrink-0"
      >
        <div className="flex items-center gap-2 truncate">
          <span className="font-semibold text-[#0F172A] dark:text-[#F0F6FC]">
            {isHwpx ? "OWPML/HWPX" : "Binary/HWP"}
          </span>
          <span>·</span>
          <span className="truncate max-w-[320px]" title={stagingPath || ""}>
            Staging: {stagingPath ? stagingPath.split("/").slice(-2).join("/") : "대기 중"}
          </span>
          <span>·</span>
          <span>
            Diff: {stagingDiffSession ? `${stagingDiffSession.diffItems.length}건 대기` : "동기화됨"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span>작성 메모리: {activeMemoryIds.length}개 활성</span>
          <span>·</span>
          <span>
            PII 마스킹: {autoMaskPii ? "ON" : "OFF"}
            {excludedRegions.length > 0 ? ` (제외 ${excludedRegions.length})` : ""}
          </span>
          <span>·</span>
          <span>GPL-3.0-or-later</span>
        </div>
      </footer>

      {/* GPL v3.0 오픈소스 라이선스 모달 */}
      <LicenseModal />

      {/* 작성 선호사항 (Writing Memory) 모달 */}
      <WritingMemoryModal />

      {/* 개인정보(PII) 마스킹 및 제외 영역 관리 모달 */}
      <PiiPrivacyModal />
    </div>
  );
};

export default App;
