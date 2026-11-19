import type { WasmBridge } from "@/core/wasm-bridge";
import type { EventBus } from "@/core/event-bus";
import type { CanvasView } from "@/view/canvas-view";
import type { InputHandler } from "@/engine/input-handler";
import type { CellBBox, SelectionTarget, TableCoordinateMeta } from "../types/hwp";
import type { HopSelectionContext } from "./hitTestSelection";

export interface HopRuntimeHandle {
  wasm: WasmBridge;
  canvasView: CanvasView;
  inputHandler: InputHandler;
  eventBus: EventBus;
  openBytesInHop: (bytes: Uint8Array, fileName: string) => Promise<void>;
}

interface HopStudioControl {
  loadBytes: (bytes: Uint8Array, fileName: string) => Promise<void>;
  exportBytes: (asHwpx: boolean) => Uint8Array;
  getSelectionContext: () => HopSelectionContext;
  setThemeMode: (mode: "system" | "light" | "dark") => void;
  getBridge: () => WasmBridge;
  getCurrentFileName: () => string;
  refreshView: () => Promise<void>;
  getRuntimeHandle?: () => HopRuntimeHandle;
}

class HopBridgeManager {
  private handle: HopRuntimeHandle | null = null;
  private readyResolvers: Array<(h: HopRuntimeHandle | null) => void> = [];
  private isProgrammaticReload = false;
  private onHumanDocumentMutated: (() => void) | null = null;
  private onHopDocumentOpened: ((info: { fileName: string; sourceBytes: Uint8Array | null }) => void) | null = null;
  private onSelectionChanged: ((sel: SelectionTarget | null, toolbarPos: { x: number; y: number } | null) => void) | null = null;

  private getStudioControl(): HopStudioControl | null {
    if (typeof window === "undefined") return null;
    return ((window as any).__HOP_STUDIO_CONTROL__ as HopStudioControl | undefined) ?? null;
  }

  public registerRuntime(handle: HopRuntimeHandle): void {
    this.handle = handle;
    if (typeof window !== "undefined") {
      (window as any).__hopBridge = this;
    }

    handle.eventBus.on("document-changed", () => {
      if (this.isProgrammaticReload) return;
      this.onHumanDocumentMutated?.();
    });

    for (const resolve of this.readyResolvers) {
      resolve(handle);
    }
    this.readyResolvers = [];
  }

