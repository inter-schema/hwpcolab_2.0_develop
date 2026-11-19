import React, { useEffect } from "react";
import { HeaderToolbar } from "./components/header/HeaderToolbar";
import { HopEditorHost } from "./components/viewer/HopEditorHost";
import { AgentCliPanel } from "./components/terminal/AgentCliPanel";
import { PiiPrivacyModal } from "./components/modals/PiiPrivacyModal";
import { LicenseModal } from "./components/header/LicenseModal";
import { WritingMemoryModal } from "./components/memory/WritingMemoryModal";
import { useDocStore } from "./store/useDocStore";
import { isTauriEnv, runtimeInvoke } from "./core/runtimeInvoke";

export const App: React.FC = () => {
  const {
    openDocument,
    saveToOriginalFile,
    undoLastChange,
    acceptStagingDiff,
    acceptAllDiffs,
    toggleCliPanel,
    cliPanelDock,
    stagingDiffSession,
    pendingDiffs,
    isDirty,
    refreshMemoriesIndex,
  } = useDocStore();

  useEffect(() => {
    void refreshMemoriesIndex();
    const handleOpenWritingMemory = (e: Event) => {
      const customEvent = e as CustomEvent<{
        tab?: "list" | "create_multi" | "create_current";
      }>;
      const tab = customEvent.detail?.tab;
      useDocStore.getState().openMemoryModal(tab || "create_multi");
    };
    window.addEventListener("hop:open-writing-memory", handleOpenWritingMemory);
    return () => {
      window.removeEventListener(
        "hop:open-writing-memory",
        handleOpenWritingMemory
      );
    };
  }, [refreshMemoriesIndex]);

  // Open startup document (defaults to HWPX sample so nested table creation works immediately)
  useEffect(() => {
    runtimeInvoke<string | null>("get_startup_file")
      .then(async (filePath) => {
        if (filePath) {
          await openDocument(filePath);
        } else {
          try {
            await openDocument(
              "samples/(날짜)(교시)(과목명)교수.학습과정안(이름).hwpx"
            );
          } catch {
            try {
              await openDocument(
                "samples/2026_AI_행정업무_혁신계획(기획안).hwpx"
              );
            } catch {
              try {
                await openDocument("samples/demo_official_report.hwpx");
              } catch (err) {
                console.warn("Could not open default sample document:", err);
              }
            }
          }
        }
      })
      .catch(() => {});
  }, [openDocument]);

  // Global IDE Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      // Ctrl+O: Open document
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "o" &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        try {
          if (isTauriEnv()) {
            const selected = await runtimeInvoke<string | null>(
              "pick_local_file",
              {
                extensions: ["hwp", "hwpx"],
              }
            );
            if (selected) {
              await openDocument(selected);
            }
          } else {
            const fileInput = document.getElementById(
              "header-hwp-file-input"
            ) as HTMLInputElement | null;
            fileInput?.click();
          }
        } catch (err) {
          console.error("Open shortcut error:", err);
        }
      }

      // Ctrl+S: Save document
      if (e.ctrlKey && e.key.toLowerCase() === "s" && !e.shiftKey) {
        e.preventDefault();
        if (isDirty) {
          try {
            await saveToOriginalFile();
          } catch (err) {
            console.error("Save shortcut error:", err);
          }
        }
      }

      // Ctrl+B or Ctrl+`: Toggle Agent CLI Terminal Panel
      if (
        (e.ctrlKey && e.key.toLowerCase() === "b") ||
        (e.ctrlKey && e.key === "`")
      ) {
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag !== "textarea" && activeTag !== "input") {
          e.preventDefault();
          toggleCliPanel();
        }
      }

      // Ctrl+Enter: Accept pending staging diff
      if (e.ctrlKey && e.key === "Enter") {
        if (stagingDiffSession) {
          e.preventDefault();
          await acceptStagingDiff();
        } else if (pendingDiffs.length > 0) {
          e.preventDefault();
          await acceptAllDiffs();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    openDocument,
    saveToOriginalFile,
    undoLastChange,
    acceptStagingDiff,
    acceptAllDiffs,
    toggleCliPanel,
    stagingDiffSession,
    pendingDiffs,
    isDirty,
  ]);

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-white font-sans">
      {/* 1. Top IDE Studio Header Bar */}
      <HeaderToolbar />

      {/* 2. Main Studio Body: rhwp-studio Editor + Right/Bottom Dockable Agent CLI Panel */}
      <div
        className={`flex-1 flex overflow-hidden relative ${
          cliPanelDock === "bottom" ? "flex-col" : "flex-row"
        }`}
      >
        <HopEditorHost />
        <AgentCliPanel />
      </div>

      {/* 3. PII Protection & Excluded Regions Modal */}
      <PiiPrivacyModal />

      {/* 4. GNU GPL v3.0 License Modal */}
      <LicenseModal />

      {/* 5. Writing Memory Modal */}
      <WritingMemoryModal />
    </div>
  );
};

export default App;
