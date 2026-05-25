// @ts-nocheck
// Pure helpers + constants for the inline viewer client.
// Each export is stringified into the inline <script> IIFE by
// viewer-parts/script.ts so it ends up as a sibling of runViewerClient.
// "Pure" here means: no closures over runViewerClient's outer state
// (lastTelemetry, els, authed, etc.). Helpers that take state via
// parameter are fine. Helpers may freely reference other helpers or
// VIEWER_CONSTANTS — both are in the same IIFE scope at runtime.

export const VIEWER_CONSTANTS = {
  VISITOR_ID_KEY: "ruby-high:visitor-id",
  GRADE_LABELS: { "9": "Freshman", "10": "Sophomore", "11": "Junior", "12": "Senior" },
  GRADE_SHORT_LABELS: { "9": "Fresh", "10": "Soph", "11": "Junior", "12": "Senior" },
  GRADE_ORDER: ["9", "10", "11", "12"],
  WALLET_ACTION_TIMEOUT_MS: 120000,
  STREAK_REQUIRED: { "9": 1, "10": 2, "11": 3, "12": 4 },
  TEACHING_FACULTY_IDS: ["ruby", "sally-science", "professor-edward"],
  TEACHING_FACULTY_LABELS: { ruby: "Homeroom", "sally-science": "Science", "professor-edward": "Literature" },
  LOUNGE_ID: "lounge",
  FIRST_BELL_PAGE_COUNT: 12,
  FIRST_BELL_PAGE_TITLES: {
    1: "Ruby High: Book One - First Bell",
    2: "First-Day Survival Kit",
    3: "Release Notes: New Faces on Campus",
    4: "A Normal First Day",
    5: "New School, New People",
    6: "New Rooms, New Faces",
    7: "Lunch Table Theory",
    8: "First Day Debrief",
    9: "End-of-Day Debrief",
    10: "Captain Null: The Star That Cast a Shadow",
    11: "Ruby's Locker Notes",
    12: "Ruby High Student Cards",
  },
  STAT_META: {
    head:   { emoji: "🧠", label: "Head" },
    heart:  { emoji: "💗", label: "Heart" },
    hustle: { emoji: "⚡", label: "Hustle" },
    honor:  { emoji: "🛡️", label: "Honor" },
  },
  HALL_PASS_CARDS_PER_PACK: 5,
};

// ── grading + score formatting ─────────────────────────────────────
export function statLabel(stat) {
  const meta = STAT_META[String(stat || "").toLowerCase()];
  return meta ? meta.emoji + " " + meta.label : "🧠 Head";
}
export function scoreAwardLabel(award) {
  if (!award) return "";
  const points = Math.max(0, Math.round(Number(award.points || 0)));
  const mult = Math.max(1, Math.round(Number(award.multiplier || 1)));
  if (mult >= 5) return "+" + points + " Merit Stars · Daily Class ×5";
  return "+" + points + " Merit Stars" + (mult > 1 ? " · ×" + mult : "");
}
export function letterGradePasses(grade) {
  return /^[ABC]/.test(String(grade || ""));
}
export function letterGradeForScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "—";
  if (n >= 90) return "A";
  if (n >= 80) return "B";
  if (n >= 67) return "C";
  if (n > 0) return "D";
  return "F";
}
export function streakScoreMultiplier(count) {
  const n = Math.max(0, Math.floor(Number(count || 0)));
  if (n >= 4) return 5;
  if (n >= 3) return 3;
  if (n >= 2) return 2;
  return 1;
}
export function formatClassScore(score) {
  const n = Number(score);
  return Number.isFinite(n) ? Math.round(n) + "%" : "—";
}
export function todayCorrectSummary(today) {
  const answered = Math.max(0, Math.floor(Number(today && today.questionCount || 0)));
  const total = Math.max(answered, Math.floor(Number(today && today.totalQuestions || 3)));
  const correct = Math.max(0, Math.min(answered, Math.floor(Number(today && today.correctCount || 0))));
  const answeredText = answered === 1 ? "1 of " + total + " answered" : answered + " of " + total + " answered";
  return {
    value: correct + "/" + answered,
    detail: answered > 0 ? answeredText : "class not started",
    met: answered > 0 && correct === answered,
  };
}

