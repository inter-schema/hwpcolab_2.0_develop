import React, { useEffect, useRef } from "react";
import { bootHopStudio } from "@/main";
import studioIndexHtmlRaw from "../../../third_party/rhwp/rhwp-studio/index.html?raw";
import { useDocStore } from "../../store/useDocStore";
import { hopBridge } from "../../core/hopBridge";
import { mapSelectionFromHopContext } from "../../core/hitTestSelection";

function extractStudioRootInnerHtml(rawHtml: string): string {
  const startMarker = '<div id="studio-root">';
  const startIdx = rawHtml.indexOf(startMarker);
  if (startIdx < 0) return "";
  const contentStart = startIdx + startMarker.length;
  const endMatch = rawHtml.lastIndexOf("</footer>");
  if (endMatch < 0) return rawHtml.slice(contentStart);
  return rawHtml.slice(contentStart, endMatch + "</footer>".length);
}

const STUDIO_ROOT_HTML = {
  __html: extractStudioRootInnerHtml(studioIndexHtmlRaw),
};

/**
 * HOP-Claw Studio Host
 * 최신 rhwp-studio(third_party/rhwp/rhwp-studio) 엔진을 직접 마운트하며,
 * 캔버스 선택 좌표 및 통합 [표 만들기] 중첩표 생성 훅을 양방향으로 동기화합니다.
 */
export const HopEditorHost: React.FC = () => {
  const bootedRef = useRef(false);
  const setSelection = useDocStore((s) => s.setSelection);
  const insertNestedTableAtCurrentCell = useDocStore((s) => s.insertNestedTableAtCurrentCell);

  // 통합 [표 만들기] 모달에서 셀 내부 중첩표 생성을 호출할 때 연결되는 전역 브릿지
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__HOP_CLAW_INSERT_NESTED_TABLE__ = async (opts: {
      rows: number;
      cols: number;
    }) => {
      return await insertNestedTableAtCurrentCell(opts.rows, opts.cols);
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__HOP_CLAW_INSERT_NESTED_TABLE__;
    };
  }, [insertNestedTableAtCurrentCell]);

  useEffect(() => {
    if (!bootedRef.current) {
      bootedRef.current = true;
      bootHopStudio().catch((err) => {
        console.error("[HopEditorHost] bootHopStudio failed:", err);
      });
    }
  }, []);

  // 에디터 선택 상태(본문 드래그 / 표 셀 선택)를 주기적·이벤트 기반으로 스토어에 동기화
  useEffect(() => {
    let lastSig = "";

    const syncSelectionFromHop = () => {
      const ctx = hopBridge.getSelectionContext();
      if (!ctx) return;

      const state = useDocStore.getState();
      const mapped = mapSelectionFromHopContext(ctx, state.tablesMeta);
      const sig = JSON.stringify(mapped);
      if (sig !== lastSig) {
        lastSig = sig;
        setSelection(mapped);
      }
    };

    const handlePointerOrKey = () => {
      window.setTimeout(syncSelectionFromHop, 40);
    };

    window.addEventListener("mouseup", handlePointerOrKey);
    window.addEventListener("keyup", handlePointerOrKey);
    const interval = window.setInterval(syncSelectionFromHop, 450);

    return () => {
      window.removeEventListener("mouseup", handlePointerOrKey);
      window.removeEventListener("keyup", handlePointerOrKey);
      window.clearInterval(interval);
    };
  }, [setSelection]);

  return (
    <div id="hop-editor-host" className="w-full h-full flex flex-col overflow-hidden relative">
      <div
        id="studio-root"
        className="w-full h-full flex flex-col"
        dangerouslySetInnerHTML={STUDIO_ROOT_HTML}
      />
    </div>
  );
};
