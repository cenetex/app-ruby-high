import { describe, expect, it } from "vitest";
import { packLibraryCardView } from "../viewer-parts/client-pure.js";

describe("pack library card view", () => {
  it("describes active built-in packs without switch actions", () => {
    expect(packLibraryCardView({
      name: "Ruby High Original",
      source: "official",
      builtIn: true,
      active: true,
      facultyCount: 3,
      questionCount: 600,
    })).toEqual({
      className: "pack-card-item is-active",
      interactive: false,
      tabIndex: 0,
      ariaLabel: "Guest Ruby High Original",
      name: "Ruby High Original",
      description: "Ruby High content pack.",
      chips: ["official", "3 teachers", "600 cards"],
      stateText: "Always on",
      actions: [],
    });
  });

  it("makes inactive installed library packs switchable", () => {
    expect(packLibraryCardView({
      name: "Guest Seminar",
      source: "creator",
      owner: true,
      facultyCount: 1,
      questionCount: 42,
      canEdit: true,
      canUninstall: true,
    })).toEqual({
      className: "pack-card-item is-clickable",
      interactive: true,
      tabIndex: 0,
      ariaLabel: "Set guest Guest Seminar",
      name: "Guest Seminar",
      description: "Ruby High content pack.",
      chips: ["creator", "yours", "1 teachers", "42 cards"],
      stateText: "Set guest",
      actions: [
        { kind: "edit", className: "pack-action", text: "Edit", disabled: false },
        { kind: "uninstall", className: "pack-action", text: "Uninstall", disabled: false },
      ],
    });
  });

  it("uses install or set-guest actions for search results", () => {
    expect(packLibraryCardView({
      name: "Public Pack",
      source: "creator",
      installed: false,
      teacherCount: 2,
      questionCount: 12,
    }, { search: true })).toMatchObject({
      className: "pack-card-item",
      interactive: false,
      chips: ["creator", "2 teachers", "12 cards"],
      stateText: "Not installed",
      actions: [
        { kind: "search-primary", className: "pack-action", text: "Install", disabled: false },
      ],
    });

    expect(packLibraryCardView({
      name: "Installed Pack",
      source: "creator",
      installed: true,
      active: false,
      teacherCount: 1,
      questionCount: 10,
    }, { search: true, busy: true })).toMatchObject({
      chips: ["creator", "installed", "1 teachers", "10 cards"],
      stateText: "Installed",
      actions: [
        { kind: "search-primary", className: "pack-action", text: "Set Guest", disabled: true },
      ],
    });
  });

  it("keeps draft packs editable and deletable but not publicly switchable", () => {
    expect(packLibraryCardView({
      name: "",
      description: "",
      status: "draft",
      questionCount: 0,
      canDelete: true,
    }, { draft: true })).toEqual({
      className: "pack-card-item",
      interactive: false,
      tabIndex: 0,
      ariaLabel: "Set guest Untitled Pack",
      name: "Untitled Pack",
      description: "Draft content pack.",
      chips: ["draft", "0 teachers", "0 cards"],
      stateText: "",
      actions: [
        { kind: "edit", className: "pack-action", text: "Edit", disabled: false },
        { kind: "delete", className: "pack-action danger", text: "Delete", disabled: false },
      ],
    });
  });
});