// ── visitor id ─────────────────────────────────────────────────────
export function makeVisitorId() {
  const cryptoObj = window.crypto || window.msCrypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") return "rhv_" + cryptoObj.randomUUID();
  const random = Math.random().toString(36).slice(2, 12);
  return "rhv_" + Date.now().toString(36) + "_" + random;
}
export function getVisitorId() {
  try {
    const existing = localStorage.getItem(VISITOR_ID_KEY);
    if (existing && /^[A-Za-z0-9._:-]{8,128}$/.test(existing)) return existing;
    const next = makeVisitorId();
    localStorage.setItem(VISITOR_ID_KEY, next);
    return next;
  } catch (_err) {
    return "";
  }
}
export function attachVisitorHeader(headers) {
  const visitorId = getVisitorId();
  if (visitorId) headers.set("X-Ruby-High-Visitor", visitorId);
  return headers;
}

// ── subject progress (takes progress object as input) ──────────────
export function teacherShortName(faculty, fallback) {
  return (faculty && (faculty.shortName || faculty.displayName)) || fallback || "Teacher";
}
export function earnedCourseGrade(progress) {
  if (!progress) return "";
  const grade = progress.courseGrade || progress.grade || "";
  if (!grade || grade === "—") return "";
  const completed = Number(progress.completedClasses || 0);
  const required = Number(progress.requiredClasses || 0);
  if (required > 0 && completed < required) return "";
  return grade;
}
export function subjectProgressShortLabel(progress) {
  if (!progress) return "—";
  const required = Math.max(0, Math.floor(Number(progress.requiredClasses || 0)));
  const completed = Math.max(0, Math.floor(Number(progress.completedClasses || 0)));
  if (required > 0) return Math.min(completed, required) + "/" + required;
  return earnedCourseGrade(progress) || "—";
}
export function subjectProgressLongLabel(progress) {
  if (!progress) return "course pending";
  const required = Math.max(0, Math.floor(Number(progress.requiredClasses || 0)));
  if (required > 0) return subjectProgressShortLabel(progress) + " daily classes";
  return "course pending";
}
export function subjectStandingLabel(progress) {
  return earnedCourseGrade(progress) || subjectProgressLongLabel(progress);
}
export function subjectStatusText(progress) {
  if (!progress) return "settling in";
  const standing = subjectStandingLabel(progress);
  const done = Number(progress.completedClasses || 0);
  const required = Number(progress.requiredClasses || 0);
  const today = progress.today || {};
  if (today.status === "complete") {
    return "daily class complete" + (today.letterGrade ? " · " + today.letterGrade : "") + " · " + standing;
  }
  if (today.status === "active") {
    return questionsLeftText(today) + " · " + standing;
  }
  if (required > 0) return Math.min(done, required) + "/" + required + " daily classes";
  return standing;
}
export function questionsLeftInClass(today) {
  const total = Number(today && today.totalQuestions || 3);
  const done = Number(today && today.questionCount || 0);
  return Math.max(0, total - done);
}
export function questionsLeftText(today) {
  const left = questionsLeftInClass(today);
  if (left <= 0) return "daily class complete";
  return left + " " + (left === 1 ? "question" : "questions") + " left";
}
export function questionsLeftSentence(today) {
  const left = questionsLeftInClass(today);
  if (left <= 0) return "Daily class complete";
  return (left === 1 ? "There is " : "There are ") + questionsLeftText(today);
}

