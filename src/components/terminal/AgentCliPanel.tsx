import React, { useState, useRef, useEffect } from "react";
import {
  Play,
  Trash2,
  RefreshCw,
  PanelRight,
  PanelBottom,
  FileSearch,
  BookOpen,
  Table2,
  CheckCircle2,
  Sparkles,
  FileSpreadsheet,
  Copy,
  Check,
  X,
  Plus,
  Crosshair,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Flower2,
  Coffee,
} from "lucide-react";
import { useDocStore, type CliPresetId } from "../../store/useDocStore";
import { runtimeInvoke as invoke, isTauriRuntime } from "../../core/runtimeInvoke";

const BUILTIN_CLI_PRESETS: Array<{
  id: CliPresetId;
  label: string;
  badge: string;
  hint: string;
  sampleCmd: string;
}> = [
  {
    id: "claude",
    label: "Claude Code",
    badge: "claude",
    hint: 'claude -p "..." 또는 hwp-cli 명령 입력',
    sampleCmd: `claude -p "resources/skills/hwp-document-editor/SKILL.md 규격에 따라 $HWP_STAGING_PATH 문서를 분석하고 $HWP_WRITING_MEMORY_PATH 지침을 반영해 교정해 줘"`,
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    badge: "gemini",
    hint: 'gemini -p "..." 또는 hwp-cli 명령 입력',
    sampleCmd: `gemini -p "resources/skills/hwp-document-editor/SKILL.md 스킬을 사용해 $HWP_STAGING_PATH 문서의 표와 본문을 검수하고 수정해 줘"`,
  },
  {
    id: "codex",
    label: "Codex",
    badge: "codex",
    hint: 'codex "..." 또는 hwp-cli 명령 입력',
    sampleCmd: `codex "$HWP_STAGING_PATH 문서를 hwp-cli로 검사하고 공문서 양식에 맞게 다듬어 줘"`,
  },
  {
    id: "hwp-shell",
    label: "HWP Skill Shell",
    badge: "bash",
    hint: "hwp-cli / ref-extract 내장 스킬 직접 실행",
    sampleCmd: `hwp-cli inspect "$HWP_STAGING_PATH"`,
  },
];

const GUIDE_COMMANDS: Array<{ label: string; command: string }> = [
  {
    label: "문서 전문 마크다운 추출",
    command: `hwp-cli extract "$HWP_STAGING_PATH" --format markdown`,
  },
  {
    label: "표 셀 텍스트 수정 · 자동 Diff 리뷰",
    command: `hwp-cli set-cell "$HWP_STAGING_PATH" --table 0 --row 1 --col 1 --text "수정값"`,
  },
  {
    label: "참고자료(XLSX/DOCX/HWP) 마크다운 추출",
    command: `ref-extract samples/demo_budget_ref.xlsx --format markdown`,
  },
];

