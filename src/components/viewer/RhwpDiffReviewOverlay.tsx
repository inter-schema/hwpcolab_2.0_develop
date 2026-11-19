import React, { useState } from "react";
import { useDocStore } from "../../store/useDocStore";
import { hopBridge } from "../../core/hopBridge";
import type { DiffItem as RhwpDiffItem, DiffKind } from "@/compare/types";
import {
  Check,
  X,
  GitCompare,
  ChevronDown,
  ChevronUp,
  FileText,
  Table2,
  Image as ImageIcon,
  Shapes,
  ArrowRight,
  Sparkles,
} from "lucide-react";

function getKindBadge(kind: DiffKind) {
  switch (kind) {
    case "table":
      return {
        label: "표",
        icon: <Table2 className="w-3 h-3" />,
        cls: "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800",
      };
    case "image":
      return {
        label: "이미지",
        icon: <ImageIcon className="w-3 h-3" />,
        cls: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800",
      };
    case "shape":
    case "chart":
      return {
        label: "개체",
        icon: <Shapes className="w-3 h-3" />,
        cls: "bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800",
      };
    default:
      return {
        label: "본문",
        icon: <FileText className="w-3 h-3" />,
        cls: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      };
  }
}

function getSeverityBadge(severity: RhwpDiffItem["severity"]) {
  switch (severity) {
    case "added":
      return {
        label: "추가",
        cls: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800",
      };
    case "removed":
      return {
        label: "삭제",
        cls: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800",
      };
    default:
      return {
        label: "수정",
        cls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800",
      };
  }
}

function cleanPreviewText(raw: string): string {
  if (!raw) return "(내용 없음)";
  if (raw.startsWith('cprev="') && raw.endsWith('"')) {
    const inner = raw.slice(7, -1);
    if (!inner || inner === "(없음)") return "(표 셀 텍스트 없음)";
    return inner
      .split("&")
      .slice(0, 6)
      .map((pair) => {
        const idx = pair.indexOf("=");
        if (idx <= 0) return pair;
        const k = pair.slice(0, idx);
        const v = decodeURIComponent(pair.slice(idx + 1));
        return `[${k}] ${v}`;
      })
      .join(" · ");
  }
  return raw;
}

