import React from "react";
import { useDocStore } from "../../store/useDocStore";
import { GPL_V3_FULL_TEXT } from "../../constants/gplv3Text";
import { X, Scale, FileText } from "lucide-react";

export const LicenseModal: React.FC = () => {
  const { licenseModalOpen, setLicenseModalOpen } = useDocStore();

  if (!licenseModalOpen) return null;

  return (
    <div
      id="license-modal-backdrop"
      className="hc-chrome fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
    >
      <div
        id="license-modal"
        className="bg-[var(--hc-card)] rounded-2xl shadow-2xl border border-[var(--hc-border)] w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden text-[var(--hc-text)]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--hc-border)] flex items-center justify-between bg-[var(--hc-surface)]">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-[var(--hc-accent)] shrink-0" />
            <h2 className="font-bold text-[var(--hc-text)] text-sm">
              HOP-Claw 오픈소스 라이선스 고지 (GNU GPL v3.0)
            </h2>
          </div>
          <button
            id="license-modal-close-btn"
            type="button"
            onClick={() => setLicenseModalOpen(false)}
            className="text-[var(--hc-muted)] hover:text-[var(--hc-text)] p-1 rounded-lg hover:bg-[var(--hc-accent-soft)] transition-colors"
            title="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto text-xs leading-relaxed text-[var(--hc-text)] bg-[var(--hc-bg)]">
          {/* Summary Banner */}
          <div className="bg-[var(--hc-card)] border border-[var(--hc-border)] rounded-xl p-3.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 font-bold text-[var(--hc-text)] text-xs">
              <FileText className="w-4 h-4 text-[var(--hc-accent)] shrink-0" />
              <span>HOP-Claw 라이선스 요약 및 고지</span>
            </div>
            <p className="text-[var(--hc-muted)] leading-normal">
              HOP-Claw는 자유 소프트웨어(Free Software)이며, Free Software Foundation이 발행한{" "}
              <strong className="text-[var(--hc-text)]">
                GNU General Public License v3.0 (또는 그 이후 버전)
              </strong>
              에 따라 수정 및 재배포될 수 있습니다.
            </p>
            <div className="mt-1 pt-2 border-t border-[var(--hc-border-subtle)] text-[11px] text-[var(--hc-muted)] flex flex-col gap-1">
              <div className="text-[var(--hc-text)] font-semibold">타사 소프트웨어 라이선스 고지:</div>
              <div>· <strong className="text-[var(--hc-text)]">@rhwp/core</strong> (HWP 5.0 바이너리 파서): MIT License</div>
              <div>· <strong className="text-[var(--hc-text)]">Lucide React</strong> (아이콘 에셋): ISC License</div>
              <div>· <strong className="text-[var(--hc-text)]">Tauri / Rust</strong> (데스크톱 런타임): MIT / Apache-2.0 License</div>
            </div>
          </div>

          {/* Full Text */}
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-[var(--hc-text)] text-[11px]">
              GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007 전문
            </span>
            <pre
              id="gpl-v3-text-box"
              className="bg-[var(--hc-surface-alt)] text-[var(--hc-text)] p-3.5 rounded-xl font-mono text-[10px] leading-relaxed max-h-72 overflow-y-auto whitespace-pre-wrap select-text border border-[var(--hc-border)]"
            >
              {GPL_V3_FULL_TEXT}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--hc-border)] flex justify-end bg-[var(--hc-surface)]">
          <button
            type="button"
            onClick={() => setLicenseModalOpen(false)}
            className="px-4 py-1.5 rounded-lg bg-[var(--hc-accent)] hover:bg-[var(--hc-accent-hover)] text-[var(--hc-accent-fg)] font-semibold text-xs transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
};
