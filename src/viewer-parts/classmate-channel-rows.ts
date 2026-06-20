import type { ClassmateArcProgress } from "./client-pure.js";

export interface ClassmateSocialMarkView {
  className: string;
  title: string;
  text: string;
}

export interface ClassmateChannelRowView {
  npc: unknown;
  student: unknown;
  studentId: string;
  name: string;
  color: string;
  gradeTitle: string;
  ariaLabel: string;
  subtitle: string;
  progress: ClassmateArcProgress | null;
  progressLabel: string;
  social: ClassmateSocialMarkView | null;
}

export interface ClassmateChannelGroupView {
  key: string;
  label: string;
  rows: ClassmateChannelRowView[];
}

export interface ClassmateChannelRowsRendererDeps {
  document: Pick<Document, "createElement">;
  faceUrl(studentId: string): string;
  openStudentProfile(npc: unknown, student: unknown): void;
}

export interface ClassmateChannelRowsRenderer {
  appendSection(parent: HTMLElement, groups: ClassmateChannelGroupView[]): void;
}

export function createClassmateChannelRowsRenderer(
  deps: ClassmateChannelRowsRendererDeps,
): ClassmateChannelRowsRenderer {
  function appendTitle(parent: HTMLElement): void {
    const title = deps.document.createElement("div");
    title.className = "channel-section-title";
    title.textContent = "Students";
    parent.appendChild(title);
  }

  function appendMeter(parent: HTMLElement, rowView: ClassmateChannelRowView): void {
    const progress = rowView.progress;
    if (!progress) return;
    const meter = deps.document.createElement("span");
    meter.className = "student-year-meter";
    meter.title = rowView.progressLabel;
    meter.setAttribute("aria-label", rowView.progressLabel);
    for (let i = 0; i < progress.total; i += 1) {
      const segment = deps.document.createElement("span");
      segment.className = "student-year-segment" + (i < progress.value ? " is-filled" : "");
      meter.appendChild(segment);
    }
    parent.appendChild(meter);
  }

  function appendThumb(parent: HTMLElement, rowView: ClassmateChannelRowView): void {
    const thumb = deps.document.createElement("span");
    thumb.className = "teacher-thumb student-thumb";
    thumb.style.setProperty("--student-accent", rowView.color);
    thumb.style.background = "#222";
    const img = deps.document.createElement("img");
    img.src = deps.faceUrl(rowView.studentId);
    img.alt = "";
    img.onerror = () => {
      thumb.style.background = rowView.color;
      if (img.parentNode === thumb) thumb.removeChild(img);
    };
    thumb.appendChild(img);
    parent.appendChild(thumb);
  }

  function appendMeta(parent: HTMLElement, rowView: ClassmateChannelRowView): void {
    const meta = deps.document.createElement("span");
    meta.className = "student-row-meta";
    const name = deps.document.createElement("span");
    name.className = "student-row-name";
    name.textContent = rowView.name;
    meta.appendChild(name);
    const detail = deps.document.createElement("span");
    detail.className = "student-row-detail";
    if (rowView.subtitle) {
      const sub = deps.document.createElement("span");
      sub.className = "student-row-subtitle";
      sub.textContent = rowView.subtitle;
      detail.appendChild(sub);
    }
    appendMeter(detail, rowView);
    if (detail.children.length > 0) meta.appendChild(detail);
    parent.appendChild(meta);
  }

  function appendSocial(parent: HTMLElement, rowView: ClassmateChannelRowView): void {
    const social = rowView.social;
    if (!social) return;
    const mark = deps.document.createElement("span");
    mark.className = social.className;
    mark.title = social.title;
    mark.setAttribute("aria-label", social.title);
    mark.textContent = social.text;
    parent.appendChild(mark);
  }

  function appendRow(parent: HTMLElement, rowView: ClassmateChannelRowView): void {
    const row = deps.document.createElement("button");
    row.className = "channel-row student-row";
    row.type = "button";
    row.setAttribute("aria-label", rowView.ariaLabel);
    appendThumb(row, rowView);
    appendMeta(row, rowView);
    appendSocial(row, rowView);
    row.addEventListener("click", () => deps.openStudentProfile(rowView.npc, rowView.student));
    parent.appendChild(row);
  }

  function appendGroup(parent: HTMLElement, groupView: ClassmateChannelGroupView): void {
    const group = deps.document.createElement("div");
    group.className = "student-cohort-group";
    const header = deps.document.createElement("div");
    header.className = "student-cohort-header";
    const headerLabel = deps.document.createElement("span");
    headerLabel.textContent = groupView.label;
    const count = deps.document.createElement("span");
    count.className = "student-cohort-count";
    count.textContent = String(groupView.rows.length);
    header.appendChild(headerLabel);
    header.appendChild(count);
    group.appendChild(header);
    groupView.rows.forEach((rowView) => appendRow(group, rowView));
    parent.appendChild(group);
  }

  return {
    appendSection(parent: HTMLElement, groups: ClassmateChannelGroupView[]): void {
      appendTitle(parent);
      groups.forEach((group) => appendGroup(parent, group));
    },
  };
}