export const AgentCliPanel: React.FC = () => {
  const {
    stagingPath,
    isHwpx,
    selection,
    activeMemoryIds,
    writingMemoryFilePath,
    autoMaskPii,
    cliPanelOpen,
    cliPanelDock,
    cliPanelWidth,
    cliPanelHeight,
    activeCliPreset,
    customCliPresets,
    cliTabs,
    activeCliTabId,
    cliHistory,
    cliRunning,
    uiPalette,
    toggleUiPalette,
    toggleCliPanel,
    toggleCliPanelDock,
    setCliPanelWidth,
    setCliPanelHeight,
    setActiveCliPreset,
    addCustomCliPreset,
    removeCustomCliPreset,
    addCliTab,
    closeCliTab,
    setActiveCliTab,
    clearCliHistory,
    runCliCommand,
    runSkillCommand,
    checkExternalStagingModification,
    syncWritingMemoryFileToDisk,
    showToastMessage,
  } = useDocStore();

  const [commandInput, setCommandInput] = useState("");
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [showToolsDrawer, setShowToolsDrawer] = useState(false);
  const [showCustomPresetForm, setShowCustomPresetForm] = useState(false);
  const [customPresetLabel, setCustomPresetLabel] = useState("");
  const [customPresetPrefix, setCustomPresetPrefix] = useState("");

  const logEndRef = useRef<HTMLDivElement>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const tabHistory = cliHistory.filter(
    (entry) => !entry.tabId || entry.tabId === activeCliTabId
  );

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [tabHistory.length, cliRunning]);

  // Periodic polling to detect external CLI file modifications
  useEffect(() => {
    if (!stagingPath) return;
    const timer = window.setInterval(() => {
      void checkExternalStagingModification(false);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [stagingPath, checkExternalStagingModification]);

  // Trigger rhwp-studio canvas viewport recalculation when dock or dimensions change
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
    return () => window.cancelAnimationFrame(id);
  }, [cliPanelOpen, cliPanelDock, cliPanelWidth, cliPanelHeight]);

  // Drag resize handler
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (cliPanelDock === "right") {
        const nextWidth = window.innerWidth - e.clientX;
        setCliPanelWidth(nextWidth);
      } else {
        const nextHeight = window.innerHeight - e.clientY;
        setCliPanelHeight(nextHeight);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      window.dispatchEvent(new Event("resize"));
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, cliPanelDock, setCliPanelWidth, setCliPanelHeight]);

  if (!cliPanelOpen) return null;

  const currentBuiltin = BUILTIN_CLI_PRESETS.find((p) => p.id === activeCliPreset);
  const currentCustom = customCliPresets.find((p) => p.id === activeCliPreset);
  const currentPresetMeta = currentBuiltin || {
    id: currentCustom?.id || "custom",
    label: currentCustom?.label || "Custom CLI",
    badge: currentCustom?.commandPrefix.split(" ")[0] || "cli",
    hint: `${currentCustom?.commandPrefix || "cli"} "$HWP_STAGING_PATH"`,
    sampleCmd: `${currentCustom?.commandPrefix || "echo"} "$HWP_STAGING_PATH"`,
  };

  const handleExecute = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cmd = commandInput.trim();
    if (!cmd || cliRunning) return;
    setCommandInput("");
    await runCliCommand(cmd, activeCliPreset);
  };

  const handleQuickSkillArgs = async (
    skill: "ref-extract" | "hwp-cli",
    args: string[],
    displayCommand?: string
  ) => {
    if (cliRunning) return;
    await runSkillCommand(skill, args, displayCommand);
  };

  const handleFillCommand = (cmd: string) => {
    setCommandInput(cmd);
    commandInputRef.current?.focus();
  };

  const handleInjectSelectionContext = () => {
    if (!selection) {
      showToastMessage("캔버스에서 먼저 본문 문단이나 표 셀을 선택해 주세요.");
      return;
    }
    const summary =
      selection.kind === "table_cells"
        ? `표 #${selection.tableIndex} (${selection.startRow},${selection.startCol})`
        : `문단 #${selection.startPara}`;
    const snippet = `$HWP_SELECTION_JSON`;
    setCommandInput((prev) => (prev ? `${prev} ${snippet}` : `echo '${summary}' && echo ${snippet}`));
    commandInputRef.current?.focus();
    showToastMessage(`선택 영역 컨텍스트(${summary})가 명령창에 주입되었습니다.`);
  };

  const handleInjectWritingMemory = async () => {
    const path = await syncWritingMemoryFileToDisk();
    const snippet = `$HWP_WRITING_MEMORY_PATH`;
    setCommandInput((prev) => (prev ? `${prev} ${snippet}` : `cat ${snippet}`));
    commandInputRef.current?.focus();
    showToastMessage(
      activeMemoryIds.length > 0
        ? `활성 작성 메모리(${activeMemoryIds.length}개) 경로(${path || snippet})가 주입되었습니다.`
        : "작성 메모리 환경변수($HWP_WRITING_MEMORY_PATH)가 명령창에 주입되었습니다."
    );
  };

  const handlePickReferenceFile = async () => {
    if (isTauriRuntime()) {
      try {
        const picked = await invoke<string | null>("pick_local_file", {
          extensions: ["hwp", "hwpx", "docx", "xlsx", "xls", "csv", "pdf", "md", "txt"],
        });
        if (picked) {
          const baseName = picked.split(/[\\/]/).pop() || picked;
          await handleQuickSkillArgs(
            "ref-extract",
            [picked, "--format", "markdown"],
            `ref-extract "${baseName}" --format markdown`
          );
        }
        return;
      } catch {
        // fallback to web input
      }
    }
    refFileInputRef.current?.click();
  };

  const handleWebReferenceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (refFileInputRef.current) refFileInputRef.current.value = "";
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const session = await invoke<{ staging_path: string }>("create_blank_session", {
        isHwpx: file.name.toLowerCase().endsWith(".hwpx"),
        fileName: file.name,
      });
      await invoke("write_file_bytes", {
        filePath: session.staging_path,
        bytes: Array.from(bytes),
      });
      await handleQuickSkillArgs(
        "ref-extract",
        [session.staging_path, "--format", "markdown"],
        `ref-extract "${file.name}" --format markdown`
      );
    } catch (err: any) {
      showToastMessage(`참고자료 추출 실패: ${err?.message || err}`);
    }
  };

  const handleCopyEnvSnippet = () => {
    const snippet = [
      `export HWP_STAGING_PATH="${stagingPath || ""}"`,
      `export HWP_WRITING_MEMORY_PATH="${writingMemoryFilePath || ""}"`,
    ].join("\n");
    navigator.clipboard.writeText(snippet);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 1800);
  };

  const handleAddCustomPreset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPresetLabel.trim() || !customPresetPrefix.trim()) return;
    addCustomCliPreset(customPresetLabel, customPresetPrefix);
    setCustomPresetLabel("");
    setCustomPresetPrefix("");
    setShowCustomPresetForm(false);
    showToastMessage(`커스텀 CLI 프리셋 '${customPresetLabel.trim()}'이(가) 추가되었습니다.`);
  };

  const selectionSummary = selection
    ? selection.kind === "table_cells"
      ? `표 #${selection.tableIndex} (${selection.startRow},${selection.startCol})`
      : `문단 #${selection.startPara}`
    : "전체 문서";

  return (
    <aside
      id="agent-cli-panel"
      style={
        cliPanelDock === "right"
          ? { width: `${cliPanelWidth}px` }
          : { height: `${cliPanelHeight}px` }
      }
      className={`hc-chrome relative bg-[var(--hc-bg)] text-[var(--hc-text)] flex flex-col select-none shrink-0 z-10 transition-colors duration-200 ${
        cliPanelDock === "right"
          ? "h-full border-l border-[var(--hc-border)]"
          : "w-full border-t border-[var(--hc-border)]"
      }`}
    >
      {/* Drag Resize Handle */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
        className={
          cliPanelDock === "right"
            ? "absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--hc-accent)]/40 transition-colors z-20"
            : "absolute top-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-[var(--hc-accent)]/40 transition-colors z-20"
        }
        title="드래그하여 터미널 패널 크기 조절"
      />

      <input
        ref={refFileInputRef}
        type="file"
        accept=".hwp,.hwpx,.docx,.xlsx,.xls,.csv,.pdf,.md,.txt"
        className="hidden"
        onChange={handleWebReferenceFileChange}
      />

      {/* 1. Folder-Style Session Tab Bar */}
      <div className="h-9 px-2.5 pt-1.5 bg-[var(--hc-surface)] border-b border-[var(--hc-border)] flex items-end justify-between gap-2 shrink-0">
        <div className="flex items-end gap-1 overflow-x-auto no-scrollbar min-w-0">
          {cliTabs.map((tab) => {
            const active = tab.id === activeCliTabId;
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveCliTab(tab.id)}
                className={`group flex items-center gap-1.5 px-3 py-1 rounded-t-md text-[11px] font-medium cursor-pointer transition-colors whitespace-nowrap border border-b-0 ${
                  active
                    ? "bg-[var(--hc-tab-active)] text-[var(--hc-text)] border-[var(--hc-border)] -mb-px pb-[5px]"
                    : "bg-transparent text-[var(--hc-muted)] border-transparent hover:text-[var(--hc-text)] hover:bg-[var(--hc-accent-soft)]/50"
                }`}
              >
                <span className="truncate max-w-[88px]">{tab.title}</span>
                <span aria-hidden="true" className="opacity-50">·</span>
                <span className="text-[10px] font-mono text-[var(--hc-code)]">{tab.preset}</span>
                {cliTabs.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeCliTab(tab.id);
                    }}
                    className="opacity-60 hover:opacity-100 text-[var(--hc-muted)] hover:text-[var(--hc-danger)] ml-0.5"
                    title="탭 닫기"
                    aria-label={`${tab.title} 탭 닫기`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            id="btn-add-cli-tab"
            onClick={() => addCliTab()}
            className="mb-1 p-1 rounded border border-[var(--hc-border-subtle)] bg-[var(--hc-card)]/70 text-[var(--hc-muted)] hover:text-[var(--hc-text)] hover:bg-[var(--hc-accent-soft)] transition-colors shrink-0"
            title="새 터미널 세션 탭 추가"
            aria-label="새 터미널 세션 탭 추가"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* Minimal Right Chrome Controls */}
        <div className="flex items-center gap-0.5 pb-1 shrink-0">
          <button
            type="button"
            id="btn-sidebar-palette-toggle"
            onClick={toggleUiPalette}
            className="p-1 text-[var(--hc-muted)] hover:text-[var(--hc-text)] hover:bg-[var(--hc-accent-soft)] rounded transition-colors"
            title={
              uiPalette === "rose"
                ? "앰버 에스프레소(다크) 스타일로 전환"
                : "로즈 블라썸(라이트) 스타일로 전환"
            }
            aria-label="배색 스타일 전환"
          >
            {uiPalette === "rose" ? (
              <Coffee className="w-3.5 h-3.5" />
            ) : (
              <Flower2 className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={toggleCliPanelDock}
            className="p-1 text-[var(--hc-muted)] hover:text-[var(--hc-text)] hover:bg-[var(--hc-accent-soft)] rounded transition-colors"
            title={
              cliPanelDock === "right"
                ? "하단(Bottom) 패널로 도킹 전환"
                : "우측(Right) 패널로 도킹 전환"
            }
            aria-label="도킹 방향 전환"
          >
            {cliPanelDock === "right" ? (
              <PanelBottom className="w-3.5 h-3.5" />
            ) : (
              <PanelRight className="w-3.5 h-3.5" />
            )}
          </button>
          {tabHistory.length > 0 && (
            <button
              type="button"
              onClick={clearCliHistory}
              className="p-1 text-[var(--hc-muted)] hover:text-[var(--hc-danger)] hover:bg-[var(--hc-danger-soft)] rounded transition-colors"
              title="현재 탭 터미널 출력 지우기"
              aria-label="터미널 출력 지우기"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleCliPanel}
            className="p-1 text-[var(--hc-muted)] hover:text-[var(--hc-text)] hover:bg-[var(--hc-accent-soft)] rounded transition-colors"
            title="패널 닫기"
            aria-label="패널 닫기"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Bracket-Style Preset Bar */}
      <div className="px-3.5 pt-2.5 pb-2 bg-[var(--hc-bg)] flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
        {BUILTIN_CLI_PRESETS.map((preset) => {
          const active = activeCliPreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setActiveCliPreset(preset.id)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors shrink-0 border ${
                active
                  ? "bg-[var(--hc-accent)] text-[var(--hc-accent-fg)] border-[var(--hc-accent)] font-semibold shadow-xs"
                  : "bg-[var(--hc-card)]/60 text-[var(--hc-text)] border-[var(--hc-border)] hover:bg-[var(--hc-accent-soft)]"
              }`}
            >
              [{preset.label}]
            </button>
          );
        })}
        {customCliPresets.map((preset) => {
          const active = activeCliPreset === preset.id;
          return (
            <div
              key={preset.id}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors shrink-0 border ${
                active
                  ? "bg-[var(--hc-accent)] text-[var(--hc-accent-fg)] border-[var(--hc-accent)] font-semibold"
                  : "bg-[var(--hc-card)]/60 text-[var(--hc-text)] border-[var(--hc-border)] hover:bg-[var(--hc-accent-soft)]"
              }`}
            >
              <button type="button" onClick={() => setActiveCliPreset(preset.id)}>
                [{preset.label}]
              </button>
              <button
                type="button"
                onClick={() => removeCustomCliPreset(preset.id)}
                className="opacity-70 hover:opacity-100"
                title="커스텀 프리셋 삭제"
                aria-label={`${preset.label} 프리셋 삭제`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          id="btn-toggle-custom-preset-form"
          onClick={() => setShowCustomPresetForm((v) => !v)}
          className="px-1.5 py-1 rounded-md text-[11px] text-[var(--hc-muted)] hover:text-[var(--hc-text)] hover:bg-[var(--hc-accent-soft)] whitespace-nowrap transition-colors shrink-0"
          title="사용자 정의 CLI 프리셋 추가"
        >
          +추가
        </button>
      </div>

      {/* Inline Custom CLI Preset Form */}
      {showCustomPresetForm && (
        <form
          onSubmit={handleAddCustomPreset}
          className="mx-3.5 mb-2 p-2 rounded-lg bg-[var(--hc-surface)] border border-[var(--hc-border)] flex items-center gap-2 text-[11px] shrink-0"
        >
          <input
            type="text"
            value={customPresetLabel}
            onChange={(e) => setCustomPresetLabel(e.target.value)}
            placeholder="이름 (예: Aider)"
            className="w-24 bg-[var(--hc-card)] border border-[var(--hc-border)] rounded px-2 py-1 text-[var(--hc-text)] placeholder-[var(--hc-muted)] focus:outline-none focus:border-[var(--hc-accent)]"
          />
          <input
            type="text"
            value={customPresetPrefix}
            onChange={(e) => setCustomPresetPrefix(e.target.value)}
            placeholder="명령어 (예: aider --message)"
            className="flex-1 min-w-0 bg-[var(--hc-card)] border border-[var(--hc-border)] rounded px-2 py-1 font-mono text-[var(--hc-text)] placeholder-[var(--hc-muted)] focus:outline-none focus:border-[var(--hc-accent)]"
          />
          <button
            type="submit"
            className="px-2.5 py-1 rounded bg-[var(--hc-accent)] hover:bg-[var(--hc-accent-hover)] text-[var(--hc-accent-fg)] font-semibold shrink-0"
          >
            추가
          </button>
        </form>
      )}

      {/* 3. Minimal Core 3-Button Row + Collapsible "도구" Drawer Toggle (Single-Line Rhythm) */}
      <div className="px-3.5 pb-2.5 border-b border-[var(--hc-border-subtle)] flex items-center justify-between gap-1.5 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            id="btn-inject-selection-context"
            onClick={handleInjectSelectionContext}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--hc-card)] hover:bg-[var(--hc-accent-soft)] text-[var(--hc-text)] border border-[var(--hc-border)] text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
            title="현재 캔버스 선택 좌표($HWP_SELECTION_JSON)를 CLI 명령에 주입"
          >
            <Crosshair className="w-3 h-3 text-[var(--hc-accent)] shrink-0" />
            <span>선택 영역</span>
          </button>

          <button
            type="button"
            id="btn-inject-writing-memory"
            onClick={() => void handleInjectWritingMemory()}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--hc-card)] hover:bg-[var(--hc-accent-soft)] text-[var(--hc-text)] border border-[var(--hc-border)] text-[11px] font-medium transition-colors tabular-nums whitespace-nowrap shrink-0"
            title="활성 작성 메모리 파일($HWP_WRITING_MEMORY_PATH) 동기화 및 주입"
          >
            <BookOpen className="w-3 h-3 text-[var(--hc-accent)] shrink-0" />
            <span>작성 메모리 ({activeMemoryIds.length})</span>
          </button>

          <button
            type="button"
            id="btn-extract-reference-doc"
            onClick={() => void handlePickReferenceFile()}
            disabled={cliRunning}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--hc-card)] hover:bg-[var(--hc-accent-soft)] text-[var(--hc-text)] border border-[var(--hc-border)] text-[11px] font-medium transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
            title="참고 문서(HWP/HWPX/DOCX/XLSX/PDF)를 ref-extract 스킬로 마크다운 추출"
          >
            <FileSpreadsheet className="w-3 h-3 text-[var(--hc-code)] shrink-0" />
            <span>참고자료 추출</span>
          </button>
        </div>

        <button
          type="button"
          id="btn-toggle-tools-drawer"
          aria-expanded={showToolsDrawer}
          onClick={() => setShowToolsDrawer((v) => !v)}
          className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
            showToolsDrawer
              ? "bg-[var(--hc-accent-soft)] border-[var(--hc-accent)] text-[var(--hc-text)]"
              : "bg-transparent border-[var(--hc-border-subtle)] text-[var(--hc-muted)] hover:text-[var(--hc-text)] hover:bg-[var(--hc-accent-soft)]/60"
          }`}
          title="스테이징 경로 및 내장 HWP 스킬 도구 펼치기/접기"
        >
          <SlidersHorizontal className="w-3 h-3 shrink-0" />
          <span>도구</span>
          {showToolsDrawer ? (
            <ChevronUp className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronDown className="w-3 h-3 shrink-0" />
          )}
        </button>
      </div>

      {/* 4. Collapsible Tools & Path Drawer (Hidden by default for clean minimalism) */}
      {showToolsDrawer && (
        <div
          id="agent-cli-tools-drawer"
          className="px-3.5 py-2.5 bg-[var(--hc-surface-alt)] border-b border-[var(--hc-border)] space-y-2 text-[11px] shrink-0"
        >
          {/* Staging Path & Quick Utility Row */}
          <div className="flex items-center justify-between gap-2 tabular-nums">
            <div className="flex items-center gap-1.5 truncate font-mono min-w-0">
              <span className="text-[var(--hc-code)] font-semibold shrink-0">$HWP_STAGING_PATH</span>
              <span className="opacity-45" aria-hidden="true">·</span>
              <span className="truncate text-[var(--hc-text)]" title={stagingPath || "문서 미로드"}>
                {stagingPath ? stagingPath.split("/").slice(-1)[0] : "(없음)"}
              </span>
              <span className="opacity-45" aria-hidden="true">·</span>
              <span className="text-[var(--hc-muted)] shrink-0">{selectionSummary}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => handleFillCommand(currentPresetMeta.sampleCmd)}
                className="text-[10px] font-medium text-[var(--hc-text)] bg-[var(--hc-accent-soft)] hover:bg-[var(--hc-accent)] hover:text-[var(--hc-accent-fg)] px-2 py-0.5 rounded border border-[var(--hc-border)] transition-colors whitespace-nowrap"
                title="선택한 에이전트 CLI 예시 프롬프트 채우기"
              >
                예시 채우기
              </button>
              <button
                type="button"
                onClick={handleCopyEnvSnippet}
                className="flex items-center gap-1 text-[10px] text-[var(--hc-muted)] hover:text-[var(--hc-text)] px-1.5 py-0.5 rounded bg-[var(--hc-card)] border border-[var(--hc-border)] transition-colors whitespace-nowrap"
                title="터미널 환경변수 export 스니펫 복사"
              >
                {copiedEnv ? (
                  <Check className="w-3 h-3 text-[var(--hc-success)]" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>{copiedEnv ? "복사됨" : "ENV"}</span>
              </button>
              <button
                type="button"
                onClick={() => void checkExternalStagingModification(true)}
                className="p-1 text-[var(--hc-muted)] hover:text-[var(--hc-text)] bg-[var(--hc-card)] border border-[var(--hc-border)] rounded transition-colors"
                title="스테이징 파일 변경사항 수동 감지 및 Diff 비교"
                aria-label="스테이징 수동 갱신"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Built-in hwp-cli Skill One-Click Actions (argument-array execution, no shell interpolation) */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              disabled={!stagingPath || cliRunning}
              onClick={() =>
                void handleQuickSkillArgs(
                  "hwp-cli",
                  ["inspect", "$HWP_STAGING_PATH"],
                  `hwp-cli inspect "$HWP_STAGING_PATH"`
                )
              }
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--hc-card)] hover:bg-[var(--hc-accent-soft)] text-[var(--hc-text)] border border-[var(--hc-border)] text-[11px] disabled:opacity-40 transition-colors whitespace-nowrap"
              title="hwp-cli inspect: 문서 구조·표·셀 인덱스 JSON 조회"
            >
              <FileSearch className="w-3 h-3 text-[var(--hc-accent)]" />
              <span>구조/표 검사</span>
            </button>

            <button
              type="button"
              disabled={!stagingPath || cliRunning}
              onClick={() =>
                void handleQuickSkillArgs(
                  "hwp-cli",
                  ["layout-check", "$HWP_STAGING_PATH"],
                  `hwp-cli layout-check "$HWP_STAGING_PATH"`
                )
              }
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--hc-card)] hover:bg-[var(--hc-accent-soft)] text-[var(--hc-text)] border border-[var(--hc-border)] text-[11px] disabled:opacity-40 transition-colors whitespace-nowrap"
              title="hwp-cli layout-check: 페이지 오버플로우·누락 항목 진단"
            >
              <CheckCircle2 className="w-3 h-3 text-[var(--hc-success)]" />
              <span>레이아웃 진단</span>
            </button>

            <button
              type="button"
              disabled={!stagingPath || cliRunning}
              onClick={() =>
                void handleQuickSkillArgs(
                  "hwp-cli",
                  ["official-format", "$HWP_STAGING_PATH", "--apply"],
                  `hwp-cli official-format "$HWP_STAGING_PATH" --apply`
                )
              }
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--hc-card)] hover:bg-[var(--hc-accent-soft)] text-[var(--hc-text)] border border-[var(--hc-border)] text-[11px] disabled:opacity-40 transition-colors whitespace-nowrap"
              title="hwp-cli official-format: 행정안전부 공문서 항목 위계·줄간격(160%) 점검 및 교정"
            >
              <Sparkles className="w-3 h-3 text-[var(--hc-code)]" />
              <span>공문서 규격 교정</span>
            </button>

            {isHwpx && selection?.kind === "table_cells" && (
              <button
                type="button"
                disabled={!stagingPath || cliRunning}
                onClick={() =>
                  void handleQuickSkillArgs(
                    "hwp-cli",
                    [
                      "nested-table",
                      "$HWP_STAGING_PATH",
                      "--table",
                      String(selection.tableIndex),
                      "--row",
                      String(selection.startRow),
                      "--col",
                      String(selection.startCol),
                      "--rows",
                      "2",
                      "--cols",
                      "2",
                    ],
                    `hwp-cli nested-table "$HWP_STAGING_PATH" --table ${selection.tableIndex} --row ${selection.startRow} --col ${selection.startCol} --rows 2 --cols 2`
                  )
                }
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--hc-accent-soft)] hover:bg-[var(--hc-accent)] hover:text-[var(--hc-accent-fg)] text-[var(--hc-text)] border border-[var(--hc-accent)] text-[11px] disabled:opacity-40 transition-colors whitespace-nowrap"
                title="현재 선택된 표 셀 내부에 2x2 중첩 표 삽입"
              >
                <Table2 className="w-3 h-3" />
                <span>
                  선택 셀({selection.startRow},{selection.startCol}) 중첩표
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 5. Main Terminal Stream / Minimalist Guide Card */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-[var(--hc-bg)] select-text">
        {tabHistory.length === 0 ? (
          <div className="relative rounded-xl bg-[var(--hc-card)] border border-[var(--hc-border)] p-4 space-y-3.5 overflow-hidden">
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold tracking-tight text-[var(--hc-text)]">
                에이전트 CLI & 내장 HWP 스킬 준비됨
              </h3>
              <p className="text-[11.5px] leading-relaxed text-[var(--hc-muted)]">
                설치된 로컬 에이전트 CLI(
                <span className="font-mono text-[var(--hc-code)]">claude</span>,{" "}
                <span className="font-mono text-[var(--hc-code)]">gemini</span>,{" "}
                <span className="font-mono text-[var(--hc-code)]">codex</span>) 또는 내장 스킬(
                <span className="font-mono text-[var(--hc-code)]">hwp-cli</span>,{" "}
                <span className="font-mono text-[var(--hc-code)]">ref-extract</span>)을 실행할 수 있습니다.
              </p>
            </div>

            <div className="space-y-2.5 pt-0.5">
              {GUIDE_COMMANDS.map((item) => (
                <div key={item.label} className="space-y-1">
                  <div className="text-[11px] text-[var(--hc-muted)]">{item.label}</div>
                  <button
                    type="button"
                    onClick={() => handleFillCommand(item.command)}
                    className="hc-cmd-box w-full text-left px-3 py-2 rounded-lg border border-[var(--hc-border)] bg-[var(--hc-surface-alt)]/70 hover:bg-[var(--hc-accent-soft)]/50 transition-colors font-mono text-[11px] text-[var(--hc-code)] leading-relaxed break-words cursor-pointer"
                    title="클릭하여 명령창에 채우기"
                  >
                    {item.command}
                  </button>
                </div>
              ))}
            </div>

            {/* Subtle Four-Point Star Accent Motif (Signature Reference Flourish) */}
            <svg
              aria-hidden="true"
              viewBox="0 0 64 64"
              className="pointer-events-none absolute -bottom-1 -right-1 w-14 h-14 opacity-55"
              fill="none"
            >
              <path
                d="M42 14 C43 26, 46 29, 58 30 C46 31, 43 34, 42 46 C41 34, 38 31, 26 30 C38 29, 41 26, 42 14 Z"
                fill="var(--hc-sparkle)"
              />
              <path
                d="M22 36 C22.5 42, 24 43.5, 30 44 C24 44.5, 22.5 46, 22 52 C21.5 46, 20 44.5, 14 44 C20 43.5, 21.5 42, 22 36 Z"
                fill="var(--hc-sparkle-strong)"
                opacity="0.7"
              />
            </svg>
          </div>
        ) : (
          tabHistory.map((item) => (
            <div
              key={item.id}
              className="rounded-xl bg-[var(--hc-card)] border border-[var(--hc-border)] overflow-hidden font-mono text-xs"
            >
              <div className="px-3 py-1.5 bg-[var(--hc-surface)] border-b border-[var(--hc-border-subtle)] flex items-center justify-between gap-2 text-[11px] tabular-nums">
                <div className="flex items-center gap-1.5 truncate min-w-0">
                  <span className="text-[var(--hc-accent)] font-bold shrink-0">$</span>
                  <span className="text-[var(--hc-text)] truncate" title={item.command}>
                    {item.command}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-[var(--hc-muted)]">
                  <span>{item.durationMs}ms</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      item.exitCode === 0
                        ? "text-[var(--hc-success)] font-semibold"
                        : "text-[var(--hc-danger)] font-semibold"
                    }
                  >
                    exit {item.exitCode}
                  </span>
                </div>
              </div>
              {item.stdout && (
                <pre className="p-3 text-[11px] text-[var(--hc-text)] whitespace-pre-wrap break-words max-h-72 overflow-y-auto leading-relaxed">
                  {item.stdout}
                </pre>
              )}
              {item.stderr && (
                <pre className="p-3 text-[11px] text-[var(--hc-danger)] bg-[var(--hc-danger-soft)] border-t border-[var(--hc-border-subtle)] whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                  {item.stderr}
                </pre>
              )}
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

      {/* 6. Minimal Prompt Input & Status Footer */}
      <div className="px-3.5 pt-2 pb-2.5 bg-[var(--hc-surface)] border-t border-[var(--hc-border)] space-y-1.5 shrink-0">
        <form
          onSubmit={handleExecute}
          className="flex items-center gap-2 rounded-lg bg-[var(--hc-card)] border border-[var(--hc-border)] focus-within:border-[var(--hc-accent)] px-2.5 py-1.5 transition-colors"
        >
          <span className="text-xs font-mono font-semibold text-[var(--hc-code)] whitespace-nowrap shrink-0">
            {currentPresetMeta.badge} $
          </span>
          <input
            ref={commandInputRef}
            id="agent-cli-command-input"
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            disabled={cliRunning}
            placeholder={currentPresetMeta.hint}
            className="flex-1 min-w-0 bg-transparent text-xs font-mono text-[var(--hc-text)] placeholder-[var(--hc-muted)] focus:outline-none"
          />
          <button
            id="agent-cli-run-btn"
            type="submit"
            disabled={cliRunning || !commandInput.trim()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--hc-accent)] hover:bg-[var(--hc-accent-hover)] disabled:opacity-40 text-[var(--hc-accent-fg)] text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-3 h-3" />
            <span>{cliRunning ? "실행 중" : "실행"}</span>
          </button>
        </form>

        <div className="flex items-center justify-between text-[10.5px] font-mono text-[var(--hc-muted)] px-0.5 tabular-nums">
          <div className="flex items-center gap-2 truncate">
            <span>
              model: <span className="text-[var(--hc-code)] font-medium">{currentPresetMeta.badge}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span>PII: {autoMaskPii ? "ON" : "OFF"}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowToolsDrawer((v) => !v)}
            className="text-[var(--hc-muted)] hover:text-[var(--hc-text)] transition-colors whitespace-nowrap shrink-0"
          >
            {showToolsDrawer ? "/도구 접기" : "/도구 펼치기"}
          </button>
        </div>
      </div>
    </aside>
  );
};