export const RhwpDiffReviewOverlay: React.FC = () => {
  const {
    stagingDiffSession,
    stagingDiffLoading,
    acceptStagingDiff,
    rejectStagingDiff,
    pendingDiffs,
    acceptAllDiffs,
    rejectAllDiffs,
    acceptDiffItem,
    rejectDiffItem,
  } = useDocStore();

  const [expanded, setExpanded] = useState(true);
  const [selectedDiffIdx, setSelectedDiffIdx] = useState(0);

  const hasRhwpSession = Boolean(stagingDiffSession);
  const hasLegacyDiffs = pendingDiffs.length > 0;

  if (!hasRhwpSession && !hasLegacyDiffs && !stagingDiffLoading) {
    return null;
  }

  const focusAnchorOnCanvas = (item: RhwpDiffItem, idx: number) => {
    setSelectedDiffIdx(idx);
    const anchor = item.leftAnchor || item.rightAnchor;
    if (!anchor) return;
    const rt = hopBridge.getRuntime();
    const scrollContainer = document.getElementById("scroll-container");
    if (!rt || !scrollContainer) return;
    try {
      const vs = rt.canvasView.getVirtualScroll();
      const zoom = rt.canvasView.getViewportManager().getZoom();
      const pageTop = vs.getPageOffset(anchor.pageIndex);
      const targetScrollTop = Math.max(0, pageTop + anchor.y * zoom - 140);
      scrollContainer.scrollTo({ top: targetScrollTop, behavior: "smooth" });
    } catch {}
  };

  if (stagingDiffLoading) {
    return (
      <div className="bg-indigo-600 text-white px-4 py-2 text-xs font-medium flex items-center justify-between shadow-md z-30">
        <div className="flex items-center gap-2">
          <GitCompare className="w-4 h-4 animate-spin" />
          <span>에이전트 CLI 스테이징 문서 변경 감지됨 — rhwp-studio 비교 엔진으로 Diff 분석 중...</span>
        </div>
      </div>
    );
  }

  // 1. rhwp-studio CompareSession visual review mode
  if (stagingDiffSession) {
    const items = stagingDiffSession.diffItems;
    const addedCount = items.filter((d) => d.severity === "added").length;
    const modifiedCount = items.filter((d) => d.severity === "modified").length;
    const removedCount = items.filter((d) => d.severity === "removed").length;

    return (
      <div
        className="border-b border-indigo-200 dark:border-indigo-900/70 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-md z-30 select-none"
        data-testid="rhwp-diff-review-overlay"
      >
        {/* Top Action Banner */}
        <div className="px-4 py-2 bg-gradient-to-r from-indigo-600 via-indigo-600 to-blue-600 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/15 text-[11px] font-semibold tracking-tight">
              <GitCompare className="w-3.5 h-3.5" />
              rhwp-studio 비교 엔진
            </span>
            <span className="text-xs font-semibold truncate">
              에이전트 CLI 스테이징 수정 사항 검토 ({items.length}개 항목)
            </span>
            <div className="hidden sm:flex items-center gap-1.5 text-[11px]">
              {addedCount > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/25 border border-emerald-300/30 text-emerald-100">
                  +{addedCount} 추가
                </span>
              )}
              {modifiedCount > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/25 border border-amber-300/30 text-amber-100">
                  ~{modifiedCount} 수정
                </span>
              )}
              {removedCount > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-rose-500/25 border border-rose-300/30 text-rose-100">
                  -{removedCount} 삭제
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-xs flex items-center gap-1 transition"
            >
              {expanded ? (
                <>
                  <span>비교 목록 접기</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <span>비교 목록 펼치기</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </button>
            <button
              type="button"
              data-testid="diff-accept-btn"
              onClick={() => void acceptStagingDiff()}
              className="px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-semibold flex items-center gap-1 shadow-sm transition cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              변경 수락 (에디터 반영)
            </button>
            <button
              type="button"
              data-testid="diff-reject-btn"
              onClick={() => void rejectStagingDiff()}
              className="px-3 py-1 rounded bg-rose-500/90 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1 shadow-sm transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              변경 반려 (원본 복원)
            </button>
          </div>
        </div>

        {/* Collapsible Diff Items Comparison Drawer */}
        {expanded && (
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {items.length === 0 ? (
              <div className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 flex items-center justify-between">
                <span>바이너리 메타데이터 또는 내부 XML 구조가 갱신되었습니다 (본문 텍스트/표 요약 동일).</span>
                <span className="text-[11px] text-slate-400">
                  전략: {stagingDiffSession.textCompareStrategyUsed || "alignment"}
                </span>
              </div>
            ) : (
              items.map((item, idx) => {
                const kindBadge = getKindBadge(item.kind);
                const sevBadge = getSeverityBadge(item.severity);
                const isSelected = idx === selectedDiffIdx;
                return (
                  <div
                    key={item.id}
                    onClick={() => focusAnchorOnCanvas(item, idx)}
                    className={`px-4 py-2.5 text-xs flex flex-col gap-1.5 cursor-pointer transition ${
                      isSelected
                        ? "bg-indigo-50/70 dark:bg-indigo-950/30"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${sevBadge.cls}`}
                        >
                          {sevBadge.label}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${kindBadge.cls}`}
                        >
                          {kindBadge.icon}
                          {kindBadge.label}
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {item.title}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          구역 {(item.path.section ?? 0) + 1}
                          {typeof item.path.paragraph === "number"
                            ? ` · 문단 ${item.path.paragraph + 1}`
                            : ""}
                          {item.rightSectionPage
                            ? ` · ${item.rightSectionPage}쪽`
                            : item.leftSectionPage
                            ? ` · ${item.leftSectionPage}쪽`
                            : ""}
                        </span>
                      </div>
                      {item.inlineTextDiff && (
                        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                          {item.inlineTextDiff}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                      <div className="px-2.5 py-1.5 rounded bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200/70 dark:border-rose-900/50 text-rose-900 dark:text-rose-200 font-mono break-all">
                        <span className="font-semibold text-rose-600 dark:text-rose-400 mr-1.5">
                          [이전]
                        </span>
                        {cleanPreviewText(item.leftPreview)}
                      </div>
                      <div className="px-2.5 py-1.5 rounded bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/50 text-emerald-900 dark:text-emerald-200 font-mono break-all">
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400 mr-1.5">
                          [CLI 수정본]
                        </span>
                        {cleanPreviewText(item.rightPreview)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  }

  // 2. Legacy pendingDiffs compatibility mode
  return (
    <div className="border-b border-indigo-200 dark:border-indigo-900 bg-white dark:bg-slate-900 shadow-sm z-30">
      <div className="px-4 py-2 bg-indigo-600 text-white flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5" />
          <span>문서 변경 제안 ({pendingDiffs.length}건)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void acceptAllDiffs()}
            className="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-semibold flex items-center gap-1"
          >
            <Check className="w-3.5 h-3.5" />
            전체 수락
          </button>
          <button
            type="button"
            onClick={() => rejectAllDiffs()}
            className="px-2.5 py-1 rounded bg-rose-500 hover:bg-rose-400 text-white text-xs font-semibold flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" />
            전체 반려
          </button>
        </div>
      </div>
      <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
        {pendingDiffs.map((d) => (
          <div key={d.id} className="px-4 py-2 text-xs flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-700 dark:text-slate-200">{d.title}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 truncate">
                <span className="line-through text-rose-500 truncate max-w-[240px]">
                  {d.beforeText || "(빈 값)"}
                </span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="text-emerald-600 dark:text-emerald-400 font-medium truncate max-w-[280px]">
                  {d.afterText}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => void acceptDiffItem(d.id)}
                className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-[11px] font-medium"
              >
                수락
              </button>
              <button
                type="button"
                onClick={() => rejectDiffItem(d.id)}
                className="px-2 py-1 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 text-[11px] font-medium"
              >
                반려
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
