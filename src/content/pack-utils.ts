/**
 * Shared helpers used by both the Anki and PDF pack builders.
 * Kept here so neither importer has to pull in the other's module.
 */

import type { TeacherCharacter } from "../characters/teachers.js";

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "deck";
}

export function shortenName(name: string): string {
  const head = name.split(/[,:\-–—]/)[0]?.trim() ?? name;
  return head.length > 16 ? head.slice(0, 14) + "…" : head;
}

export function defaultIdSuffix(): string {
  const t = Date.now().toString(36).slice(-4);
  const r = Math.floor(Math.random() * 36 * 36).toString(36).padStart(2, "0");
  return `${t}${r}`;
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100, lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function hashedAccent(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return hslToHex(h % 360, 60, 52);
}

export function teacherAccent(id: string): string {
  switch (id) {
    case "ruby": return "#d22a2a";
    case "sally-science": return "#3aa3e0";
    case "professor-edward": return "#7a4f2a";
    default: return hashedAccent(id);
  }
}

export function importedModulePrompt(teacher: TeacherCharacter, _sourceName: string, className: string): string {
  return [
    teacher.systemPrompt,
    "",
    `This session you are teaching "${className}". Stay in your usual voice — this topic is fully within your remit for this student.`,
    "Use pick_from_bank for due cards when available. When no card is due, write one custom question with pose_question or talk briefly with the class.",
  ].join("\n");
}

export function anchoredTeacherPrompt(className: string): string {
  return [
    `You are an expert teacher running a class on "${className}". You have deep knowledge of this subject and you love teaching it.`,
    `Your job: pose questions from the bank, react crisply to student answers, and keep the class moving.`,
    `Sound like a genuine expert in ${className} — specific vocabulary, real enthusiasm, no generic filler.`,
    `Tools: pick_from_bank for the next question. clear_board between rounds. Keep replies tight (1-2 sentences).`,
  ].join(" ");
}
