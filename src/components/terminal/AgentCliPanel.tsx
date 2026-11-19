import React, { useState, useRef, useEffect } from "react";
import { useDocStore, CliPresetId } from "../../store/useDocStore";
import {
  Terminal,
  PanelRight,
  PanelBottom,
  Play,
  Copy,
  Check,
  Trash2,
  BookOpen,
  ShieldCheck,
  FileSearch,
  Wrench,
  Table2,
  FolderOpen,
  RefreshCw,
  ChevronRight,
  X,
  Code2,
} from "lucide-react";

const CLI_PRESETS: Array<{
  id: CliPresetId;
  label: string;
  binary: string;
  badge: string;
  exampleCmd: string;
}> = [
  {
    id: "claude",
    label: "Claude Code",
    binary: "claude",
    badge: "Anthropic CLI",
    exampleCmd: 'claude -p "현재 $HWP_STAGING_PATH 문서를 hwp-cli로 구조 진단하고 공문서 규격으로 교정해줘"',
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    binary: "gemini",
    badge: "Google CLI",
    exampleCmd: 'gemini -p "resources/skills 스킬을 사용해 $HWP_STAGING_PATH 표와 본문을 검토해줘"',
  },
  {
    id: "codex",
    label: "Codex CLI",
    binary: "codex",
    badge: "OpenAI CLI",
    exampleCmd: 'codex "hwp-cli inspect $HWP_STAGING_PATH --tables 실행 후 요약해줘"',
  },
  {
    id: "hwp-shell",
    label: "HWP Skill Shell",
    binary: "hwp-cli",
    badge: "Direct Skill CLI",
    exampleCmd: 'hwp-cli inspect "$HWP_STAGING_PATH" --tables',
  },
];

