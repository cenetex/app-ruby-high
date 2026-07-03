import type { RoomChannelRowView, RoomChannelStudentView } from "./client-pure.js";

export interface RoomChannelFacultyView {
  id?: string;
  displayName?: string;
  accent?: string;
}

export interface RoomChannelRowsControllerDeps {
  document: Pick<Document, "createElement">;
  teacherSmallAvatarUrl(faculty: RoomChannelFacultyView): string;
  teacherInitial(faculty: RoomChannelFacultyView): string;
  buildStudentFaceChip(student: RoomChannelStudentView, className: string): HTMLElement;
  openTeacherProfile(facultyId: string): void;
  setFaculty(facultyId: string): void;
}

export interface RoomChannelRowsController {
  appendRows(parent: HTMLElement, roomViews: RoomChannelRowView[], roster: RoomChannelFacultyView[]): void;
}

export function createRoomChannelRowsController(deps: RoomChannelRowsControllerDeps): RoomChannelRowsController {
  function facultyFor(roomView: RoomChannelRowView, roster: RoomChannelFacultyView[]): RoomChannelFacultyView | null {
    return roster.find((faculty) => faculty && faculty.id === roomView.facultyId) || null;
  }

  function appendTeacherThumb(row: HTMLElement, faculty: RoomChannelFacultyView): void {
    const thumb = deps.document.createElement("span");
    thumb.className = "teacher-thumb";
    thumb.title = "Open " + (faculty.displayName || faculty.id || "teacher") + "'s card";
    thumb.style.cursor = "pointer";
    thumb.addEventListener("click", (event) => {
      event.stopPropagation();
      if (faculty.id) deps.openTeacherProfile(faculty.id);
    });
    const thumbUrl = deps.teacherSmallAvatarUrl(faculty);
    if (thumbUrl) {
      const img = deps.document.createElement("img");
      img.src = thumbUrl;
      img.alt = "";
      img.onerror = () => {
        thumb.style.background = faculty.accent || "#444";
        thumb.textContent = deps.teacherInitial(faculty);
        if (img.parentNode === thumb) thumb.removeChild(img);
      };
      thumb.appendChild(img);
    } else {
      thumb.style.background = faculty.accent || "#444";
      thumb.textContent = deps.teacherInitial(faculty);
    }
    row.appendChild(thumb);
  }

  function appendCompletionMeter(parent: HTMLElement, roomView: RoomChannelRowView): void {
    const progress = roomView.completionProgress;
    if (!progress) return;
    const meter = deps.document.createElement("span");
    meter.className = "student-year-meter room-completion-meter";
    meter.title = roomView.completionLabel;
    meter.setAttribute("aria-label", roomView.completionLabel);
    for (let i = 0; i < progress.total; i += 1) {
      const segment = deps.document.createElement("span");
      segment.className = "student-year-segment" + (i < progress.value ? " is-filled" : "");
      meter.appendChild(segment);
    }
    parent.appendChild(meter);
  }

  function appendRoomMeta(row: HTMLElement, roomView: RoomChannelRowView): void {
    const hash = deps.document.createElement("span");
    hash.className = "hash";
    hash.textContent = "#";
    row.appendChild(hash);

    const meta = deps.document.createElement("span");
    meta.className = "room-row-meta";
    const name = deps.document.createElement("span");
    name.className = "room-row-name";
    name.textContent = roomView.channelName;
    meta.appendChild(name);
    appendCompletionMeter(meta, roomView);
    row.appendChild(meta);
  }

  function appendStudentStack(row: HTMLElement, roomView: RoomChannelRowView): void {
    if (roomView.students.length === 0) return;
    const students = deps.document.createElement("span");
    students.className = "room-student-stack";
    const studentNames = roomView.students.map((student) => student.name).join(", ");
    students.title = "Students here: " + studentNames;
    students.setAttribute("aria-label", students.title);
    roomView.students.forEach((student) => {
      students.appendChild(deps.buildStudentFaceChip(student, "room-student-chip"));
    });
    row.appendChild(students);
  }

  function appendRows(parent: HTMLElement, roomViews: RoomChannelRowView[], roster: RoomChannelFacultyView[]): void {
    roomViews.forEach((roomView) => {
      const faculty = facultyFor(roomView, roster);
      const row = deps.document.createElement("button");
      row.className = "channel-row room-row" + (roomView.isActive ? " is-active" : "");
      row.dataset.faculty = roomView.facultyId;
      if (faculty) appendTeacherThumb(row, faculty);
      appendRoomMeta(row, roomView);
      appendStudentStack(row, roomView);
      row.addEventListener("click", () => {
        if (faculty) deps.setFaculty(roomView.facultyId);
      });
      parent.appendChild(row);
    });
  }

  return {
    appendRows,
  };
}