// ── number / money / token / duration formatting ───────────────────
export function formatWholeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
export function formatMoney(cents, currency) {
  const amount = Number(cents || 0) / 100;
  const code = String(currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(amount);
  } catch (_e) {
    return code + " " + amount.toFixed(2);
  }
}
export function formatTokenAmount(amount, symbol) {
  const numeric = Number(amount);
  const text = Number.isFinite(numeric)
    ? numeric.toLocaleString(undefined, { maximumFractionDigits: 9 })
    : String(amount || "0");
  return text + " $" + String(symbol || "RUBY").toUpperCase();
}
export function formatTokenDisplayAmount(value) {
  const raw = String(value || "").trim();
  const parsed = Number(raw);
  if (!raw) return "?";
  if (!Number.isFinite(parsed) || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return raw;
  if (Number.isInteger(parsed)) return formatWholeNumber(parsed);
  return parsed.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
export function formatDuration(ms) {
  const hours = Math.max(1, Math.round(Number(ms || 0) / 3600000));
  if (hours % 24 === 0) {
    const days = Math.max(1, Math.round(hours / 24));
    if (days % 7 === 0) {
      const weeks = Math.max(1, Math.round(days / 7));
      return weeks + " week" + (weeks === 1 ? "" : "s");
    }
    return days + " day" + (days === 1 ? "" : "s");
  }
  return hours + " hour" + (hours === 1 ? "" : "s");
}
export function formatRelativeExpiry(expiresAt) {
  const ms = Math.max(0, Number(expiresAt || 0) - Date.now());
  if (ms <= 0) return "";
  const hours = Math.ceil(ms / 3600000);
  if (hours >= 24) return Math.ceil(hours / 24) + "d";
  return hours + "h";
}

// ── short string / number utilities ────────────────────────────────
export function positiveWholeNumber(value, fallback) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
export function hallPassCostLabel(cost) {
  const normalized = positiveWholeNumber(cost, 1);
  return formatWholeNumber(normalized) + " Hall Pass" + (normalized === 1 ? "" : "es");
}
export function clipPlayerContext(text, max) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const limit = max || 150;
  return raw.length > limit ? raw.slice(0, limit - 1) + "…" : raw;
}
export function imageRequestId(prefix) {
  const cryptoObj = window.crypto || window.msCrypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return String(prefix || "image") + "-" + cryptoObj.randomUUID();
  }
  return String(prefix || "image") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
export function shortWallet(address) {
  const raw = String(address || "");
  return raw.length > 12 ? raw.slice(0, 6) + "..." + raw.slice(-4) : raw;
}
export function walletPreviewAddress(address) {
  const raw = String(address || "").trim();
  return raw ? shortWallet(raw) : "Not connected";
}
export function walletPreviewLine(label, value) {
  const text = String(value || "").trim();
  return label + ": " + (text || "Unavailable");
}

// ── date formatters ────────────────────────────────────────────────
export function formatAccountDate(ts) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return "unknown date";
  try {
    return new Date(n).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch (_err) {
    return "unknown date";
  }
}
export function formatSealedDate(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    const m = d.toLocaleDateString(undefined, { month: "short" });
    return m + " " + d.getFullYear();
  } catch { return "—"; }
}

