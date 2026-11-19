import React, { useMemo, useState } from "react";
import {
  Check,
  X,
  ChevronDown,
  ChevronUp,
  GitCompare,
} from "lucide-react";
import { useDocStore } from "../../store/useDocStore";
import { hopBridge } from "../../core/hopBridge";
import type { DiffItem } from "@/compare/types";

function describeDiffKind(kind: DiffItem["kind"]): string {
  switch (kind) {
    case "text":
      return "본문 텍스트";
    case "table":
      return "표/셀";
    case "shape":
      return "도형";
    case "image":
      return "이미지";
    case "chart":
      return "차트";
    case "paragraphMeta":
      return "문단 서식";
    default:
      return kind;
  }
}

function describeDiffSeverity(severity: DiffItem["severity"]): {
  label: string;
  symbol: string;
  textClass: string;
  borderClass: string;
} {
  switch (severity) {
    case "added":
      return {
        label: "추가",
        symbol: "+",
        textClass: "text-emerald-400",
        borderClass: "border-emerald-500/40 bg-emerald-950/20",
      };
    case "removed":
      return {
        label: "삭제",
        symbol: "-",
        textClass: "text-rose-400",
        borderClass: "border-rose-500/40 bg-rose-950/20",
      };
    case "modified":
    default:
      return {
        label: "변경",
        symbol: "~",
        textClass: "text-amber-400",
        borderClass: "border-amber-500/40 bg-amber-950/20",
      };
  }
}

export const RhwpDiffReviewOverlay: React.FC = () => {
  const {
    stagingDiffSession,
    stagingDiffLoading,
    acceptStagingDiff,
    rejectStagingDiff,
  } = useDocStore();

  const [expanded, setExpanded] = useState(true);

  const summary = useMemo(() => {
    const items = stagingDiffSession?.diffItems ?? [];
    let added = 0;
    let modified = 0;
    let removed = 0;
    for (const item of items) {
      if (item.severity === "added") added += 1;
      else if (item.severity === "removed") removed += 1;
      else modified += 1;
    }
    return { total: items.length, added, modified, removed };
  }, [stagingDiffSession]);

  if (stagingDiffLoading) {
    return (
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-[#0D1117]/95 text-[#F0F6FC] px-4 py-2 rounded-lg shadow-xl border border-[#21262D] flex items-center gap-2 text-xs font-medium">
        <GitCompare className="w-4 h-4 text-teal-400 animate-spin" />
        <span>rhwp-studio 문서 비교 엔진으로 변경사항 분석 중...</span>
      </div>
    );
  }

  if (!stagingDiffSession || stagingDiffSession.diffItems.length === 0) {
    return null;
  }

  const diffs = stagingDiffSession.diffItems;

  const handleJumpToDiff = (diff: DiffItem) => {
    const rt = hopBridge.getRuntime();
    if (rt && typeof diff.path?.paragraph === "number") {
      try {
        (rt.inputHandler as any).setCursorPosition?.({
          sectionIndex: diff.path.section ?? 0,
          paragraphIndex: diff.path.paragraph,
          charOffset: 0,
        });
      } catch {
        // Ignore if cursor jump is out of range on baseline before accept
      }
    }
  };

  return (
    <div
      id="rhwp-diff-review-overlay"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-[min(780px,94%)] bg-[#0D1117]/95 backdrop-blur-md text-[#F0F6FC] rounded-lg shadow-2xl border border-[#21262D] overflow-hidden"
    >
      {/* Top Banner */}
      <div className="px-4 py-2.5 bg-[#161B22] border-b border-[#21262D] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs tabular-nums flex-wrap">
          <GitCompare className="w-4 h-4 text-teal-400 shrink-0" />
          <span className="font-bold text-[#F0F6FC]">
            에이전트 CLI 변경사항 감지 ({summary.total}건)
          </span>
          <span className="text-[#484F58]">·</span>
          <span className="font-mono text-emerald-400 font-semibold">
            +{summary.added} 추가
          </span>
          <span className="text-[#484F58]">·</span>
          <span className="font-mono text-amber-400 font-semibold">
            ~{summary.modified} 변경
          </span>
          <span className="text-[#484F58]">·</span>
          <span className="font-mono text-rose-400 font-semibold">
            -{summary.removed} 삭제
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            id="btn-accept-staging-diff"
            onClick={() => void acceptStagingDiff()}
            className="flex items-center gap-1 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
            title="CLI가 수정한 스테이징 문서를 캔버스에 수락 및 반영"
          >
            <Check className="w-3.5 h-3.5" />
            <span>변경사항 수락 (Accept)</span>
          </button>

          <button
            id="btn-reject-staging-diff"
            onClick={() => void rejectStagingDiff()}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#21262D] hover:bg-rose-950/70 text-[#C9D1D9] hover:text-rose-200 border border-[#30363D] text-xs font-medium transition-colors"
            title="CLI 수정본을 폐기하고 이전 문서 상태로 롤백"
          >
            <X className="w-3.5 h-3.5" />
            <span>거절 (롤백)</span>
          </button>

          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1 text-[#8B949E] hover:text-white rounded hover:bg-[#21262D]"
            title={expanded ? "변경 내역 접기" : "변경 내역 펼치기"}
            aria-label={expanded ? "변경 내역 접기" : "변경 내역 펼치기"}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Diff Entries List */}
      {expanded && (
        <div className="max-h-64 overflow-y-auto p-3 space-y-2 text-xs">
          {diffs.slice(0, 40).map((diff) => {
            const typeMeta = describeDiffSeverity(diff.severity);
            return (
              <div
                key={diff.id}
                onClick={() => handleJumpToDiff(diff)}
                className={`p-2.5 rounded border ${typeMeta.borderClass} space-y-1.5 cursor-pointer hover:border-teal-500/50 transition-colors`}
              >
                <div className="flex items-center justify-between gap-2 tabular-nums">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-mono font-bold ${typeMeta.textClass}`}>
                      [{typeMeta.symbol} {typeMeta.label}]
                    </span>
                    <span className="text-[#484F58]">·</span>
                    <span className="text-[11px] font-semibold text-[#C9D1D9]">
                      {describeDiffKind(diff.kind)}
                    </span>
                    {diff.title && (
                      <>
                        <span className="text-[#484F58]">·</span>
                        <span className="text-[11px] text-[#8B949E]">{diff.title}</span>
                      </>
                    )}
                  </div>
                  {diff.path && (
                    <span className="text-[10px] font-mono text-[#8B949E]">
                      섹션 {(diff.path.section ?? 0) + 1}
                      {typeof diff.path.paragraph === "number"
                        ? ` · 문단 ${diff.path.paragraph + 1}`
                        : ""}
                    </span>
                  )}
                </div>

                {(diff.leftPreview || diff.rightPreview) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-[11px] pt-0.5">
                    {diff.leftPreview !== undefined && (
                      <div className="p-1.5 rounded bg-rose-950/30 border border-rose-900/40 text-rose-200 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                        <span className="text-rose-400 font-bold select-none mr-1">-</span>
                        {diff.leftPreview || "(빈 내용)"}
                      </div>
                    )}
                    {diff.rightPreview !== undefined && (
                      <div className="p-1.5 rounded bg-emerald-950/30 border border-emerald-900/40 text-emerald-200 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                        <span className="text-emerald-400 font-bold select-none mr-1">+</span>
                        {diff.rightPreview || "(빈 내용)"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {diffs.length > 40 && (
            <div className="text-center text-[11px] text-[#8B949E] py-1 tabular-nums">
              외 {diffs.length - 40}건의 추가 변경사항이 있습니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