export const AgentCliPanel: React.FC = () => {
  const {
    stagingPath,
    fileName,
    isHwpx,
    selection,
    tablesMeta,
    cliPanelOpen,
    cliPanelDock,
    cliPanelWidth,
    cliPanelHeight,
    activeCliPreset,
    cliHistory,
    cliRunning,
    writingMemoryFilePath,
    activeMemoryIds,
    autoMaskPii,
    excludedRegions,
    setCliPanelOpen,
    toggleCliPanelDock,
    setCliPanelWidth,
    setCliPanelHeight,
    setActiveCliPreset,
    clearCliHistory,
    runCliCommand,
    checkExternalStagingModification,
    openMemoryModal,
    setPiiModalOpen,
  } = useDocStore();

  const [commandInput, setCommandInput] = useState("");
  const [cmdHistoryCursor, setCmdHistoryCursor] = useState<number>(-1);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [activeTab, setActiveTab] = useState<"terminal" | "skills">("terminal");
  const terminalOutputRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll terminal log when new entries arrive
  useEffect(() => {
    if (terminalOutputRef.current) {
      terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
    }
  }, [cliHistory, cliRunning]);

  // Poll staging file mtime every 2.5 seconds so external terminal edits also trigger rhwp-studio Diff review
  useEffect(() => {
    if (!stagingPath) return;
    const timer = setInterval(() => {
      void checkExternalStagingModification(false);
    }, 2500);
    return () => clearInterval(timer);
  }, [stagingPath, checkExternalStagingModification]);

  if (!cliPanelOpen) {
    return null;
  }

  const currentPreset = CLI_PRESETS.find((p) => p.id === activeCliPreset) || CLI_PRESETS[0];

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (cliPanelDock === "right") {
      const startX = e.clientX;
      const startW = cliPanelWidth;
      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        setCliPanelWidth(startW + delta);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    } else {
      const startY = e.clientY;
      const startH = cliPanelHeight;
      const onMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        setCliPanelHeight(startH + delta);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim() || cliRunning) return;
    const toRun = commandInput;
    setCommandInput("");
    setCmdHistoryCursor(-1);
    await runCliCommand(toRun, activeCliPreset);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cliHistory.length === 0) return;
      const nextIdx =
        cmdHistoryCursor === -1
          ? cliHistory.length - 1
          : Math.max(0, cmdHistoryCursor - 1);
      setCmdHistoryCursor(nextIdx);
      setCommandInput(cliHistory[nextIdx].command);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cmdHistoryCursor === -1) return;
      const nextIdx = cmdHistoryCursor + 1;
      if (nextIdx >= cliHistory.length) {
        setCmdHistoryCursor(-1);
        setCommandInput("");
      } else {
        setCmdHistoryCursor(nextIdx);
        setCommandInput(cliHistory[nextIdx].command);
      }
    }
  };

  const handleCopyExternalEnvCommand = () => {
    const envExport = [
      `export PATH="$PWD/resources/skills/bin:$PATH"`,
      `export HWP_STAGING_PATH="${stagingPath || ""}"`,
      writingMemoryFilePath ? `export HWP_WRITING_MEMORY_PATH="${writingMemoryFilePath}"` : "",
      `${currentPreset.binary}`,
    ]
      .filter(Boolean)
      .join(" && ");

    if (navigator.clipboard) {
      void navigator.clipboard.writeText(envExport);
      setCopiedEnv(true);
      setTimeout(() => setCopiedEnv(false), 1800);
    }
  };

  // Selection label for context bar
  const selectionLabel =
    selection?.kind === "table_cells"
      ? `표 #${selection.tableIndex} (${selection.startRow}행, ${selection.startCol}열)`
      : selection?.kind === "body_range"
      ? `본문 문단 #${selection.startPara + 1}`
      : tablesMeta.length > 0
      ? `표 ${tablesMeta.length}개 인식됨`
      : "본문 커서";

  const selectedTableIndex = selection?.kind === "table_cells" ? selection.tableIndex : 0;
  const selectedRow = selection?.kind === "table_cells" ? selection.startRow : 0;
  const selectedCol = selection?.kind === "table_cells" ? selection.startCol : 0;

  return (
    <aside
      data-testid="agent-cli-panel"
      style={
        cliPanelDock === "right"
          ? { width: `${cliPanelWidth}px` }
          : { height: `${cliPanelHeight}px` }
      }
      className={`relative bg-slate-950 text-slate-100 flex flex-col select-none shrink-0 ${
        cliPanelDock === "right"
          ? "h-full border-l border-slate-800"
          : "w-full border-t border-slate-800"
      }`}
    >
      {/* Drag Resizer Handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        title="드래그하여 터미널 패널 크기 조절"
        className={
          cliPanelDock === "right"
            ? "absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-500/60 transition z-20"
            : "absolute top-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-indigo-500/60 transition z-20"
        }
      />

      {/* Panel Header: Agent CLI Preset Tabs & Dock Controls */}
      <div className="px-3 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <Terminal className="w-4 h-4 text-indigo-400 shrink-0 mr-1" />
          {CLI_PRESETS.map((preset) => {
            const active = preset.id === activeCliPreset;
            return (
              <button
                key={preset.id}
                type="button"
                data-testid={`cli-preset-${preset.id}`}
                onClick={() => setActiveCliPreset(preset.id)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer whitespace-nowrap ${
                  active
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            data-testid="cli-tab-toggle"
            onClick={() => setActiveTab((t) => (t === "terminal" ? "skills" : "terminal"))}
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition cursor-pointer ${
              activeTab === "skills"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
            title="내장 에이전트 스킬(SKILL.md) 레퍼런스 보기"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>SKILL.md</span>
          </button>

          <button
            type="button"
            data-testid="cli-dock-toggle-btn"
            onClick={toggleCliPanelDock}
            title={cliPanelDock === "right" ? "하단 도킹으로 전환" : "우측 도킹으로 전환"}
            className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition cursor-pointer"
          >
            {cliPanelDock === "right" ? (
              <PanelBottom className="w-3.5 h-3.5" />
            ) : (
              <PanelRight className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setCliPanelOpen(false)}
            title="에이전트 CLI 패널 닫기"
            className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Environment Context Strip ($HWP_STAGING_PATH, Writing Memory, PII Guard) */}
      <div className="px-3 py-1.5 bg-slate-900/70 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono truncate max-w-[220px]"
            title={`$HWP_STAGING_PATH=${stagingPath || "(없음)"}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {fileName} ({isHwpx ? "HWPX" : "HWP"})
          </span>

          <span className="px-1.5 py-0.5 rounded bg-indigo-950/80 border border-indigo-800/60 text-indigo-300 font-mono">
            {selectionLabel}
          </span>

          <button
            type="button"
            onClick={() => openMemoryModal("list")}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border transition cursor-pointer ${
              activeMemoryIds.length > 0
                ? "bg-amber-950/70 border-amber-700/60 text-amber-300"
                : "bg-slate-800/70 border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
            title="작성 메모리 ($HWP_WRITING_MEMORY_PATH)"
          >
            <BookOpen className="w-3 h-3" />
            <span>메모리 {activeMemoryIds.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setPiiModalOpen(true)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border transition cursor-pointer ${
              autoMaskPii || excludedRegions.length > 0
                ? "bg-emerald-950/70 border-emerald-700/60 text-emerald-300"
                : "bg-slate-800/70 border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
            title="개인정보(PII) 자동 마스킹 및 제외 영역 설정"
          >
            <ShieldCheck className="w-3 h-3" />
            <span>
              PII {autoMaskPii ? "ON" : "OFF"}
              {excludedRegions.length > 0 ? ` · 제외 ${excludedRegions.length}` : ""}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void checkExternalStagingModification(true)}
            title="스테이징 파일 변경사항 수동 비교(rhwp-studio Diff)"
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1 transition cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Diff 동기화</span>
          </button>
          <button
            type="button"
            onClick={handleCopyExternalEnvCommand}
            title="외부 터미널용 환경변수 및 CLI 실행 명령어 복사"
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1 transition cursor-pointer"
          >
            {copiedEnv ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">복사됨</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>환경변수 복사</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Quick Skill Execution Toolbar */}
      <div className="px-3 py-1.5 bg-slate-900/40 border-b border-slate-800/70 flex items-center gap-1.5 overflow-x-auto">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 shrink-0 mr-1">
          Skills:
        </span>
        <button
          type="button"
          data-testid="skill-btn-inspect"
          disabled={cliRunning}
          onClick={() => void runCliCommand('hwp-cli inspect "$HWP_STAGING_PATH" --tables')}
          className="px-2 py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1 shrink-0 transition cursor-pointer disabled:opacity-50"
        >
          <FileSearch className="w-3 h-3 text-indigo-400" />
          <span>구조/표 검사</span>
        </button>

        <button
          type="button"
          data-testid="skill-btn-layout"
          disabled={cliRunning}
          onClick={() => void runCliCommand('hwp-cli layout-check "$HWP_STAGING_PATH"')}
          className="px-2 py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1 shrink-0 transition cursor-pointer disabled:opacity-50"
        >
          <Wrench className="w-3 h-3 text-cyan-400" />
          <span>레이아웃 진단</span>
        </button>

        <button
          type="button"
          data-testid="skill-btn-official-format"
          disabled={cliRunning}
          onClick={() =>
            void runCliCommand('hwp-cli official-format "$HWP_STAGING_PATH" --apply')
          }
          className="px-2 py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1 shrink-0 transition cursor-pointer disabled:opacity-50"
        >
          <Play className="w-3 h-3 text-emerald-400" />
          <span>공문서 규격 교정</span>
        </button>

        {isHwpx && (
          <button
            type="button"
            data-testid="skill-btn-nested-table"
            disabled={cliRunning}
            onClick={() =>
              void runCliCommand(
                `hwp-cli nested-table "$HWP_STAGING_PATH" --table ${selectedTableIndex} --row ${selectedRow} --col ${selectedCol} --rows 2 --cols 2`
              )
            }
            className="px-2 py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1 shrink-0 transition cursor-pointer disabled:opacity-50"
          >
            <Table2 className="w-3 h-3 text-amber-400" />
            <span>선택 셀 중첩표(2×2)</span>
          </button>
        )}

        <button
          type="button"
          data-testid="skill-btn-ref-extract"
          disabled={cliRunning}
          onClick={() => void runCliCommand("ref-extract samples/demo_budget_ref.xlsx")}
          className="px-2 py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1 shrink-0 transition cursor-pointer disabled:opacity-50"
        >
          <FolderOpen className="w-3 h-3 text-purple-400" />
          <span>참고자료 추출(xlsx)</span>
        </button>
      </div>

      {/* Main Content Area: Terminal Output OR SKILL.md Reference */}
      {activeTab === "skills" ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs font-mono bg-slate-950 select-text">
          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-indigo-400">
                1. resources/skills/hwp-document-editor/SKILL.md
              </span>
              <span className="px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 text-[10px]">
                CLI: hwp-cli
              </span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              HWP 5.0 및 HWPX 문서 구조/표 좌표 검사, 페이지 오버플로우 진단, 행정안전부 공문서 항목 기호(1. → 가. → 1) → 가)) 자동 교정, 배치 JSON 편집 및 셀 내부 중첩 표(Nested Table) 삽입 스킬입니다.
            </p>
            <div className="bg-slate-950 p-2 rounded border border-slate-800/80 text-[11px] text-slate-300 space-y-1">
              <div>$ hwp-cli inspect &quot;$HWP_STAGING_PATH&quot; --tables</div>
              <div>$ hwp-cli layout-check &quot;$HWP_STAGING_PATH&quot;</div>
              <div>$ hwp-cli official-format &quot;$HWP_STAGING_PATH&quot; --apply</div>
              <div>
                $ hwp-cli nested-table &quot;$HWP_STAGING_PATH&quot; --table 0 --row 0 --col 0 --rows 2 --cols 2
              </div>
              <div>
                $ hwp-cli edit &quot;$HWP_STAGING_PATH&quot; --ops &apos;[&#123;&quot;type&quot;:&quot;set_cell_text&quot;,&quot;tableIndex&quot;:0,&quot;row&quot;:0,&quot;col&quot;:0,&quot;text&quot;:&quot;완료&quot;&#125;]&apos;
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-purple-400">
                2. resources/skills/reference-extractor/SKILL.md
              </span>
              <span className="px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 text-[10px]">
                CLI: ref-extract
              </span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              .docx, .xlsx/.xls/.csv, .hwp/.hwpx, .txt/.md/.json 참고자료를 Zip-bomb 보안 한도(50MB) 내에서 정형화된 마크다운 표와 문단으로 추출하는 에이전트 전용 스킬입니다.
            </p>
            <div className="bg-slate-950 p-2 rounded border border-slate-800/80 text-[11px] text-slate-300 space-y-1">
              <div>$ ref-extract samples/demo_budget_ref.xlsx</div>
              <div>$ ref-extract samples/demo_official_report.hwpx --json</div>
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={terminalOutputRef}
          data-testid="cli-terminal-output"
          className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs bg-slate-950 select-text"
        >
          {/* Welcome Banner */}
          <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800/90 text-[11px] text-slate-400 space-y-1">
            <div className="flex items-center justify-between text-slate-200 font-semibold">
              <span>
                HOP-Claw Agent CLI Terminal ({currentPreset.label} · {currentPreset.badge})
              </span>
              <span className="text-[10px] text-emerald-400 font-normal">
                PATH += resources/skills/bin
              </span>
            </div>
            <div>
              에이전트 CLI나 <code className="text-indigo-300">hwp-cli</code> /{" "}
              <code className="text-purple-300">ref-extract</code> 스킬이{" "}
              <code className="text-emerald-300">$HWP_STAGING_PATH</code>를 수정하면{" "}
              <strong className="text-white">rhwp-studio 비교 엔진</strong>이 자동으로 시각적 Diff 검토 바를 띄웁니다.
            </div>
            <div className="text-slate-500">예시: {currentPreset.exampleCmd}</div>
          </div>

          {/* Command History Entries */}
          {cliHistory.map((item) => (
            <div
              key={item.id}
              className="rounded border border-slate-800/90 bg-slate-900/40 overflow-hidden"
            >
              <div className="px-2.5 py-1.5 bg-slate-900 flex items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <ChevronRight className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="text-slate-100 font-semibold break-all">{item.command}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-[10px]">
                  <span className="text-slate-500">{item.durationMs}ms</span>
                  <span
                    className={`px-1.5 py-0.5 rounded font-semibold ${
                      item.exitCode === 0
                        ? "bg-emerald-950 text-emerald-300 border border-emerald-800/60"
                        : "bg-rose-950 text-rose-300 border border-rose-800/60"
                    }`}
                  >
                    exit {item.exitCode}
                  </span>
                </div>
              </div>
              {item.stdout && (
                <pre className="p-2.5 text-[11px] text-slate-200 whitespace-pre-wrap break-words max-h-72 overflow-y-auto leading-relaxed">
                  {item.stdout}
                </pre>
              )}
              {item.stderr && (
                <pre className="p-2.5 text-[11px] text-rose-300 bg-rose-950/20 border-t border-rose-900/40 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                  {item.stderr}
                </pre>
              )}
            </div>
          ))}

          {cliRunning && (
            <div className="px-3 py-2 rounded bg-indigo-950/40 border border-indigo-800/50 text-indigo-300 text-xs flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>명령어 실행 및 스테이징 변경 감지 중...</span>
            </div>
          )}
        </div>
      )}

      {/* Command Input Bar */}
      <form
        onSubmit={handleSubmit}
        className="p-2 bg-slate-900 border-t border-slate-800 flex items-center gap-1.5"
      >
        <span className="text-xs font-mono text-indigo-400 pl-1.5 shrink-0">$</span>
        <input
          type="text"
          data-testid="cli-command-input"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={cliRunning}
          placeholder={`${currentPreset.binary} 또는 hwp-cli / ref-extract 명령 입력...`}
          className="flex-1 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-500 outline-none"
        />
        <button
          type="submit"
          data-testid="cli-run-btn"
          disabled={cliRunning || !commandInput.trim()}
          className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
        >
          <Play className="w-3.5 h-3.5" />
          <span>실행</span>
        </button>
        {cliHistory.length > 0 && (
          <button
            type="button"
            onClick={clearCliHistory}
            title="터미널 출력 지우기"
            className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </form>
    </aside>
  );
};
