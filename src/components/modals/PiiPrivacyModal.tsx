import React, { useEffect } from "react";
import { useDocStore } from "../../store/useDocStore";
import {
  ShieldCheck,
  X,
  Lock,
  Plus,
  Trash2,
  EyeOff,
  CheckCircle2,
} from "lucide-react";

export const PiiPrivacyModal: React.FC = () => {
  const {
    piiModalOpen,
    setPiiModalOpen,
    autoMaskPii,
    setAutoMaskPii,
    excludedRegions,
    selection,
    toggleExcludeSelection,
    removeExcludedRegion,
    clearExcludedRegions,
    sessionMasker,
  } = useDocStore();

  useEffect(() => {
    if (!piiModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPiiModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [piiModalOpen, setPiiModalOpen]);

  if (!piiModalOpen) return null;

  const currentSelectionLabel =
    selection?.kind === "table_cells"
      ? `표 #${selection.tableIndex + 1} (${selection.startRow + 1}행 ${selection.startCol + 1}열)`
      : selection?.kind === "body_range"
      ? `본문 문단 ${selection.startPara + 1} ("${selection.selectedText.slice(0, 28)}...")`
      : null;

  const maskPreviewSample =
    "담당자 홍길동 (010-1234-5678, hong@korea.kr, 주민번호 900101-1234567)";
  const maskedSampleResult = sessionMasker.maskTextForPrompt(
    maskPreviewSample,
    excludedRegions,
    true
  );

  return (
    <div
      className="hc-chrome fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      data-testid="pii-privacy-modal"
    >
      <div className="w-full max-w-xl rounded-xl bg-[var(--hc-card)] border border-[var(--hc-border)] shadow-2xl overflow-hidden flex flex-col max-h-[86vh] text-[var(--hc-text)]">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[var(--hc-surface)] border-b border-[var(--hc-border)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--hc-accent-soft)] border border-[var(--hc-border)] flex items-center justify-center text-[var(--hc-accent)]">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--hc-text)]">
                개인정보(PII) 보호 및 제외 영역 관리
              </h2>
              <p className="text-[11px] text-[var(--hc-muted)]">
                에이전트 CLI 전달 및 작성 메모리 추출 시 민감정보를 로컬에서 보호합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="닫기"
            title="닫기"
            onClick={() => setPiiModalOpen(false)}
            className="p-1.5 rounded-lg text-[var(--hc-muted)] hover:text-[var(--hc-text)] hover:bg-[var(--hc-accent-soft)] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs bg-[var(--hc-bg)]">
          {/* 1. PII Auto-Masking Toggle */}
          <div className="p-4 rounded-xl bg-[var(--hc-card)] border border-[var(--hc-border)] space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="font-semibold text-[var(--hc-text)] flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-[var(--hc-accent)]" />
                  <span>개인정보(PII) 자동 가리기 — 문서·메모리 마스킹 사본 전달</span>
                </div>
                <p className="text-[11px] text-[var(--hc-muted)] leading-relaxed">
                  켜두면 AI 에이전트 CLI 실행 시 명령어뿐만 아니라{" "}
                  <strong className="text-[var(--hc-text)]">
                    문서(HWPX)와 작성 메모리의 마스킹된 임시 사본
                  </strong>
                  을 전달해 주민등록번호·연락처·이메일·계좌번호를{" "}
                  <code className="px-1 py-0.5 rounded bg-[var(--hc-surface)] text-[var(--hc-code)] font-mono">
                    [[PII_PHONE_1]]
                  </code>{" "}
                  토큰으로 가리고, 편집이 끝나면 원래 정보로 자동 복원합니다. 꺼두면 원본 스테이징 문서가 그대로 전달됩니다.
                </p>
              </div>
              <button
                type="button"
                data-testid="pii-auto-mask-toggle"
                onClick={() => setAutoMaskPii(!autoMaskPii)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer shrink-0 border ${
                  autoMaskPii
                    ? "bg-[var(--hc-accent)] text-[var(--hc-accent-fg)] border-[var(--hc-accent)]"
                    : "bg-[var(--hc-surface)] text-[var(--hc-text)] border-[var(--hc-border)] hover:bg-[var(--hc-accent-soft)]"
                }`}
              >
                {autoMaskPii ? "자동 마스킹 켜짐 (ON)" : "자동 마스킹 꺼짐 (OFF)"}
              </button>
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--hc-surface-alt)] border border-[var(--hc-border-subtle)] font-mono text-[11px] space-y-1">
              <div className="text-[var(--hc-muted)]">원문 예시: {maskPreviewSample}</div>
              <div className="text-[var(--hc-code)]">치환 결과: {maskedSampleResult}</div>
              <div className="text-[var(--hc-muted)] pt-1 border-t border-[var(--hc-border-subtle)] font-sans">
                현재 CLI 전달 상태:{" "}
                <strong className={autoMaskPii ? "text-[var(--hc-success)]" : "text-[var(--hc-text)]"}>
                  {autoMaskPii
                    ? "마스킹된 임시 문서·메모리 사본 전달 중 (원본 개인정보 보호)"
                    : "원본 스테이징 문서 직접 전달 중 (마스킹 꺼짐)"}
                </strong>
              </div>
            </div>
          </div>

          {/* 2. Excluded Document Regions */}
          <div className="p-4 rounded-xl bg-[var(--hc-card)] border border-[var(--hc-border)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-[var(--hc-text)] flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5 text-[var(--hc-code)]" />
                <span>보호 제외 영역 (Excluded Regions · {excludedRegions.length}건)</span>
              </div>
              {excludedRegions.length > 0 && (
                <button
                  type="button"
                  onClick={clearExcludedRegions}
                  className="text-[11px] text-[var(--hc-danger)] hover:underline cursor-pointer"
                >
                  전체 해제
                </button>
              )}
            </div>

            <p className="text-[11px] text-[var(--hc-muted)] leading-relaxed">
              에디터에서 특정 표 셀이나 본문 문단을 선택한 뒤 제외 영역으로 등록하면{" "}
              <code className="font-mono text-[var(--hc-code)]">[[EXCLUDED_REGION]]</code>으로 보호됩니다.
            </p>

            <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[var(--hc-surface-alt)] border border-[var(--hc-border-subtle)]">
              <div className="truncate text-[11px] text-[var(--hc-muted)]">
                {currentSelectionLabel ? (
                  <>
                    현재 에디터 선택:{" "}
                    <strong className="text-[var(--hc-code)]">{currentSelectionLabel}</strong>
                  </>
                ) : (
                  "에디터에서 표 셀 또는 본문 텍스트를 드래그/클릭하면 바로 추가할 수 있습니다."
                )}
              </div>
              <button
                type="button"
                disabled={!selection}
                onClick={toggleExcludeSelection}
                className="px-2.5 py-1 rounded bg-[var(--hc-accent)] hover:bg-[var(--hc-accent-hover)] disabled:opacity-40 text-[var(--hc-accent-fg)] text-[11px] font-semibold flex items-center gap-1 shrink-0 transition cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>현재 선택 영역 등록/해제</span>
              </button>
            </div>

            {excludedRegions.length > 0 && (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {excludedRegions.map((reg) => (
                  <div
                    key={reg.id}
                    className="px-3 py-2 rounded-lg bg-[var(--hc-surface-alt)] border border-[var(--hc-border-subtle)] flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-[var(--hc-text)]">{reg.label}</div>
                      <div className="text-[11px] text-[var(--hc-muted)] truncate">
                        {reg.rawText || "(빈 셀)"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExcludedRegion(reg.id)}
                      className="p-1 rounded text-[var(--hc-muted)] hover:text-[var(--hc-danger)] transition cursor-pointer"
                      title="제외 영역 삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[var(--hc-surface)] border-t border-[var(--hc-border)] flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--hc-success)] font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>100% 로컬 처리 (외부 클라우드 API 키 불필요)</span>
          </div>
          <button
            type="button"
            onClick={() => setPiiModalOpen(false)}
            className="px-4 py-1.5 rounded-lg bg-[var(--hc-accent)] hover:bg-[var(--hc-accent-hover)] text-[var(--hc-accent-fg)] text-xs font-semibold transition cursor-pointer"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
};
