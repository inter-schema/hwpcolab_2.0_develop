import { tableCommands as upstreamTableCommands } from '@/upstream/commands';
import type { CommandDef } from '@/upstream/commands';
import { replaceUpstreamCommands } from '../replace-upstream-commands';
import { TableCreateDialog } from '@/ui/table-create-dialog';
import type { TableCreateOptions } from '@/ui/table-create-dialog';
import { useDocStore } from '../../../store/useDocStore';

function safeTableOp(fn: () => void, label: string): void {
  try {
    fn();
  } catch (e) {
    console.error(`[table] ${label} 실패:`, e);
  }
}

const upstreamCreateCommand = upstreamTableCommands.find((c) => c.id === 'table:create');

export const overriddenTableCreateCommand: CommandDef = {
  id: 'table:create',
  label: upstreamCreateCommand?.label ?? '표 만들기',
  icon: 'icon-table',
  opensDialog: true,
  canExecute: (ctx) => ctx.hasDocument,
  execute(services, params) {
    const ih = services.getInputHandler();
    if (!ih) return;
    const pos = ih.getCursorPosition();

    // Detect if cursor is inside a table cell OR in table cell block selection mode
    const isCellSelMode =
      typeof (ih as any).isInCellSelectionMode === 'function' &&
      Boolean((ih as any).isInCellSelectionMode());
    const cellBlock =
      typeof (ih as any).getSelectedCellBlock === 'function'
        ? (ih as any).getSelectedCellBlock()
        : null;
    const cellTableCtx =
      typeof (ih as any).cursor?.getCellTableContext === 'function'
        ? (ih as any).cursor.getCellTableContext()
        : null;

    const inTable =
      pos.parentParaIndex !== undefined ||
      isCellSelMode ||
      (cellBlock && typeof cellBlock.ppi === 'number');

    // 1. 커서가 표 외부인 경우: 기존 upstream TableCreateDialog로 본문 표 생성
    if (!inTable) {
      const dialog = new TableCreateDialog();
      dialog.onApply = (rows, cols, options?: TableCreateOptions) => {
        const ih2 = services.getInputHandler();
        if (!ih2) return;
        safeTableOp(() => ih2.executeOperation({
          kind: 'snapshot',
          operationType: 'createTable',
          operation: (wasm) => {
            const result = options
              ? wasm.createTableEx({
                  sectionIdx: pos.sectionIndex,
                  paraIdx: pos.paragraphIndex,
                  charOffset: pos.charOffset,
                  rowCount: rows,
                  colCount: cols,
                  ...options,
                })
              : wasm.createTable(pos.sectionIndex, pos.paragraphIndex, pos.charOffset, rows, cols);
            if (result.ok) {
              return {
                sectionIndex: pos.sectionIndex,
                paragraphIndex: 0,
                charOffset: 0,
                parentParaIndex: result.paraIdx,
                controlIndex: result.controlIdx,
                cellIndex: 0,
                cellParaIndex: 0,
              };
            }
            return pos;
          },
        }), '표 만들기');
        (ih2 as any).textarea?.focus();
      };
      dialog.show(params?.anchorEl as HTMLElement | undefined);
      return;
    }

    // 2. 커서가 표 내부인 경우: 동일 [표 만들기] 버튼으로 중첩 표 생성
    const secIdx = pos.sectionIndex ?? cellBlock?.sec ?? cellTableCtx?.sectionIdx ?? 0;
    const parentParaIdx =
      pos.parentParaIndex ?? cellBlock?.ppi ?? cellTableCtx?.paraIdx ?? 0;
    const controlIdx =
      pos.controlIndex ?? cellBlock?.ci ?? cellTableCtx?.controlIdx ?? 0;

    let row = cellBlock?.startRow ?? 0;
    let col = cellBlock?.startCol ?? 0;

    if (pos.parentParaIndex !== undefined) {
      try {
        const cellInfo = services.wasm.getCellInfo(
          secIdx,
          parentParaIdx,
          controlIdx,
          pos.cellIndex ?? 0
        );
        if (cellInfo && typeof cellInfo.row === 'number') {
          row = cellInfo.row;
          col = cellInfo.col;
        }
      } catch (e) {
        console.warn('[table:create] getCellInfo 조회 실패, 기본 좌표 사용:', e);
      }
    }

    const docState = useDocStore.getState();
    const { isHwpx, tablesMeta } = docState;

    if (!isHwpx) {
      if (typeof globalThis.alert === 'function') {
        globalThis.alert('중첩 표는 HWPX 형식에서 지원됩니다. [새 문서 .hwpx]나 HWPX 파일에서 사용해주세요.');
      }
      return;
    }

    // tablesMeta에서 tableIndex 매핑
    const matchedIdx = tablesMeta.findIndex(
      (t) =>
        t.sec === secIdx &&
        t.para === parentParaIdx &&
        t.ctrl === controlIdx
    );
    const tableIndex = matchedIdx !== -1 ? matchedIdx : 0;

    const dialog = new TableCreateDialog();
    dialog.onApply = async (rows, cols) => {
      const targetRows = Math.max(1, Math.min(8, rows));
      const targetCols = Math.max(1, Math.min(8, cols));
      try {
        await useDocStore.getState().applyHumanNestedTableInsert(
          tableIndex,
          row,
          col,
          targetRows,
          targetCols
        );
      } catch (err: any) {
        console.error('[table:create] 중첩 표 생성 실패:', err);
        if (typeof globalThis.alert === 'function') {
          globalThis.alert(`중첩 표 생성 실패: ${err?.message || err}`);
        }
      }
      const ih2 = services.getInputHandler();
      (ih2 as any)?.textarea?.focus();
    };
    dialog.show(params?.anchorEl as HTMLElement | undefined);
  },
};

export const tableCommands: CommandDef[] = replaceUpstreamCommands(
  upstreamTableCommands,
  [overriddenTableCreateCommand]
);
