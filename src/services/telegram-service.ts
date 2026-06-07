import type { IAgentRuntime } from "../runtime.js";
import { Service } from "../runtime.js";
import { log } from "./logger.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
}

const TG_FETCH_TIMEOUT_MS = 15_000;

export class TelegramService extends Service {
  static override readonly serviceType = "telegram";

  private config: TelegramConfig = {
    botToken: process.env.RUBY_HIGH_TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.RUBY_HIGH_TELEGRAM_CHAT_ID ?? "",
    enabled: false,
  };

  constructor(runtime?: IAgentRuntime | null) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime): Promise<TelegramService> {
    const svc = new TelegramService(runtime);
    if (svc.config.botToken && svc.config.chatId) {
      svc.config.enabled = true;
      log.event("telegram.started", { chatId: svc.config.chatId });
    }
    return svc;
  }

  getConfig(): { chatId: string; enabled: boolean; hasToken: boolean } {
    const { botToken, ...rest } = this.config;
    return { ...rest, hasToken: !!botToken };
  }

  updateConfig(botToken: string, chatId: string): void {
    this.config.botToken = botToken;
    this.config.chatId = chatId;
    this.config.enabled = !!(botToken && chatId);
    log.event("telegram.config-updated", { enabled: this.config.enabled });
  }

  isEnabled(): boolean {
    return this.config.enabled && !!this.config.botToken && !!this.config.chatId;
  }

  async sendMessage(text: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TG_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        log.error("telegram.send-failed", new Error(err), { status: res.status });
        return false;
      }
      log.event("telegram.message-sent", { text: text.slice(0, 100) });
      return true;
    } catch (err) {
      log.error("telegram.send-failed", err, {});
      return false;
    }
  }

  async sendPhoto(imageUrl: string, caption?: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/sendPhoto`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          photo: imageUrl,
          ...(caption ? { caption, parse_mode: "HTML" } : {}),
        }),
        signal: AbortSignal.timeout(TG_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        log.error("telegram.send-photo-failed", new Error(err), { status: res.status });
        return false;
      }
      log.event("telegram.photo-sent", { imageUrl: imageUrl.slice(0, 100) });
      return true;
    } catch (err) {
      log.error("telegram.send-photo-failed", err, {});
      return false;
    }
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async postSchoolSnapshot(): Promise<void> {
    if (!this.isEnabled() || !this.runtime) return;
    const rubySvc = (this.runtime as any).getService?.("ruby-high") as { getSchoolSnapshot?: () => any } | null;
    const snapshot = rubySvc?.getSchoolSnapshot?.() ?? null;
    if (!snapshot) return;

    const lines: string[] = ["<b>🏫 Ruby High — Daily Report</b>", ""];
    
    // Top students by year
    for (const [grade, students] of Object.entries(snapshot.topByYear) as [string, any[]][]) {
      if (!students.length) continue;
      const gradeLabel = { "9": "Freshman", "10": "Sophomore", "11": "Junior", "12": "Senior" }[grade] ?? grade;
      lines.push(`<b>${gradeLabel}:</b>`);
      for (const s of students.slice(0, 3)) {
        const grades = Object.entries(s.classGrades || {} as Record<string,string>).map(([f,g]) => `${f}:${g}`).join(" ");
        lines.push(`  ${this.escHtml(s.name)} · ${this.escHtml(s.playbookId)} ${grades ? "· " + grades : ""}`);
      }
      lines.push("");
    }

    // Daily memories
    const mem = snapshot.dailyMemories;
    if (mem?.charactersCreated?.length) {
      lines.push(`🆕 <b>New students:</b> ${mem.charactersCreated.slice(0, 5).map((n: unknown) => this.escHtml(String(n))).join(", ")}`);
    }
    if (mem?.classesPassed?.length) {
      const unique = [...new Set(mem.classesPassed.map((c: any) => c.studentName))];
      lines.push(`✅ <b>Classes passed:</b> ${unique.slice(0, 5).map((n: unknown) => this.escHtml(String(n))).join(", ")}`);
    }
    if (mem?.gradesAdvanced?.length) {
      const adv = mem.gradesAdvanced.map((g: any) => `${g.studentName} → ${g.toGrade}`).slice(0, 3);
      lines.push(`⬆️ <b>Grade advancements:</b> ${adv.map((s: unknown) => this.escHtml(String(s))).join(", ")}`);
    }
    if (mem?.graduations?.length) {
      lines.push(`🎓 <b>Graduations:</b> ${mem.graduations.map((n: unknown) => this.escHtml(String(n))).join(", ")}`);
    }
    lines.push("");
    lines.push(`📊 ${mem?.totalStudents ?? 0} students · ${mem?.totalQuestionsAnswered ?? 0} questions answered`);
    lines.push(`<a href="https://ruby-high.ai">ruby-high.ai</a>`);

    await this.sendMessage(lines.join("\n"));
  }
}