// ── ceremony / essay helpers ───────────────────────────────────────
export function nextGradeAfterClient(grade) {
  const order = ["9", "10", "11", "12"];
  const idx = order.indexOf(String(grade));
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
}
export function fmtStat(n) { return (n >= 0 ? "+" : "") + n; }
export function fmtRewardStat(stat, value) {
  return stat.toUpperCase() + " " + fmtStat(value) + " → " + fmtStat(Math.min(3, value + 1));
}
export function seededShuffle(arr, seedInput) {
  const out = arr.slice();
  let s = (Number(seedInput) | 0) || 1;
  const rand = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
export function hashCeremonySeed(s) {
  let h = 2166136261 | 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
export function essayScoreText(score) {
  if (score === null || score === undefined || score === "") return "—";
  const n = Number(score);
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + "/10";
}
export function essayLetter(score) {
  const n = Number(score);
  return Number.isFinite(n) ? letterGradeForScore(n * 10) : "—";
}
export function clipEssayText(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trim() + "…";
}

// ── pack pricing labels (take product + solana config as inputs) ───
export function packCountLabel(count) {
  const n = Number.isFinite(Number(count)) && Number(count) > 0 ? Math.floor(Number(count)) : 1;
  return formatWholeNumber(n) + " Pack" + (n === 1 ? "" : "s");
}
export function cardPackTokenSymbol(product, solana) {
  return String((product && product.tokenSymbol) || (solana && solana.symbol) || "RUBY").trim() || "RUBY";
}
export function cardPackDebitLabel(product, solana) {
  const amount = product && product.tokenAmount != null ? product.tokenAmount : solana && solana.tokenAmount;
  return "-" + formatTokenDisplayAmount(amount) + " " + cardPackTokenSymbol(product, solana);
}
export function cardPackCreditLabel(product) {
  const count = product && Number.isFinite(Number(product.packCount)) ? Number(product.packCount) : 1;
  return "+" + packCountLabel(count) + " NFT";
}
export function cardPackPaymentDeltaLabel(product, solana) {
  return cardPackDebitLabel(product, solana) + " · " + cardPackCreditLabel(product);
}
export function cardPackProductMeta(product, solana) {
  const cardCount = Math.max(1, Math.floor(Number(product && product.cardCount || HALL_PASS_CARDS_PER_PACK)));
  return cardPackPaymentDeltaLabel(product, solana) + " · " + formatWholeNumber(cardCount) + " cards";
}

// ── HTML / markdown helpers (DOM-only, no app state) ───────────────
export function escapeHtml(value) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => map[c]);
}
export function escape(s) { return escapeHtml(s); }
export function safeMarkdownHref(href) {
  const raw = String(href || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.href);
    return (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") ? raw : null;
  } catch (_e) {
    return null;
  }
}
export function sanitizeVisibleChatText(value) {
  let text = String(value == null ? "" : value);
  const tags = "pick_from_bank|pose_question|pose_opinion|clear_board|handoff_faculty";
  text = text.replace(new RegExp("<\\s*(" + tags + ")\\b[^>]*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>", "gi"), "");
  text = text.replace(new RegExp("<\\s*/?\\s*(?:" + tags + ")\\b[^>]*\\/?>", "gi"), "");
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function markdownInlineHtml(value) {
  const start = String.fromCharCode(0xe000);
  const end = String.fromCharCode(0xe001);
  const tick = String.fromCharCode(96);
  const placeholders = [];
  let text = sanitizeVisibleChatText(value);
  const stash = (html) => {
    const key = start + placeholders.length + end;
    placeholders.push(html);
    return key;
  };
  const codePattern = new RegExp(tick + "([^" + tick + "\n]+)" + tick, "g");
  text = text.replace(codePattern, (_match, code) => stash("<code>" + escapeHtml(code) + "</code>"));
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const safeHref = safeMarkdownHref(href);
    if (!safeHref) return match;
    return stash('<a href="' + escapeHtml(safeHref) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + "</a>");
  });
  let html = escapeHtml(text);
  html = html
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^\w])\*([^*\n]+)\*(?=$|[^\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\n]+)_(?=$|[^\w])/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");
  const placeholderPattern = new RegExp(start + "(\\d+)" + end, "g");
  return html.replace(placeholderPattern, (_match, index) => placeholders[Number(index)] || "");
}
export function appendMarkdownInline(parent, text) {
  const span = document.createElement("span");
  span.innerHTML = markdownInlineHtml(text);
  while (span.firstChild) parent.appendChild(span.firstChild);
}
export function renderMarkdownInto(el, source, options) {
  if (!el) return;
  const opts = options || {};
  el.classList.add("markdown");
  el.classList.toggle("markdown-inline", !!opts.inline);
  el.replaceChildren();
  const text = sanitizeVisibleChatText(source).replace(/\r\n?/g, "\n");
  if (!text) return;
  if (opts.inline) {
    appendMarkdownInline(el, text);
    return;
  }
  const lines = text.split("\n");
  const fence = String.fromCharCode(96).repeat(3);
  const startsBlock = (line) =>
    /^\s{0,3}#{1,4}\s+/.test(line) ||
    /^\s{0,3}>\s?/.test(line) ||
    /^\s{0,3}[-*+]\s+/.test(line) ||
    /^\s{0,3}\d+[.)]\s+/.test(line) ||
    line.trim().slice(0, 3) === fence;
  const appendParagraph = (chunk) => {
    const p = document.createElement("p");
    appendMarkdownInline(p, chunk);
    el.appendChild(p);
  };
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i += 1; continue; }
    if (lines[i].trim().slice(0, 3) === fence) {
      i += 1;
      const codeLines = [];
      while (i < lines.length && lines[i].trim().slice(0, 3) !== fence) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      el.appendChild(pre);
      continue;
    }
    if (/^\s{0,3}#{1,4}\s+/.test(lines[i])) {
      const raw = lines[i].replace(/^\s{0,3}/, "");
      const depth = Math.min(4, raw.match(/^#+/)[0].length);
      const heading = document.createElement("h" + depth);
      appendMarkdownInline(heading, raw.replace(/^#{1,4}\s+/, ""));
      el.appendChild(heading);
      i += 1;
      continue;
    }
    if (/^\s{0,3}>\s?/.test(lines[i])) {
      const quoteLines = [];
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i += 1;
      }
      const quote = document.createElement("blockquote");
      renderMarkdownInto(quote, quoteLines.join("\n"));
      el.appendChild(quote);
      continue;
    }
    if (/^\s{0,3}[-*+]\s+/.test(lines[i])) {
      const list = document.createElement("ul");
      while (i < lines.length && /^\s{0,3}[-*+]\s+/.test(lines[i])) {
        const li = document.createElement("li");
        appendMarkdownInline(li, lines[i].replace(/^\s{0,3}[-*+]\s+/, ""));
        list.appendChild(li);
        i += 1;
      }
      el.appendChild(list);
      continue;
    }
    if (/^\s{0,3}\d+[.)]\s+/.test(lines[i])) {
      const list = document.createElement("ol");
      while (i < lines.length && /^\s{0,3}\d+[.)]\s+/.test(lines[i])) {
        const li = document.createElement("li");
        appendMarkdownInline(li, lines[i].replace(/^\s{0,3}\d+[.)]\s+/, ""));
        list.appendChild(li);
        i += 1;
      }
      el.appendChild(list);
      continue;
    }
    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    appendParagraph(paraLines.join("\n"));
  }
}
