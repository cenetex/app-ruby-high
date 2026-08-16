export interface ProfileCardStats {
  head?: unknown;
  heart?: unknown;
  hustle?: unknown;
  honor?: unknown;
}

export interface ProfileFaculty {
  id?: string;
  displayName?: string;
  accent?: string;
  bio?: string;
  subjects?: string[];
  stats?: ProfileCardStats;
  questionCount?: unknown;
}

export interface ProfileNpc {
  id?: string;
  grade?: unknown;
  currentRoom?: string;
  stats?: ProfileCardStats;
}

export interface ProfileStudent {
  name?: string;
  color?: string;
}

export interface ProfileNpcArc {
  grade?: unknown;
  graduated?: boolean;
  completedGrades?: unknown[];
  streak?: { grade?: unknown; count?: unknown };
}

export interface ProfileCharacterCardView {
  role: "teacher" | "student";
  name?: string;
  subtitle: string;
  portraitUrl?: string;
  accent?: string;
  stats?: ProfileCardStats;
  quote?: string;
  footer?: { title: string; content: string };
}

export interface ProfileCareerMetric {
  label: string;
  value: string;
  detail: string;
  met: boolean;
}

export interface ProfileCareerCardView {
  badgeLabel?: string;
  name?: string;
  subtitle: string;
  metrics: ProfileCareerMetric[];
  progression?: unknown;
}

export interface ProfileCardViewDeps {
  gradeLabels: Record<string, string>;
  streakRequired: Record<string, number>;
  teachingFacultyLabels: Record<string, string>;
}

export interface ProfileCardView {
  roomLabel(roomId: unknown): string;
  teacherProfileCard(faculty: ProfileFaculty, portraitUrl: string): ProfileCharacterCardView;
  teacherCareerCard(faculty: ProfileFaculty): ProfileCareerCardView;
  studentProfileCard(input: {
    npc: ProfileNpc;
    student: ProfileStudent;
    arc?: ProfileNpcArc | null;
    portraitUrl: string;
  }): ProfileCharacterCardView;
  studentCareerCard(input: {
    npc: ProfileNpc;
    arc?: ProfileNpcArc | null;
    currentGrade?: unknown;
  }): ProfileCareerCardView;
}

