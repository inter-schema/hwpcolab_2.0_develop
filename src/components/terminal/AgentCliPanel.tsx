import React, { useState, useRef, useEffect } from "react";
import {
  Terminal,
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
  Settings2,
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
    hint: "claude -p \"...\" 또는 hwp-cli 스킬 직접 실행",
    sampleCmd: `claude -p "resources/skills/hwp-document-editor/SKILL.md 규격에 따라 $HWP_STAGING_PATH 문서를 분석하고 $HWP_WRITING_MEMORY_PATH 지침을 반영해 교정해 줘"`,
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    badge: "gemini",
    hint: "gemini -p \"...\" 또는 hwp-cli 스킬 직접 실행",
    sampleCmd: `gemini -p "resources/skills/hwp-document-editor/SKILL.md 스킬을 사용해 $HWP_STAGING_PATH 문서의 표와 본문을 검수하고 수정해 줘"`,
  },
  {
    id: "codex",
    label: "Codex",
    badge: "codex",
    hint: "codex \"...\" 또는 hwp-cli 스킬 직접 실행",
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

export const AgentCliPanel: React.FC = () => {
  const {
    stagingPath,
    isHwpx,
    selection,
    activeMemoryIds,
    writingMemoryFilePath,
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
    checkExternalStagingModification,
    syncWritingMemoryFileToDisk,
    showToastMessage,
  } = useDocStore();

  const [commandInput, setCommandInput] = useState("");
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [showCustomPresetForm, setShowCustomPresetForm] = useState(false);
  const [customPresetLabel, setCustomPresetLabel] = useState("");
  const [customPresetPrefix, setCustomPresetPrefix] = useState("");

  const logEndRef = useRef<HTMLDivElement>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);

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

  const handleQuickSkill = async (cmd: string) => {
    if (cliRunning) return;
    await runCliCommand(cmd, "hwp-shell");
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
    showToastMessage(`선택 영역 컨텍스트(${summary})가 명령창에 주입되었습니다.`);
  };

  const handleInjectWritingMemory = async () => {
    const path = await syncWritingMemoryFileToDisk();
    const snippet = `$HWP_WRITING_MEMORY_PATH`;
    setCommandInput((prev) =>
      prev ? `${prev} ${snippet}` : `cat ${snippet}`
    );
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
          await handleQuickSkill(`ref-extract "${picked}" --format markdown`);
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
    // Save uploaded reference file to a temporary staging file and run ref-extract
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const session = await invoke<{ staging_path: string }>("create_blank_session", {
        isHwpx: file.name.toLowerCase().endsWith(".hwpx"),
      });
      await invoke("write_file_bytes", {
        filePath: session.staging_path,
        bytes: Array.from(bytes),
      });
      await handleQuickSkill(`ref-extract "${session.staging_path}" --format markdown`);
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
      className={`relative bg-[#0D1117] text-[#F0F6FC] flex flex-col select-none shrink-0 z-10 ${
        cliPanelDock === "right"
          ? "h-full border-l border-[#21262D]"
          : "w-full border-t border-[#21262D]"
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
            ? "absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-500/50 transition-colors z-20"
            : "absolute top-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-teal-500/50 transition-colors z-20"
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

      {/* Top Header: Multi-Tab Bar & Dock Controls */}
      <div className="h-9 px-2.5 bg-[#161B22] border-b border-[#21262D] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          <Terminal className="w-3.5 h-3.5 text-teal-400 mr-1 shrink-0" />
          {cliTabs.map((tab) => {
            const active = tab.id === activeCliTabId;
            return (
              <div
                key={tab.id}
                className={`group flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                  active
                    ? "bg-[#0D1117] text-teal-300 border border-[#30363D]"
                    : "text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#1F242C]"
                }`}
                onClick={() => setActiveCliTab(tab.id)}
              >
                <span className="truncate max-w-[90px]">{tab.title}</span>
                <span className="text-[10px] font-mono text-[#6E7681]">· {tab.preset}</span>
                {cliTabs.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeCliTab(tab.id);
                    }}
                    className="opacity-60 hover:opacity-100 text-[#8B949E] hover:text-rose-400"
                    title="탭 닫기"
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
            className="p-1 text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#1F242C] rounded transition-colors"
            title="새 터미널 세션 탭 추가"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => void checkExternalStagingModification(true)}
            className="p-1 text-[#8B949E] hover:text-white hover:bg-[#21262D] rounded transition-colors"
            title="스테이징 파일 변경사항 수동 감지 및 Diff 비교"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={toggleCliPanelDock}
            className="p-1 text-[#8B949E] hover:text-white hover:bg-[#21262D] rounded transition-colors"
            title={
              cliPanelDock === "right"
                ? "하단(Bottom) 패널로 도킹 전환"
                : "우측(Right) 패널로 도킹 전환"
            }
          >
            {cliPanelDock === "right" ? (
              <PanelBottom className="w-3.5 h-3.5" />
            ) : (
              <PanelRight className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={clearCliHistory}
            className="p-1 text-[#8B949E] hover:text-rose-400 hover:bg-[#21262D] rounded transition-colors"
            title="현재 탭 터미널 출력 지우기"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={toggleCliPanel}
            className="p-1 text-[#8B949E] hover:text-white hover:bg-[#21262D] rounded transition-colors"
            title="패널 닫기"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* CLI Agent Preset Selector Bar (Built-in + Custom Presets) */}
      <div className="px-3 py-1.5 bg-[#161B22]/70 border-b border-[#21262D] flex items-center justify-between gap-1.5 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {BUILTIN_CLI_PRESETS.map((preset) => {
            const active = activeCliPreset === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => setActiveCliPreset(preset.id)}
                className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                  active
                    ? "bg-teal-500/15 text-teal-300 border border-teal-500/40"
                    : "text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D]"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
          {customCliPresets.map((preset) => {
            const active = activeCliPreset === preset.id;
            return (
              <div
                key={preset.id}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                  active
                    ? "bg-teal-500/15 text-teal-300 border border-teal-500/40"
                    : "text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D]"
                }`}
              >
                <button type="button" onClick={() => setActiveCliPreset(preset.id)}>
                  {preset.label}
                </button>
                <button
                  type="button"
                  onClick={() => removeCustomCliPreset(preset.id)}
                  className="text-[#6E7681] hover:text-rose-400"
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
            className="px-1.5 py-1 rounded text-[11px] text-[#8B949E] hover:text-teal-300 hover:bg-[#21262D] flex items-center gap-0.5 whitespace-nowrap transition-colors"
            title="사용자 정의 CLI 프리셋 추가"
          >
            <Settings2 className="w-3 h-3" />
            <span>+프리셋</span>
          </button>
        </div>
      </div>

      {/* Inline Custom CLI Preset Form */}
      {showCustomPresetForm && (
        <form
          onSubmit={handleAddCustomPreset}
          className="px-3 py-2 bg-[#161B22] border-b border-[#21262D] flex items-center gap-2 text-[11px]"
        >
          <input
            type="text"
            value={customPresetLabel}
            onChange={(e) => setCustomPresetLabel(e.target.value)}
            placeholder="이름 (예: Aider)"
            className="w-28 bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-[#F0F6FC] focus:outline-none focus:border-teal-500"
          />
          <input
            type="text"
            value={customPresetPrefix}
            onChange={(e) => setCustomPresetPrefix(e.target.value)}
            placeholder="실행 명령어 (예: aider --message)"
            className="flex-1 bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 font-mono text-[#F0F6FC] focus:outline-none focus:border-teal-500"
          />
          <button
            type="submit"
            className="px-2.5 py-1 rounded bg-teal-600 hover:bg-teal-500 text-white font-semibold"
          >
            추가
          </button>
        </form>
      )}

      {/* Environment Variable Context Strip & Context Injection Buttons */}
      <div className="px-3 py-2 bg-[#0D1117] border-b border-[#21262D] text-[11px] space-y-1.5 shrink-0">
        <div className="flex items-center justify-between gap-2 text-[#8B949E] tabular-nums">
          <div className="flex items-center gap-1.5 truncate font-mono">
            <span className="text-teal-400 font-semibold">$HWP_STAGING_PATH</span>
            <span>·</span>
            <span className="truncate text-[#C9D1D9]" title={stagingPath || "문서 미로드"}>
              {stagingPath ? stagingPath.split("/").slice(-1)[0] : "(없음)"}
            </span>
            <span>·</span>
            <span className="text-[#8B949E] shrink-0">{selectionSummary}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setCommandInput(currentPresetMeta.sampleCmd)}
              className="text-[10px] text-teal-400 hover:text-teal-300 px-1.5 py-0.5 rounded bg-[#161B22] border border-[#30363D]"
              title="선택한 에이전트 CLI 예시 프롬프트 채우기"
            >
              예시 채우기
            </button>
            <button
              type="button"
              onClick={handleCopyEnvSnippet}
              className="flex items-center gap-1 text-[10px] text-[#8B949E] hover:text-white px-1.5 py-0.5 rounded bg-[#161B22] border border-[#30363D]"
              title="터미널 환경변수 export 스니펫 복사"
            >
              {copiedEnv ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              <span>{copiedEnv ? "복사됨" : "ENV"}</span>
            </button>
          </div>
        </div>

        {/* Context Injection & Quick Skill Bar */}
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <button
            type="button"
            id="btn-inject-selection-context"
            onClick={handleInjectSelectionContext}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#161B22] hover:bg-[#1F242C] text-[#C9D1D9] border border-[#30363D] text-[11px] transition-colors"
            title="현재 캔버스 선택 좌표($HWP_SELECTION_JSON)를 CLI 명령에 주입"
          >
            <Crosshair className="w-3 h-3 text-teal-400" />
            <span>선택 영역 전달</span>
          </button>

          <button
            type="button"
            id="btn-inject-writing-memory"
            onClick={() => void handleInjectWritingMemory()}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#161B22] hover:bg-[#1F242C] text-[#C9D1D9] border border-[#30363D] text-[11px] transition-colors tabular-nums"
            title="활성 작성 메모리 파일($HWP_WRITING_MEMORY_PATH) 동기화 및 주입"
          >
            <BookOpen className="w-3 h-3 text-teal-400" />
            <span>작성 메모리 주입 ({activeMemoryIds.length})</span>
          </button>

          <button
            type="button"
            id="btn-extract-reference-doc"
            onClick={() => void handlePickReferenceFile()}
            disabled={cliRunning}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#161B22] hover:bg-[#1F242C] text-[#C9D1D9] border border-[#30363D] text-[11px] transition-colors disabled:opacity-40"
            title="참고 문서(HWP/HWPX/DOCX/XLSX/PDF)를 ref-extract 스킬로 마크다운 추출"
          >
            <FileSpreadsheet className="w-3 h-3 text-amber-400" />
            <span>참고자료 추출</span>
          </button>
        </div>

        {/* Built-in hwp-cli Skill One-Click Actions */}
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <button
            disabled={!stagingPath || cliRunning}
            onClick={() => void handleQuickSkill(`hwp-cli inspect "$HWP_STAGING_PATH"`)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#161B22] hover:bg-[#1F242C] text-[#C9D1D9] border border-[#30363D] text-[11px] disabled:opacity-40 transition-colors"
            title="hwp-cli inspect: 문서 구조·표·셀 인덱스 JSON 조회"
          >
            <FileSearch className="w-3 h-3 text-teal-400" />
            <span>구조/표 검사</span>
          </button>

          <button
            disabled={!stagingPath || cliRunning}
            onClick={() => void handleQuickSkill(`hwp-cli check-layout "$HWP_STAGING_PATH"`)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#161B22] hover:bg-[#1F242C] text-[#C9D1D9] border border-[#30363D] text-[11px] disabled:opacity-40 transition-colors"
            title="hwp-cli check-layout: 페이지 오버플로우·누락 항목 진단"
          >
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>레이아웃 진단</span>
          </button>

          <button
            disabled={!stagingPath || cliRunning}
            onClick={() => void handleQuickSkill(`hwp-cli fix-official-rules "$HWP_STAGING_PATH"`)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#161B22] hover:bg-[#1F242C] text-[#C9D1D9] border border-[#30363D] text-[11px] disabled:opacity-40 transition-colors"
            title="hwp-cli fix-official-rules: 행정안전부 공문서 표기·날짜·연락처·붙임 규격 자동 교정"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>공문서 규격 교정</span>
          </button>

          {isHwpx && selection?.kind === "table_cells" && (
            <button
              disabled={!stagingPath || cliRunning}
              onClick={() =>
                void handleQuickSkill(
                  `hwp-cli insert-nested-table "$HWP_STAGING_PATH" --table ${selection.tableIndex} --row ${selection.startRow} --col ${selection.startCol} --rows 2 --cols 2`
                )
              }
              className="flex items-center gap-1 px-2 py-1 rounded bg-teal-950/60 hover:bg-teal-900/70 text-teal-300 border border-teal-700/60 text-[11px] disabled:opacity-40 transition-colors"
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

      {/* Terminal Output Stream */}
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-3 bg-[#0D1117] select-text">
        {tabHistory.length === 0 ? (
          <div className="space-y-2.5 text-[#8B949E] leading-relaxed">
            <div className="p-3 rounded-md bg-[#161B22]/90 border border-[#21262D] space-y-1.5">
              <div className="text-[#F0F6FC] font-semibold flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-teal-400" />
                <span>에이전트 CLI & 내장 HWP 스킬 준비됨</span>
              </div>
              <p className="text-[11px] text-[#8B949E]">
                설치된 로컬 에이전트 CLI(<code className="text-teal-300">claude</code>,{" "}
                <code className="text-teal-300">gemini</code>,{" "}
                <code className="text-teal-300">codex</code>) 또는 내장 스킬(
                <code className="text-emerald-300">hwp-cli</code>,{" "}
                <code className="text-amber-300">ref-extract</code>)을 실행할 수 있습니다.
              </p>
              <div className="text-[11px] bg-[#0D1117] p-2 rounded border border-[#21262D] space-y-1 text-[#C9D1D9]">
                <div>
                  <span className="text-[#6E7681]"># 문서 전문 마크다운 추출</span>
                  <br />
                  <code>hwp-cli extract "$HWP_STAGING_PATH" --format markdown</code>
                </div>
                <div>
                  <span className="text-[#6E7681]"># 표 셀 텍스트 수정 (자동 시각적 Diff 리뷰 트리거)</span>
                  <br />
                  <code>hwp-cli set-cell "$HWP_STAGING_PATH" --table 0 --row 1 --col 1 --text "수정값"</code>
                </div>
                <div>
                  <span className="text-[#6E7681]"># 참고 자료(XLSX/PDF/DOCX/HWP) 마크다운 추출</span>
                  <br />
                  <code>ref-extract samples/demo_budget_ref.xlsx --format markdown</code>
                </div>
              </div>
            </div>
          </div>
        ) : (
          tabHistory.map((item) => (
            <div
              key={item.id}
              className="rounded-md bg-[#161B22]/90 border border-[#21262D] overflow-hidden"
            >
              <div className="px-2.5 py-1.5 bg-[#161B22] border-b border-[#21262D] flex items-center justify-between gap-2 text-[11px] tabular-nums">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-teal-400 font-bold">$</span>
                  <span className="text-[#F0F6FC] truncate" title={item.command}>
                    {item.command}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-[#8B949E]">
                  <span>{item.durationMs}ms</span>
                  <span>·</span>
                  <span
                    className={
                      item.exitCode === 0
                        ? "text-emerald-400 font-semibold"
                        : "text-rose-400 font-semibold"
                    }
                  >
                    exit {item.exitCode}
                  </span>
                </div>
              </div>
              {item.stdout && (
                <pre className="p-2.5 text-[11px] text-[#C9D1D9] whitespace-pre-wrap break-words max-h-72 overflow-y-auto leading-relaxed">
                  {item.stdout}
                </pre>
              )}
              {item.stderr && (
                <pre className="p-2.5 text-[11px] text-rose-300 bg-rose-950/20 border-t border-rose-900/30 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                  {item.stderr}
                </pre>
              )}
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

      {/* Command Input Form */}
      <form
        onSubmit={handleExecute}
        className="p-2.5 bg-[#161B22] border-t border-[#21262D] flex items-center gap-2 shrink-0"
      >
        <span className="text-xs font-mono font-bold text-teal-400 pl-1">
          {currentPresetMeta.badge} $
        </span>
        <input
          id="agent-cli-command-input"
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          disabled={cliRunning}
          placeholder={currentPresetMeta.hint}
          className="flex-1 bg-[#0D1117] border border-[#30363D] focus:border-teal-500 rounded px-2.5 py-1.5 text-xs font-mono text-[#F0F6FC] placeholder-[#6E7681] focus:outline-none"
        />
        <button
          id="agent-cli-run-btn"
          type="submit"
          disabled={cliRunning || !commandInput.trim()}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-500 disabled:bg-[#21262D] disabled:text-[#6E7681] text-white text-xs font-semibold transition-colors shrink-0"
        >
          <Play className="w-3.5 h-3.5" />
          <span>{cliRunning ? "실행 중..." : "실행"}</span>
        </button>
      </form>
    </aside>
  );
};
