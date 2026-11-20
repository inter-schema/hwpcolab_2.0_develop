import { describe, it, expect, beforeEach } from "vitest";
import { useDocStore } from "../store/useDocStore";

describe("Dual Palette Theme (Rose Blossom / Amber Espresso)", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("hop-claw-palette");
    }
    if (typeof document !== "undefined") {
      delete document.documentElement.dataset.hcPalette;
      document.documentElement.classList.remove("dark");
      document.documentElement.removeAttribute("data-theme");
    }
    useDocStore.getState().setUiPalette("rose");
  });

  it("defaults to rose palette and maps rose -> light mode", () => {
    expect(useDocStore.getState().uiPalette).toBe("rose");
    if (typeof document !== "undefined") {
      expect(document.documentElement.dataset.hcPalette).toBe("rose");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    }
  });

  it("switches to espresso palette, persists to localStorage, and maps espresso -> dark mode", () => {
    useDocStore.getState().setUiPalette("espresso");
    expect(useDocStore.getState().uiPalette).toBe("espresso");
    if (typeof localStorage !== "undefined") {
      expect(localStorage.getItem("hop-claw-palette")).toBe("espresso");
    }
    if (typeof document !== "undefined") {
      expect(document.documentElement.dataset.hcPalette).toBe("espresso");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    }
  });

  it("toggles cleanly back and forth between rose and espresso", () => {
    useDocStore.getState().toggleUiPalette();
    expect(useDocStore.getState().uiPalette).toBe("espresso");
    useDocStore.getState().toggleUiPalette();
    expect(useDocStore.getState().uiPalette).toBe("rose");
  });
});
