import { describe, expect, it } from "vitest";
import {
  packLibraryCardView,
  packQuestionListView,
  packQuestionRowView,
  packTeacherDetailView,
  packTeacherRowView,
} from "../viewer-parts/client-pure.js";

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
      ariaLabel: "Current guest: Ruby High Original",
      name: "Ruby High Original",
      description: "Ruby High course.",
      chips: ["official", "3 teachers", "600 questions"],
      stateText: "Always available",
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
      ariaLabel: "Choose as guest: Guest Seminar",
      name: "Guest Seminar",
      description: "Ruby High course.",
      chips: ["community", "yours", "1 teachers", "42 questions"],
      stateText: "Choose guest",
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
      chips: ["community", "2 teachers", "12 questions"],
      stateText: "Not added",
      actions: [
        { kind: "search-primary", className: "pack-action", text: "Add Course", disabled: false },
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
      chips: ["community", "installed", "1 teachers", "10 questions"],
      stateText: "Added",
      actions: [
        { kind: "search-primary", className: "pack-action", text: "Choose Guest", disabled: true },
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
      ariaLabel: "Choose as guest: Untitled Course",
      name: "Untitled Course",
      description: "Draft course.",
      chips: ["draft", "0 teachers", "0 questions"],
      stateText: "",
      actions: [
        { kind: "edit", className: "pack-action", text: "Edit", disabled: false },
        { kind: "delete", className: "pack-action danger", text: "Delete", disabled: false },
      ],
    });
  });
});

describe("pack teacher row view", () => {
  it("formats selected teacher rows with avatar images and subjects", () => {
    expect(packTeacherRowView({
      id: "teacher-ruby",
      displayName: "Ruby",
      shortName: "Ruby",
      subject: "homeroom",
      questionCount: 1,
    }, {
      selected: true,
      busy: false,
      avatarUrl: "/assets/ruby-face.png",
    })).toEqual({
      className: "pack-teacher-row is-selected",
      selectDisabled: false,
      avatarUrl: "/assets/ruby-face.png",
      avatarText: "R",
      titleText: "Ruby",
      subtitleText: "1 question · homeroom",
      editDisabled: false,
      deleteDisabled: false,
    });
  });

  it("falls back to initials and disables row actions while busy", () => {
    expect(packTeacherRowView({
      id: "teacher-logic",
      displayName: "",
      subject: "",
      questionCount: 0,
    }, {
      selected: false,
      busy: true,
    })).toEqual({
      className: "pack-teacher-row",
      selectDisabled: true,
      avatarUrl: "",
      avatarText: "T",
      titleText: "teacher-logic",
      subtitleText: "0 questions",
      editDisabled: true,
      deleteDisabled: true,
    });
  });

  it("uses a safe untitled teacher label for missing teacher records", () => {
    expect(packTeacherRowView(null)).toMatchObject({
      className: "pack-teacher-row",
      avatarText: "?",
      titleText: "Untitled teacher",
      subtitleText: "0 questions",
    });
  });
});

describe("pack teacher detail view", () => {
  it("formats the selected teacher detail header", () => {
    expect(packTeacherDetailView({
      id: "teacher-ruby",
      displayName: "Ruby",
      questionCount: 7,
      materialSourceUrl: "https://example.test/ruby.md",
      description: "Homeroom ethics and school-world systems.",
    })).toEqual({
      nameText: "Ruby",
      metaText: "7 questions · linked materials",
      descriptionText: "Homeroom ethics and school-world systems.",
    });
  });

  it("uses a safe empty detail state when no teacher is selected", () => {
    expect(packTeacherDetailView(null)).toEqual({
      nameText: "No teacher selected",
      metaText: "Add a teacher to set up this course.",
      descriptionText: "",
    });
  });
});

describe("pack question list view", () => {
  it("formats generated question rows", () => {
    expect(packQuestionRowView({
      id: "q-1",
      prompt: "When should a shared ledger override optimistic UI?",
      subject: "multiplayer ethics",
      difficulty: "hard",
      answer: "when both sides commit",
    })).toEqual({
      id: "q-1",
      promptText: "When should a shared ledger override optimistic UI?",
      detailText: "multiplayer ethics · hard · when both sides commit",
      deleteText: "Delete",
    });
  });

  it("summarizes the empty teacher and empty question states", () => {
    expect(packQuestionListView(null)).toEqual({
      emptyText: "Select or add a teacher.",
      rows: [],
    });

    expect(packQuestionListView({ questions: [] })).toEqual({
      emptyText: "No generated questions yet.",
      rows: [],
    });
  });

  it("maps teacher questions into row views", () => {
    expect(packQuestionListView({
      questions: [
        { id: "q-1", prompt: "", subject: "", difficulty: "", answer: "" },
        { id: "q-2", prompt: "Explain trust boundaries.", subject: "security", difficulty: "medium" },
      ],
    })).toEqual({
      emptyText: "",
      rows: [
        {
          id: "q-1",
          promptText: "Untitled question",
          detailText: "open study · medium",
          deleteText: "Delete",
        },
        {
          id: "q-2",
          promptText: "Explain trust boundaries.",
          detailText: "security · medium",
          deleteText: "Delete",
        },
      ],
    });
  });
});
