// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, beforeEach } from "vitest";
import { useDocStore } from "../../store/useDocStore";
import { createMemoryStore, type MemoryDoc } from "../../memory/index.ts";
import { HeaderToolbar } from "../header/HeaderToolbar";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("Wave 2 Stream D2: Writing Memory UI and Store Integration Tests", () => {
  beforeEach(() => {
    localStorage.clear();
    useDocStore.setState({
      memoryModalOpen: false,
      memoryModalInitialTab: "list",
      memoriesIndex: [],
      activeMemoryIds: [],
    });
  });

  describe("Store initial state and activeMemoryIds invariant", () => {
    it("has memoryModalOpen === false and activeMemoryIds === [] by default", () => {
      const state = useDocStore.getState();
      expect(state.memoryModalOpen).toBe(false);
      expect(state.memoryModalInitialTab).toBe("list");
      expect(state.memoriesIndex).toEqual([]);
      expect(state.activeMemoryIds).toEqual([]);
    });

    it("opens and closes memory modal properly", () => {
      const store = useDocStore.getState();
      store.openMemoryModal("create_multi");
      expect(useDocStore.getState().memoryModalOpen).toBe(true);
      expect(useDocStore.getState().memoryModalInitialTab).toBe("create_multi");

      store.closeMemoryModal();
      expect(useDocStore.getState().memoryModalOpen).toBe(false);
    });
  });

  describe("toggleActiveMemory, moveActiveMemoryPriority, and clearActiveMemories", () => {
    it("toggles active memories in priority order (appends to end when toggled on)", () => {
      const store = useDocStore.getState();

      store.toggleActiveMemory("mem-1");
      expect(useDocStore.getState().activeMemoryIds).toEqual(["mem-1"]);

      store.toggleActiveMemory("mem-2");
      expect(useDocStore.getState().activeMemoryIds).toEqual(["mem-1", "mem-2"]);

      // Toggling an existing id removes it
      store.toggleActiveMemory("mem-1");
      expect(useDocStore.getState().activeMemoryIds).toEqual(["mem-2"]);

      store.toggleActiveMemory("mem-2");
      expect(useDocStore.getState().activeMemoryIds).toEqual([]);
    });

    it("moves priority up and down correctly with bounds checking", () => {
      useDocStore.setState({ activeMemoryIds: ["mem-1", "mem-2", "mem-3"] });
      const store = useDocStore.getState();

      // Move middle element up
      store.moveActiveMemoryPriority("mem-2", "up");
      expect(useDocStore.getState().activeMemoryIds).toEqual(["mem-2", "mem-1", "mem-3"]);

      // Move top element up (should be no-op)
      store.moveActiveMemoryPriority("mem-2", "up");
      expect(useDocStore.getState().activeMemoryIds).toEqual(["mem-2", "mem-1", "mem-3"]);

      // Move top element down
      store.moveActiveMemoryPriority("mem-2", "down");
      expect(useDocStore.getState().activeMemoryIds).toEqual(["mem-1", "mem-2", "mem-3"]);

      // Move bottom element down (should be no-op)
      store.moveActiveMemoryPriority("mem-3", "down");
      expect(useDocStore.getState().activeMemoryIds).toEqual(["mem-1", "mem-2", "mem-3"]);

      // Non-existent id is ignored
      store.moveActiveMemoryPriority("non-existent", "up");
      expect(useDocStore.getState().activeMemoryIds).toEqual(["mem-1", "mem-2", "mem-3"]);
    });

    it("clears all active memories", () => {
      useDocStore.setState({ activeMemoryIds: ["mem-1", "mem-2"] });
      expect(useDocStore.getState().activeMemoryIds.length).toBe(2);

      useDocStore.getState().clearActiveMemories();
      expect(useDocStore.getState().activeMemoryIds).toEqual([]);
    });
  });

  describe("refreshMemoriesIndex auto-cleanup on deleted memory", () => {
    it("filters out deleted memory IDs from activeMemoryIds", async () => {
      const memStore = createMemoryStore();

      const doc1: MemoryDoc = {
        meta: {
          schemaVersion: 1,
          id: "mem-del-1",
          name: "메모리 1",
          description: "설명 1",
          revision: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceDocs: [],
          masked: true,
        },
        body: "## 문서 유형·양식\n- 규칙 1",
      };

      const doc2: MemoryDoc = {
        meta: {
          schemaVersion: 1,
          id: "mem-del-2",
          name: "메모리 2",
          description: "설명 2",
          revision: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceDocs: [],
          masked: true,
        },
        body: "## 문서 유형·양식\n- 규칙 2",
      };

      await memStore.save(doc1, { recordRevision: false });
      await memStore.save(doc2, { recordRevision: false });

      useDocStore.setState({ activeMemoryIds: ["mem-del-1", "mem-del-2"] });

      await useDocStore.getState().refreshMemoriesIndex();
      expect(useDocStore.getState().memoriesIndex.map((m) => m.id)).toContain("mem-del-1");
      expect(useDocStore.getState().memoriesIndex.map((m) => m.id)).toContain("mem-del-2");
      expect(useDocStore.getState().activeMemoryIds).toEqual(["mem-del-1", "mem-del-2"]);

      await memStore.delete("mem-del-1");
      await useDocStore.getState().refreshMemoriesIndex();

      const current = useDocStore.getState();
      expect(current.memoriesIndex.map((m) => m.id)).toEqual(["mem-del-2"]);
      expect(current.activeMemoryIds).toEqual(["mem-del-2"]);
    });
  });

  describe("HeaderToolbar Writing Memory button integration", () => {
    it("renders #btn-open-writing-memory and opens WritingMemoryModal on click", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(React.createElement(HeaderToolbar));
      });

      const memoryBtn = container.querySelector("#btn-open-writing-memory") as HTMLButtonElement;
      expect(memoryBtn).not.toBeNull();
      expect(memoryBtn.textContent).toContain("작성 메모리");

      await act(async () => {
        memoryBtn.click();
      });

      expect(useDocStore.getState().memoryModalOpen).toBe(true);

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });
  });
});