  public async waitForReady(timeoutMs = 15000): Promise<HopRuntimeHandle | null> {
    if (this.handle) return this.handle;
    const ctrl = this.getStudioControl();
    if (ctrl) {
      const rt = ctrl.getRuntimeHandle?.() ?? null;
      if (rt) {
        this.registerRuntime(rt);
        return rt;
      }
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (h: HopRuntimeHandle | null) => {
        if (settled) return;
        settled = true;
        window.clearInterval(pollTimer);
        window.clearTimeout(timeoutTimer);
        resolve(h);
      };

      this.readyResolvers.push(finish);

      const pollTimer = window.setInterval(() => {
        const c = this.getStudioControl();
        if (c) {
          const rt = c.getRuntimeHandle?.() ?? null;
          if (rt) this.registerRuntime(rt);
          finish(rt);
        }
      }, 60);

      const timeoutTimer = window.setTimeout(() => {
        finish(this.handle);
      }, timeoutMs);
    });
  }

  public getRuntime(): HopRuntimeHandle | null {
    if (this.handle) return this.handle;
    const ctrl = this.getStudioControl();
    const rt = ctrl?.getRuntimeHandle?.() ?? null;
    if (rt) {
      this.registerRuntime(rt);
      return rt;
    }
    return null;
  }

  public setHumanMutationListener(cb: (() => void) | null): void {
    this.onHumanDocumentMutated = cb;
  }

  public setSelectionListener(
    cb: ((sel: SelectionTarget | null, toolbarPos: { x: number; y: number } | null) => void) | null
  ): void {
    this.onSelectionChanged = cb;
  }

  public notifySelectionChanged(sel: SelectionTarget | null, toolbarPos: { x: number; y: number } | null): void {
    this.onSelectionChanged?.(sel, toolbarPos);
  }

  public notifyHopDocumentInitialized(info: { fileName: string; sourceBytes: Uint8Array | null }): void {
    if (this.isProgrammaticReload) return;
    this.onHopDocumentOpened?.(info);
  }

  public setHopDocumentOpenedListener(
    cb: ((info: { fileName: string; sourceBytes: Uint8Array | null }) => void) | null
  ): void {
    this.onHopDocumentOpened = cb;
  }

  public getSelectionContext(): HopSelectionContext | null {
    const ctrl = this.getStudioControl();
    if (!ctrl) return null;
    try {
      return ctrl.getSelectionContext();
    } catch {
      return null;
    }
  }

  public setHopThemeMode(mode: "system" | "light" | "dark"): void {
    const ctrl = this.getStudioControl();
    if (ctrl) {
      try {
        ctrl.setThemeMode(mode);
      } catch (e) {
        console.warn("[HopBridge] setThemeMode failed:", e);
      }
    }

    // Ensure root document data-theme & dark class stay synchronized even before studio boots
    if (typeof document !== "undefined") {
      try {
        localStorage.setItem("rhwp-theme-mode", mode);
      } catch {}
      const prefersDark =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
      const resolved = mode === "system" ? (prefersDark ? "dark" : "light") : mode;
      document.documentElement.setAttribute("data-theme", resolved);
      document.documentElement.classList.toggle("dark", resolved === "dark");
    }
  }

  public async loadDocumentIntoHop(bytes: Uint8Array, fileName: string): Promise<void> {
    await this.waitForReady();
    const ctrl = this.getStudioControl();
    this.isProgrammaticReload = true;
    try {
      if (ctrl) {
        await ctrl.loadBytes(bytes, fileName);
      } else if (this.handle) {
        await this.handle.openBytesInHop(bytes, fileName);
      }
    } finally {
      window.setTimeout(() => {
        this.isProgrammaticReload = false;
      }, 60);
    }
  }

  public exportHopBytes(isHwpx: boolean): Uint8Array | null {
    const ctrl = this.getStudioControl();
    if (ctrl) {
      try {
        const bridge = ctrl.getBridge();
        if (!bridge?.hasLoadedDocument()) return null;
        return ctrl.exportBytes(isHwpx);
      } catch (e) {
        console.warn("[HopBridge] exportHopBytes failed:", e);
        return null;
      }
    }
    if (!this.handle || !this.handle.wasm.hasLoadedDocument()) return null;
    try {
      return isHwpx ? this.handle.wasm.exportHwpx() : this.handle.wasm.exportHwp();
    } catch (e) {
      console.warn("[HopBridge] exportHopBytes failed:", e);
      return null;
    }
  }

  public enrichTablesMetaWithBboxes(tablesMeta: TableCoordinateMeta[]): TableCoordinateMeta[] {
    const wasm = this.getStudioControl()?.getBridge() ?? this.handle?.wasm ?? null;
    if (!wasm || !wasm.hasLoadedDocument()) return tablesMeta;

    let tableControls: Array<{ list: number; para: number; controlIndex: number }> = [];
    try {
      const allCtrls = wasm.getControls();
      tableControls = allCtrls.filter((c: any) => c.ctrlId === "tbl " || c.ctrlId === "tbl");
    } catch {}

    let topIdx = 0;
    return tablesMeta.map((table) => {
      if (table.depth && table.depth > 0) {
        return table;
      }
      const ctrlRef = tableControls[topIdx++];
      const sec = ctrlRef?.list ?? table.sec ?? 0;
      const para = ctrlRef?.para ?? table.para ?? 0;
      const ctrl = ctrlRef?.controlIndex ?? table.ctrl ?? 0;

      let bboxes: CellBBox[] = [];
      try {
        const rawBboxes = wasm.getTableCellBboxes(sec, para, ctrl);
        if (Array.isArray(rawBboxes)) {
          bboxes = rawBboxes.map((b: any) => ({
            cellIdx: b.cellIdx ?? 0,
            row: b.row ?? 0,
            col: b.col ?? 0,
            rowSpan: b.rowSpan ?? 1,
            colSpan: b.colSpan ?? 1,
            pageIndex: b.pageIndex ?? 0,
            x: b.x ?? 0,
            y: b.y ?? 0,
            w: b.w ?? 80,
            h: b.h ?? 24,
          }));
        }
      } catch {}

      return {
        ...table,
        sec,
        para,
        ctrl,
        cells: table.cells.map((cell) => {
          const matchedBbox =
            bboxes.find((b) => b.row === cell.row && b.col === cell.col) ||
            bboxes.find((b) => b.cellIdx === cell.idx) ||
            cell.bbox;
          return {
            ...cell,
            bbox: matchedBbox,
          };
        }),
      };
    });
  }

  public pageBoxToContainerCoords(pageIndex: number, pageX: number, pageY: number): { x: number; y: number } | null {
    const rt = this.getRuntime();
    if (!rt) return null;
    const scrollContainer = document.getElementById("scroll-container");
    const scrollContent = document.getElementById("scroll-content");
    if (!scrollContainer || !scrollContent) return null;

    const vs = rt.canvasView.getVirtualScroll();
    const zoom = rt.canvasView.getViewportManager().getZoom();
    const pageTop = vs.getPageOffset(pageIndex);
    const pageLeft = vs.getPageLeftResolved(pageIndex, scrollContent.clientWidth);

    const xInContent = pageLeft + pageX * zoom;
    const yInContent = pageTop + pageY * zoom;

    return {
      x: xInContent - scrollContainer.scrollLeft,
      y: yInContent - scrollContainer.scrollTop,
    };
  }
}

export const hopBridge = new HopBridgeManager();
