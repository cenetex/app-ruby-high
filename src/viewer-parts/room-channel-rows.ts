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

  function buildTeacherProfileButton(faculty: RoomChannelFacultyView): HTMLButtonElement {
    const button = deps.document.createElement("button") as HTMLButtonElement;
    const teacherName = faculty.displayName || faculty.id || "teacher";
    button.type = "button";
    button.className = "teacher-profile-button";
    button.title = "Open " + teacherName + "'s card";
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", () => {
      if (faculty.id) deps.openTeacherProfile(faculty.id);
    });

    const thumb = deps.document.createElement("span");
    thumb.className = "teacher-thumb";
    thumb.setAttribute("aria-hidden", "true");
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
    button.appendChild(thumb);
    return button;
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
      const group = deps.document.createElement("div");
      group.className = "channel-row room-row-group" + (roomView.isActive ? " is-active" : "");
      group.dataset.faculty = roomView.facultyId;
      if (faculty) group.appendChild(buildTeacherProfileButton(faculty));

      const roomButton = deps.document.createElement("button") as HTMLButtonElement;
      roomButton.type = "button";
      roomButton.className = "room-row-button";
      roomButton.setAttribute("aria-label", "Open " + roomView.channelName + " classroom");
      appendRoomMeta(roomButton, roomView);
      roomButton.addEventListener("click", () => {
        if (faculty) deps.setFaculty(roomView.facultyId);
      });
      group.appendChild(roomButton);
      appendStudentStack(group, roomView);
      parent.appendChild(group);
    });
  }

  return {
    appendRows,
  };
}