export function createProfileCardView(deps: ProfileCardViewDeps): ProfileCardView {
  const teacherStats: Record<string, ProfileCardStats> = {
    ruby: { head: 1, heart: 2, hustle: 1, honor: 0 },
    "sally-science": { head: 3, heart: 0, hustle: 1, honor: 1 },
    "professor-edward": { head: 3, heart: 1, hustle: -1, honor: 2 },
  };
  const teacherSubjectLine: Record<string, string> = {
    ruby: "Homeroom · school stories and general knowledge",
    "sally-science": "Science Lab · physics, chemistry, biology, and Earth science",
    "professor-edward": "Library · postwar literature and literary theory",
  };
  const teacherSignature: Record<string, string> = {
    ruby: "My job's the door. The teaching happens in the rooms.",
    "sally-science": "I'd rather you be wrong with reasons than right by accident.",
    "professor-edward": "Every wrong answer has a half-truth folded inside it. We start there.",
  };
  const studentVibes: Record<string, string> = {
    lyra: "wait what — i KNEW it was c. ok im rewriting my notes.",
    sami: "respectfully, ouch. couldve been you.",
    ravi: "OK so technically — wait, sorry, am i shouting again",
    indra: "the answer was always c.",
    mika: "you cooked. for real.",
    noor: "the test designer is in this room and is laughing.",
  };

  function stringKey(value: unknown): string {
    return value == null ? "" : String(value);
  }

  function gradeLabel(grade: unknown): string {
    const key = stringKey(grade);
    return deps.gradeLabels[key] || "Grade " + key;
  }

  function teacherSubject(faculty: ProfileFaculty): string {
    const id = faculty.id || "";
    return teacherSubjectLine[id]
      || (Array.isArray(faculty.subjects) ? faculty.subjects.join(", ") : faculty.bio)
      || "";
  }

  function teacherStatsFor(faculty: ProfileFaculty): ProfileCardStats {
    if (faculty && faculty.stats) return faculty.stats;
    return teacherStats[faculty.id || ""] || { head: 2, heart: 1, hustle: 1, honor: 1 };
  }

  function roomLabel(roomId: unknown): string {
    const id = stringKey(roomId);
    return ({
      homeroom: "homeroom",
      science: "science",
      literature: "literature",
      lounge: "lounge",
    } as Record<string, string>)[id] || id || "class";
  }

  function completedProgression(): unknown {
    return {
      graduated: true,
      rungs: ["9", "10", "11", "12"].map((grade) => ({
        grade,
        label: deps.gradeLabels[grade],
        streakReq: deps.streakRequired[grade] || 1,
        state: "completed",
      })),
    };
  }

  function progressionForNpcArc(arc: ProfileNpcArc | null | undefined, fallbackGrade: unknown): unknown {
    if (arc && arc.graduated) return completedProgression();
    const completed = new Set(arc && Array.isArray(arc.completedGrades) ? arc.completedGrades.map(stringKey) : []);
    const currentGrade = stringKey((arc && arc.grade) || fallbackGrade || "9");
    const streakHere = arc && arc.streak && stringKey(arc.streak.grade) === currentGrade
      ? Math.max(0, Number(arc.streak.count || 0))
      : 0;
    const rungs = ["9", "10", "11", "12"].map((grade) => {
      const streakReq = deps.streakRequired[grade] || 1;
      let state = "future";
      let streakProgress;
      if (completed.has(grade)) {
        state = "completed";
      } else if (grade === currentGrade) {
        state = "current";
        streakProgress = { have: streakHere, need: streakReq };
      }
      return { grade, label: deps.gradeLabels[grade], streakReq, state, streakProgress };
    });
    return { rungs, graduated: false };
  }

  return {
    roomLabel,
    teacherProfileCard(faculty, portraitUrl): ProfileCharacterCardView {
      const subjectLine = teacherSubject(faculty);
      return {
        role: "teacher",
        name: faculty.displayName,
        subtitle: subjectLine,
        portraitUrl,
        accent: faculty.accent,
        stats: teacherStatsFor(faculty),
        quote: teacherSignature[faculty.id || ""] || faculty.bio,
        footer: { title: "Teaches", content: subjectLine },
      };
    },
    teacherCareerCard(faculty): ProfileCareerCardView {
      const subjectLine = teacherSubject(faculty);
      const facultyId = faculty.id || "";
      return {
        badgeLabel: "teacher",
        name: "Teacher Card",
        subtitle: subjectLine,
        metrics: [
          { label: "role", value: "Teacher", detail: "teacher", met: true },
          { label: "subject", value: deps.teachingFacultyLabels[facultyId] || "Teacher", detail: "classroom", met: true },
          { label: "questions", value: String(faculty.questionCount || 0), detail: "available", met: false },
        ],
      };
    },
    studentProfileCard(input): ProfileCharacterCardView {
      const { npc, student, arc } = input;
      const arcLine = !arc
        ? (deps.gradeLabels[stringKey(npc.grade)] || stringKey(npc.grade))
        : arc.graduated
          ? "Graduated · " + ((arc.completedGrades && arc.completedGrades.length) || 0) + " years"
          : (deps.gradeLabels[stringKey(arc.grade)] || stringKey(arc.grade)) + " · "
            + Math.max(0, Number((arc.streak && arc.streak.count) || 0)) + " daily classes";
      return {
        role: "student",
        name: student.name,
        subtitle: arcLine + (npc.currentRoom ? " · #" + roomLabel(npc.currentRoom) : ""),
        portraitUrl: input.portraitUrl,
        accent: student.color,
        stats: npc.stats,
        quote: studentVibes[npc.id || ""] || "—",
      };
    },
    studentCareerCard(input): ProfileCareerCardView {
      const { npc, arc } = input;
      const grade = stringKey((arc && arc.grade) || npc.grade || input.currentGrade || "9");
      const label = gradeLabel(grade);
      const graduated = !!(arc && arc.graduated);
      const streakReq = deps.streakRequired[grade] || 1;
      const streakHere = arc && arc.streak && stringKey(arc.streak.grade) === grade
        ? Math.max(0, Number(arc.streak.count || 0))
        : 0;
      return {
        badgeLabel: graduated ? "graduated" : label,
        subtitle: graduated ? "Graduated · classmate" : label + " · classmate",
        metrics: graduated
          ? [
              { label: "status", value: "graduated", detail: "all four years complete", met: true },
              { label: "yearbook", value: ((arc && arc.completedGrades && arc.completedGrades.length) || 4) + "/4", detail: "years saved", met: true },
              { label: "room", value: roomLabel(npc.currentRoom), detail: "last seen", met: false },
            ]
          : [
              { label: "year", value: label, detail: "active grade", met: false },
              { label: "daily", value: streakHere + "/" + streakReq, detail: "classes passed", met: streakHere >= streakReq },
              { label: "room", value: roomLabel(npc.currentRoom), detail: "current room", met: false },
            ],
        progression: progressionForNpcArc(arc, grade),
      };
    },
  };
}
