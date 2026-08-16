import { PLAYBOOKS } from "../characters/playbooks.js";
import { studentById } from "../characters/students.js";
import { teacherById } from "../characters/teachers.js";
import { DEFAULT_STUDENT_MODEL } from "../model-defaults.js";
import type { CharacterStats } from "../types.js";
import { publicBaseUrl } from "./generated-portrait-assets.js";
export { maybeUploadPortrait } from "./generated-portrait-assets.js";
import { log } from "./logger.js";
import {
  openRouterJson,
} from "./openrouter-client.js";
import {
  rubyHighPhotoSceneForGrade,
  rubyHighPhotoSceneForSchoolUpdate,
  type RubyHighPhotoScene,
} from "./school-photo-scenes.js";
import type { ScheduledSchoolUpdateContext } from "./ruby-high/post-types.js";
import {
  fetchLlmChatCompletions,
  resolveStudentModel,
  throwLlmResponseError,
} from "./llm-provider.js";

const PORTRAIT_MODEL = process.env.RUBY_HIGH_PORTRAIT_MODEL ?? "google/gemini-3.1-flash-image-preview";
const PORTRAIT_MAX_TOKENS = Number(process.env.RUBY_HIGH_PORTRAIT_MAX_TOKENS ?? 4000);
const PORTRAIT_TIMEOUT_MS = 60_000;
const CHARACTER_ROLL_TIMEOUT_MS = Math.max(
  3_000,
  Number(process.env.RUBY_HIGH_CHARACTER_ROLL_TIMEOUT_MS ?? 8_000) || 8_000,
);
const PHOTO_DIRECTION_MODEL = process.env.RUBY_HIGH_PHOTO_DIRECTION_MODEL?.trim() || DEFAULT_STUDENT_MODEL;
const PHOTO_DIRECTION_MAX_TOKENS = Math.max(80, Number(process.env.RUBY_HIGH_PHOTO_DIRECTION_MAX_TOKENS ?? 180) || 180);
const PHOTO_DIRECTION_TIMEOUT_MS = Math.max(5_000, Number(process.env.RUBY_HIGH_PHOTO_DIRECTION_TIMEOUT_MS ?? 20_000) || 20_000);

interface PortraitResponse {
  choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
}

interface CharacterResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

type CharacterTextComponent = "name" | "personality" | "arcAnswer" | "flavorQuote";

function imageReferenceUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:image/")) return url;
  return new URL(url, publicBaseUrl() + "/").toString();
}

function assertNewGeneratedImage(
  imageUrl: string,
  referenceUrls: string[],
  label: string,
): void {
  const normalizedReferences = new Set(referenceUrls.flatMap((referenceUrl) => [
    referenceUrl,
    imageReferenceUrl(referenceUrl),
  ]));
  if (normalizedReferences.has(imageUrl)) {
    throw new Error(`${label} returned an unchanged reference image.`);
  }
}

function characterResponseFormat(fields: CharacterTextComponent[]) {
  const descriptions: Record<CharacterTextComponent, string> = {
    name: "One first name for the student.",
    personality: "Two to three third-person sentences about how the student shows up in class.",
    arcAnswer: "One to two in-voice sentences answering the playbook hook question.",
    flavorQuote: "One short line of character flavor text, without surrounding quote marks.",
  };
  return {
    type: "json_schema",
    json_schema: {
      name: "ruby_high_student_roll",
      strict: true,
      schema: {
        type: "object",
        properties: Object.fromEntries(fields.map((field) => [
          field,
          { type: "string", description: descriptions[field] },
        ])),
        required: fields,
        additionalProperties: false,
      },
    },
  };
}

async function fetchPortraitOnce(args: {
  apiKey: string;
  prompt: string;
}): Promise<string> {
  const body = await openRouterJson<PortraitResponse>({
    apiKey: args.apiKey,
    label: "portrait",
    timeoutMs: PORTRAIT_TIMEOUT_MS,
    body: {
      model: PORTRAIT_MODEL,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: args.prompt }],
      max_tokens: PORTRAIT_MAX_TOKENS,
    },
  });
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("OpenRouter returned no image (likely a content-filter trip; try a different name/personality).");
  return url;
}

export async function renderCharacterPortrait(args: {
  apiKey: string;
  name: string;
  personality: string;
}): Promise<string> {
  const prompt = [
    `JRPG dialog-portrait of ${args.name}, a high schooler at Ruby High.`,
    `Personality: ${args.personality}`,
    "",
    "STYLE: JRPG-style FULL BODY standing portrait — 3/4 view, head to ankles. Tall portrait orientation. Anime-influenced. Bold black outline 5px. Vibrant flat colors, subtle cel shading. Dynamic relaxed pose, expressive face that fits the personality.",
    "",
    "OUTPUT FORMAT: a single PNG portrait with a SOLID FLAT pale lavender background (#ece6f5). The background fills the entire frame as one perfectly even color — no gradient, no texture, no pattern, no scenery, no objects, no border, no transparency. The character is centered on top of the solid background, with bold black 5px outline around the character separating figure from background.",
    "No text, no logo, no signature, no caption.",
  ].join("\n");
  try {
    return await fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  } catch (err) {
    log.event("portrait.first-attempt-failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  }
}

export async function renderTeacherPortrait(args: {
  apiKey: string;
  name: string;
  personality: string;
}): Promise<string> {
  const prompt = [
    `JRPG faculty portrait of ${args.name}, a teacher at Ruby High.`,
    `Teaching style: ${args.personality}`,
    "",
    "STYLE: JRPG-style FULL BODY standing faculty portrait — 3/4 view, head to ankles. Tall portrait orientation. Anime-influenced. Bold black outline 5px. Vibrant flat colors, subtle cel shading. Confident classroom pose, expressive face, age-appropriate adult teacher.",
    "",
    "OUTPUT FORMAT: a single PNG portrait with a SOLID FLAT pale lavender background (#ece6f5). The background fills the entire frame as one perfectly even color — no gradient, no texture, no pattern, no scenery, no objects, no border, no transparency. The character is centered on top of the solid background, with bold black 5px outline around the character separating figure from background.",
    "No text, no logo, no signature, no caption.",
  ].join("\n");
  try {
    return await fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  } catch (err) {
    log.event("teacher-portrait.first-attempt-failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  }
}

export async function renderDiplomaImage(args: {
  apiKey: string;
  name: string;
  personality: string;
  bestSubjectFacultyId: string;
}): Promise<string> {
  const accessory = (() => {
    switch (args.bestSubjectFacultyId) {
      case "sally-science": return "holding a beaker that glows faintly green";
      case "professor-edward": return "holding a thick hardcover book against their chest";
      case "ruby":
      default: return "holding a rolled diploma scroll tied with a red ribbon";
    }
  })();
  const prompt = [
    `JRPG dialog-portrait of ${args.name} at their Ruby High graduation.`,
    `Personality: ${args.personality}`,
    "",
    `STYLE: JRPG-style FULL BODY standing portrait — 3/4 view, head to ankles. Tall portrait orientation. Anime-influenced. Bold black outline 5px. Vibrant flat colors, subtle cel shading. The character is wearing a high-school graduation cap and gown over their normal clothes — gown is a warm crimson red, cap is matching with a yellow tassel. They are smiling, proud but a little nervous. ${accessory}.`,
    "",
    "OUTPUT FORMAT: a single PNG portrait with a SOLID FLAT pale gold background (#f5e8c2). The background fills the entire frame as one perfectly even color — no gradient, no texture, no pattern, no scenery, no objects, no border, no transparency. The character is centered on top of the solid background, with bold black 5px outline around the character separating figure from background.",
    "No text, no logo, no signature, no caption.",
  ].join("\n");
  try {
    return await fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  } catch (err) {
    log.event("diploma.first-attempt-failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return fetchPortraitOnce({ apiKey: args.apiKey, prompt });
  }
}

export async function renderClassPhoto(args: {
  apiKey: string;
  studentImages: Array<{ name: string; imageUrl: string }>;
}): Promise<string> {
  const { apiKey, studentImages } = args;
  if (studentImages.length === 0) throw new Error("No student images provided.");
  // Build a content array with all student images + prompt.
  const contentParts: Array<Record<string, unknown>> = [];
  studentImages.forEach((s, index) => {
    contentParts.push({
      type: "text",
      text: `REFERENCE IMAGE ${index + 1}: ${s.name}. Use this exact student identity in the group photo.`,
    });
    contentParts.push({
      type: "image_url",
      image_url: { url: imageReferenceUrl(s.imageUrl) },
    });
  });
  const nameList = studentImages.map((s) => s.name).join(", ");
  contentParts.push({
    type: "text",
    text: [
      `Arrange these ${studentImages.length} students (${nameList}) into a CLASS PHOTO.`,
      "IDENTITY LOCK: Each reference image is a canonical character sheet. Preserve each student's hair shape and color, outfit, silhouette, face, skin tone, proportions, and art style. Adapt pose only. Do not substitute generic students.",
      "STYLE: JRPG-style group photo — a single wide horizontal image. Students stand together in 1-2 rows against a SOLID FLAT pale lavender background (#ece6f5). Each student keeps their original appearance, outfit, and art style. 5px bold black outlines. Vibrant flat colors. Everyone visible, no one cut off. Natural group arrangement — some in front, some behind, like a real class photo.",
      "OUTPUT: a single wide image containing all students together. Solid pale lavender background. No text, no names, no labels.",
    ].join("\n"),
  });

  const body = await openRouterJson<PortraitResponse>({
    apiKey,
    label: "class-photo",
    timeoutMs: PORTRAIT_TIMEOUT_MS * 2, // composite takes longer
    body: {
      model: PORTRAIT_MODEL,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: contentParts }],
      max_tokens: PORTRAIT_MAX_TOKENS,
    },
  });
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("Class photo generation returned no image.");
  return url;
}

export async function renderGraduationPhoto(args: {
  apiKey: string;
  gradeLabel: string;
  player: {
    name: string;
    imageUrl: string;
    personality?: string;
    playbookName?: string;
    flavorQuote?: string;
    arcAnswer?: string;
  };
  teacher: { id?: string; name: string; imageUrl: string };
  classmate: { id?: string; name: string; imageUrl: string };
}): Promise<string> {
  const scene = rubyHighPhotoSceneForGrade(args.gradeLabel, [
    args.gradeLabel,
    args.player.name,
    args.teacher.name,
    args.classmate.name,
  ].join(":"));
  const participants: PhotoParticipant[] = [
    { role: "student", ...args.player },
    { role: "teacher", ...args.teacher },
    { role: "classmate", ...args.classmate },
  ];
  const direction = await graduationPhotoDirectionPlan({
    apiKey: args.apiKey,
    gradeLabel: args.gradeLabel,
    scene,
    participants,
  });
  const referenceLabels = [
    `${args.player.name} - graduating student`,
    `${args.teacher.name} - teacher`,
    `${args.classmate.name} - classmate`,
  ];
  const contentParts: Array<Record<string, unknown>> = [];
  [
    { label: referenceLabels[0]!, url: args.player.imageUrl },
    { label: referenceLabels[1]!, url: args.teacher.imageUrl },
    { label: referenceLabels[2]!, url: args.classmate.imageUrl },
  ].forEach((ref, index) => {
    contentParts.push({
      type: "text",
      text: `REFERENCE IMAGE ${index + 1}: ${ref.label}. Use this exact character identity for that person.`,
    });
    contentParts.push({ type: "image_url", image_url: { url: imageReferenceUrl(ref.url) } });
  });
  contentParts.push({
    type: "text",
    text: [
      `Create a dynamic Ruby High ${args.gradeLabel} graduation photo with exactly these three people: ${referenceLabels.join(", ")}.`,
      "IDENTITY LOCK: Each reference image is a canonical character sheet. Preserve each person's hair shape and color, outfit, silhouette, face, skin tone, proportions, role, and art style. Adapt pose and expression only. Do not substitute generic anime students or redesign the cast.",
      "",
      `LOCATION: ${scene.roomName}. ${scene.setting}.`,
      `PHOTO DIRECTION: ${direction?.plan ?? scene.action}`,
      direction
        ? `INDIVIDUAL INTENTIONS: ${direction.proposals.map((proposal) => `${proposal.name}: ${proposal.action}`).join(" ")}`
        : `POSE DIRECTION: ${scene.action}`,
      `CAMERA: ${scene.camera}.`,
      `ROOM DETAILS: ${scene.props}.`,
      "COMPOSITION: wide horizontal yearbook photo, 16:9. Stage the trio at different depths and angles, interacting with the room and each other. Use diagonal movement and distinct silhouettes. Everyone is visible from head to at least knees, faces clear, no one cut off.",
      "AVOID: formal photo-day backdrop, centered lineup, stiff front-facing pose, plain homeroom, chalkboard-centered classroom setup, everyone standing still with arms at their sides, character redesigns, outfit swaps, age changes, extra people, missing cast members.",
      "No text, no logos, no captions, no watermarks.",
      "STYLE: JRPG/anime-influenced school portrait, bold black outlines, vibrant flat colors, subtle cel shading, polished yearbook keepsake.",
    ].join("\n"),
  });

  const body = await openRouterJson<PortraitResponse>({
    apiKey: args.apiKey,
    label: "graduation-photo",
    timeoutMs: PORTRAIT_TIMEOUT_MS * 2,
    body: {
      model: PORTRAIT_MODEL,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: contentParts }],
      max_tokens: PORTRAIT_MAX_TOKENS,
    },
  });
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("Graduation photo generation returned no image.");
  return url;
}

export interface SchoolUpdatePhotoParticipant {
  role: "teacher" | "student";
  id: string;
  name: string;
  imageUrl: string;
}

/** Compose a dynamic, identity-locked campus photo for a scheduled school
 *  update. It mirrors the graduation-photo framing without implying that a
 *  graduation happened or exposing any player-created identity. */
export async function renderScheduledSchoolUpdatePhoto(args: {
  apiKey: string;
  postText: string;
  context: ScheduledSchoolUpdateContext;
  participants: SchoolUpdatePhotoParticipant[];
}): Promise<string> {
  if (args.participants.length < 2 || args.participants.length > 4) {
    throw new Error("Scheduled school update photos require two to four participants.");
  }
  const loungeActive = args.context.activeRooms.some((room) => room.area === "teacher-lounge");
  const area = loungeActive ? "teacher-lounge" : "classroom";
  const grade = args.context.activeRooms.find((room) => room.area === "classroom")?.grade ?? null;
  const scene = rubyHighPhotoSceneForSchoolUpdate(
    area,
    grade,
    `${args.context.date}:${args.participants.map((participant) => participant.id).join(":")}`,
  );
  const contentParts: Array<Record<string, unknown>> = [];
  args.participants.forEach((participant, index) => {
    contentParts.push({
      type: "text",
      text: `REFERENCE IMAGE ${index + 1}: ${participant.name} - ${participant.role}. Use this exact character identity for that person.`,
    });
    contentParts.push({
      type: "image_url",
      image_url: { url: imageReferenceUrl(participant.imageUrl) },
    });
  });
  const activityFacts = scheduledSchoolUpdatePhotoFacts(args.context);
  const graduationMoment = args.context.highlights.graduations > 0;
  contentParts.push({
    type: "text",
    text: [
      `Create a dynamic Ruby High school-life photo with exactly these ${args.participants.length} people: ${args.participants.map((participant) => `${participant.name} (${participant.role})`).join(", ")}.`,
      "IDENTITY LOCK: Each reference image is a canonical character sheet. Preserve each person's hair shape and color, outfit, silhouette, face, skin tone, proportions, role, and art style. Adapt pose and expression only. Do not redesign the cast or add extra people.",
      "",
      `LOCATION: ${scene.roomName}. ${scene.setting}.`,
      `RECENT SCHOOL MOMENT: ${activityFacts.join(" ")}`,
      `STORY BEAT: ${args.postText}`,
      `PHOTO DIRECTION: ${scene.action}`,
      `CAMERA: ${scene.camera}.`,
      `ROOM DETAILS: ${scene.props}.`,
      "COMPOSITION: wide horizontal editorial school photo, 16:9. Stage the cast at different depths and angles, interacting with the room and each other. Use diagonal movement, expressive hands, and distinct silhouettes. Everyone is visible from head to at least knees, faces clear, no one cut off.",
      graduationMoment
        ? "A recent graduation may be suggested with one subtle keepsake, but keep the scene candid and grounded."
        : "This is an ordinary school-day moment, not a graduation ceremony: no caps, gowns, diplomas, confetti, or formal lineup.",
      "AVOID: formal photo-day backdrop, centered lineup, stiff front-facing poses, plain empty room, chalkboard-centered composition, character redesigns, outfit swaps, age changes, extra people, missing cast members, dashboards, charts, or visible statistics.",
      "No text, no logos, no captions, no speech bubbles, no readable notes, no watermarks.",
      "STYLE: JRPG/anime-influenced school editorial, bold black outlines, vibrant flat colors, subtle cel shading, polished yearbook-quality finish.",
    ].join("\n"),
  });

  const body = await openRouterJson<PortraitResponse>({
    apiKey: args.apiKey,
    label: "scheduled-school-update-photo",
    timeoutMs: PORTRAIT_TIMEOUT_MS * 2,
    body: {
      model: PORTRAIT_MODEL,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: contentParts }],
      max_tokens: PORTRAIT_MAX_TOKENS,
    },
  });
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("Scheduled school update photo generation returned no image.");
  assertNewGeneratedImage(
    url,
    args.participants.map((participant) => participant.imageUrl),
    "Scheduled school update photo generation",
  );
  return url;
}

/** Compose the media for a passed-class post from the exact student and
 *  teacher references. Unlike a portrait milestone, this is an event photo:
 *  the completed class is visible in the environment and the two people are
 *  interacting in the immediate aftermath of the result. */
export async function renderClassPassedPhoto(args: {
  apiKey: string;
  student: { name: string; imageUrl: string };
  teacher: { name: string; imageUrl: string };
  className: string;
  subjects: string[];
  grade?: string;
  letterGrade?: string;
}): Promise<string> {
  const className = args.className.trim();
  if (!className) throw new Error("Passed-class photos require a class name.");
  const subjects = args.subjects.map((subject) => subject.trim()).filter(Boolean);
  const scene = rubyHighPhotoSceneForGrade(
    args.grade,
    ["class-passed", args.student.name, args.teacher.name, className, ...subjects].join(":"),
  );
  const contentParts: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `REFERENCE IMAGE 1: ${args.student.name} - the student who passed. Use this exact character identity.`,
    },
    {
      type: "image_url",
      image_url: { url: imageReferenceUrl(args.student.imageUrl) },
    },
    {
      type: "text",
      text: `REFERENCE IMAGE 2: ${args.teacher.name} - the teacher of ${className}. Use this exact character identity.`,
    },
    {
      type: "image_url",
      image_url: { url: imageReferenceUrl(args.teacher.imageUrl) },
    },
    {
      type: "text",
      text: [
        `Create a candid Ruby High photo of ${args.student.name} and ${args.teacher.name} immediately after ${args.student.name} passed ${className}${args.letterGrade ? ` with a ${args.letterGrade}` : ""}.`,
        "IDENTITY LOCK: Both reference images are canonical character sheets. Preserve each person's hair, face, skin tone, outfit, silhouette, proportions, age, role, and art style. Adapt pose and expression only. Include exactly these two people.",
        "",
        `ACTUAL CLASS: ${className}.`,
        subjects.length > 0
          ? `SUBJECTS: ${subjects.join(", ")}. The room, teaching materials, and activity must unmistakably belong to these subjects.`
          : "The room, teaching materials, and activity must unmistakably belong to this named class.",
        args.grade ? `STUDENT YEAR: Grade ${args.grade}.` : "",
        `LOCATION: ${scene.roomName}. ${scene.setting}.`,
        `LOCATION DETAILS: ${scene.props}.`,
        `CAMERA: ${scene.camera}.`,
        `MOMENT: The lesson has just ended. ${args.student.name} is reacting to the result while ${args.teacher.name} responds in character beside the evidence of the completed class.`,
        "COMPOSITION: wide horizontal editorial school photo, 16:9. Show both people from head to at least knees, at different depths and angles, naturally interacting with each other and the classroom. Keep both faces clear.",
        "LOCATION REQUIREMENT: the final image must visibly show this named Ruby High location and its architecture or room details. The source portraits are identity references only; never return either source image unchanged.",
        "AVOID: solo portraits, character sheets, plain or gradient backgrounds, formal lineup, generic empty classroom, graduation imagery, trophies, extra people, character redesigns, outfit swaps, visible grades, captions, speech bubbles, logos, and watermarks.",
        "STYLE: JRPG/anime-influenced school editorial, bold black outlines, vibrant flat colors, subtle cel shading, polished yearbook-quality finish.",
      ].filter(Boolean).join("\n"),
    },
  ];

  const body = await openRouterJson<PortraitResponse>({
    apiKey: args.apiKey,
    label: "class-passed-photo",
    timeoutMs: PORTRAIT_TIMEOUT_MS * 2,
    body: {
      model: PORTRAIT_MODEL,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: contentParts }],
      max_tokens: PORTRAIT_MAX_TOKENS,
    },
  });
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("Passed-class photo generation returned no image.");
  assertNewGeneratedImage(
    url,
    [args.student.imageUrl, args.teacher.imageUrl],
    "Passed-class photo generation",
  );
  return url;
}

export interface RubyHighSocialPhotoReference {
  role: "teacher" | "student" | "group";
  id: string;
  name: string;
  imageUrl: string;
}

export interface RubyHighSocialPhotoResult {
  imageUrl: string;
  sceneId: string;
  roomName: string;
}

/** Turn canonical portrait, collectible, or group references into a new
 *  public social image set inside a named Ruby High campus location. Raw
 *  references are inputs only and must never be used as the final post media. */
export async function renderRubyHighSocialPhoto(args: {
  apiKey: string;
  kind: string;
  storyBeat: string;
  grade?: string;
  area?: "classroom" | "teacher-lounge";
  references: RubyHighSocialPhotoReference[];
}): Promise<RubyHighSocialPhotoResult> {
  if (args.references.length < 1 || args.references.length > 4) {
    throw new Error("Ruby High social photos require one to four visual references.");
  }
  const references = args.references.filter((reference) => reference.imageUrl.trim());
  if (references.length < 1) {
    throw new Error("Ruby High social photos require at least one usable visual reference.");
  }
  const scene = rubyHighPhotoSceneForSchoolUpdate(
    args.area ?? "classroom",
    args.grade,
    [args.kind, args.grade ?? "", ...references.map((reference) => reference.id)].join(":"),
  );
  const contentParts: Array<Record<string, unknown>> = [];
  references.forEach((reference, index) => {
    contentParts.push({
      type: "text",
      text: `REFERENCE IMAGE ${index + 1}: ${reference.name} - ${reference.role}. This is identity/source material only; preserve the people shown but do not reuse the image as the final composition.`,
    });
    contentParts.push({
      type: "image_url",
      image_url: { url: imageReferenceUrl(reference.imageUrl) },
    });
  });
  const graduationMoment = /graduat|diploma/i.test(args.kind);
  contentParts.push({
    type: "text",
    text: [
      `Create a brand-new Ruby High editorial social photo for this event: ${args.kind}.`,
      `CAST REFERENCES: ${references.map((reference) => `${reference.name} (${reference.role})`).join(", ")}.`,
      "IDENTITY LOCK: Preserve the hair, face, skin tone, outfit, silhouette, proportions, age, and art style of every person visible in the reference material. Adapt pose and expression only. Do not add unreferenced people.",
      "REFERENCE-ONLY RULE: Every supplied image is input material, never publishable media. Do not copy, crop, frame, or return a source image unchanged.",
      "",
      `LOCATION: ${scene.roomName}. ${scene.setting}.`,
      `STORY BEAT: ${args.storyBeat}`,
      `PHOTO DIRECTION: ${scene.action}`,
      `CAMERA: ${scene.camera}.`,
      `ROOM DETAILS: ${scene.props}.`,
      "LOCATION REQUIREMENT: the final image must clearly and unmistakably show the named Ruby High location through architecture, furniture, and room props. A plain, gradient, transparent, or portrait-studio background is a failed result.",
      "COMPOSITION: wide horizontal editorial school photo, 16:9. Use environmental depth, natural interaction, expressive hands, and clear faces. Show people from head to at least knees when the references allow it.",
      graduationMoment
        ? "Graduation details may appear as subtle props, but the scene must remain candid and grounded in the location."
        : "This is an ordinary school-day moment: no graduation caps, gowns, diplomas, confetti, trophies, or formal lineup.",
      "AVOID: source-image reuse, solo character sheet, plain backdrop, tight portrait crop, formal lineup, generic empty room, character redesign, outfit swap, extra people, readable text, captions, speech bubbles, logos, and watermarks.",
      "STYLE: JRPG/anime-influenced school editorial, bold black outlines, vibrant flat colors, subtle cel shading, polished yearbook-quality finish.",
    ].join("\n"),
  });

  const body = await openRouterJson<PortraitResponse>({
    apiKey: args.apiKey,
    label: "ruby-high-social-location-photo",
    timeoutMs: PORTRAIT_TIMEOUT_MS * 2,
    body: {
      model: PORTRAIT_MODEL,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: contentParts }],
      max_tokens: PORTRAIT_MAX_TOKENS,
    },
  });
  const imageUrl = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imageUrl) throw new Error("Ruby High social location photo generation returned no image.");
  assertNewGeneratedImage(
    imageUrl,
    references.map((reference) => reference.imageUrl),
    "Ruby High social location photo generation",
  );
  return { imageUrl, sceneId: scene.id, roomName: scene.roomName };
}

function scheduledSchoolUpdatePhotoFacts(context: ScheduledSchoolUpdateContext): string[] {
  const facts: string[] = [];
  if (context.activeStudents > 0) facts.push(`${context.activeStudents} students are active around campus.`);
  if (context.highlights.newStudents > 0) facts.push(`${context.highlights.newStudents} new students arrived recently.`);
  if (context.highlights.classesPassed > 0) facts.push(`${context.highlights.classesPassed} classes were passed.`);
  if (context.highlights.gradesAdvanced > 0) facts.push(`${context.highlights.gradesAdvanced} students advanced a grade.`);
  if (context.highlights.graduations > 0) facts.push(`${context.highlights.graduations} graduations were recorded.`);
  if (context.recentEvents.roomGoalProgress > 0) facts.push("Classroom goals are moving forward.");
  if (context.recentEvents.relationshipMoments > 0) facts.push("The teacher's lounge is carrying lively social energy.");
  if (context.recentEvents.comicPagesUnlocked > 0) facts.push("A hidden school story was uncovered.");
  return facts.length > 0 ? facts : ["The school is in the middle of an active day."];
}

type PhotoParticipantRole = "student" | "teacher" | "classmate";

interface PhotoParticipant {
  role: PhotoParticipantRole;
  id?: string;
  name: string;
  imageUrl: string;
  personality?: string;
  playbookName?: string;
  flavorQuote?: string;
  arcAnswer?: string;
}

interface PhotoActionProposal {
  role: PhotoParticipantRole;
  name: string;
  action: string;
}

interface GraduationPhotoDirectionPlan {
  plan: string;
  proposals: PhotoActionProposal[];
}

function compactText(value: string | undefined, max = 360): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "").trim();
}

function cleanPhotoDirection(value: string | undefined, max = 260): string {
  const text = compactText(value, max)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(action|pose|plan|direction):\s*/i, "")
    .trim();
  return text;
}

function participantPersona(participant: PhotoParticipant): string {
  if (participant.role === "student") {
    return [
      `You are ${participant.name}, the graduating student in this photo.`,
      participant.playbookName ? `Playbook: ${participant.playbookName}.` : "",
      participant.personality ? `Personality: ${participant.personality}` : "",
      participant.flavorQuote ? `Flavor line: ${participant.flavorQuote}` : "",
      participant.arcAnswer ? `Arc answer: ${participant.arcAnswer}` : "",
    ].filter(Boolean).join("\n");
  }
  if (participant.role === "teacher") {
    const teacher = participant.id ? teacherById(participant.id) : null;
    return teacher
      ? compactText(teacher.systemPrompt, 520)
      : `You are ${participant.name}, a Ruby High teacher with a specific classroom presence.`;
  }
  const student = participant.id ? studentById(participant.id) : null;
  return student
    ? compactText(student.systemPrompt, 520)
    : `You are ${participant.name}, a Ruby High classmate with your own social rhythm.`;
}

async function askGraduationPhotoAction(args: {
  apiKey: string;
  gradeLabel: string;
  scene: RubyHighPhotoScene;
  participant: PhotoParticipant;
  cast: PhotoParticipant[];
}): Promise<PhotoActionProposal> {
  const roleLabel = args.participant.role === "student"
    ? "graduating student"
    : args.participant.role;
  const prompt = [
    `Ruby High is taking a ${args.gradeLabel} graduation photo in ${args.scene.roomName}.`,
    `Location details: ${args.scene.setting}.`,
    `Cast: ${args.cast.map((member) => `${member.name} (${member.role})`).join(", ")}.`,
    `Character: ${args.participant.name} (${roleLabel}).`,
    "",
    "Choose what this character physically does in the still photo.",
    "Return one concise visual action only, 8-22 words. No dialogue. No camera directions. No text to appear in the image.",
  ].join("\n");
  const body = await openRouterJson<CharacterResponse>({
    apiKey: args.apiKey,
    label: `graduation-photo-${args.participant.role}-action`,
    timeoutMs: PHOTO_DIRECTION_TIMEOUT_MS,
    body: {
      model: PHOTO_DIRECTION_MODEL,
      messages: [
        {
          role: "system",
          content: [
            participantPersona(args.participant),
            "You are deciding only this character's pose/action for one graduation photo.",
          ].join("\n\n"),
        },
        { role: "user", content: prompt },
      ],
      max_tokens: PHOTO_DIRECTION_MAX_TOKENS,
      temperature: 0.85,
    },
  });
  const action = cleanPhotoDirection(body.choices?.[0]?.message?.content, 220);
  if (!action) throw new Error(`No photo action returned for ${args.participant.name}.`);
  return {
    role: args.participant.role,
    name: args.participant.name,
    action,
  };
}

async function consolidateGraduationPhotoDirection(args: {
  apiKey: string;
  gradeLabel: string;
  scene: RubyHighPhotoScene;
  proposals: PhotoActionProposal[];
}): Promise<string> {
  const prompt = [
    "Consolidate these in-character action proposals into one coherent image-generation direction.",
    `Photo: Ruby High ${args.gradeLabel} graduation photo.`,
    `Location: ${args.scene.roomName}. ${args.scene.setting}.`,
    "Keep the final shot physically possible, dynamic, readable, and candid. Preserve the spirit of all three actions, but resolve collisions.",
    "Return 1-2 concise sentences. No dialogue. No text in the image. No camera metadata.",
    "",
    ...args.proposals.map((proposal) => `${proposal.name} (${proposal.role}): ${proposal.action}`),
  ].join("\n");
  const body = await openRouterJson<CharacterResponse>({
    apiKey: args.apiKey,
    label: "graduation-photo-direction",
    timeoutMs: PHOTO_DIRECTION_TIMEOUT_MS,
    body: {
      model: PHOTO_DIRECTION_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: Math.max(PHOTO_DIRECTION_MAX_TOKENS, 240),
      temperature: 0.35,
    },
  });
  const plan = cleanPhotoDirection(body.choices?.[0]?.message?.content, 420);
  if (!plan) throw new Error("No consolidated graduation photo direction returned.");
  return plan;
}

async function graduationPhotoDirectionPlan(args: {
  apiKey: string;
  gradeLabel: string;
  scene: RubyHighPhotoScene;
  participants: PhotoParticipant[];
}): Promise<GraduationPhotoDirectionPlan | null> {
  if (process.env.RUBY_HIGH_PHOTO_DIRECTION_ENABLED === "0") return null;
  try {
    const settled = await Promise.allSettled(args.participants.map((participant) =>
      askGraduationPhotoAction({
        apiKey: args.apiKey,
        gradeLabel: args.gradeLabel,
        scene: args.scene,
        participant,
        cast: args.participants,
      })
    ));
    const proposals = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (proposals.length !== args.participants.length) {
      throw new Error(`Expected ${args.participants.length} photo actions, received ${proposals.length}.`);
    }
    const plan = await consolidateGraduationPhotoDirection({
      apiKey: args.apiKey,
      gradeLabel: args.gradeLabel,
      scene: args.scene,
      proposals,
    });
    return { plan, proposals };
  } catch (err) {
    log.event("graduation-photo.direction-failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function highestScoringFaculty(scores: Record<string, { correct: number; total: number }> | undefined): string {
  if (!scores) return "ruby";
  let best: { id: string; ratio: number; total: number } | null = null;
  for (const [id, s] of Object.entries(scores)) {
    if (s.total === 0) continue;
    const ratio = s.correct / s.total;
    if (!best || ratio > best.ratio || (ratio === best.ratio && s.total > best.total)) {
      best = { id, ratio, total: s.total };
    }
  }
  return best ? best.id : "ruby";
}

function randomStatDistribution(): CharacterStats {
  const values = [2, 1, 0, -1];
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = values[i]!;
    values[i] = values[j]!;
    values[j] = tmp;
  }
  return { head: values[0]!, heart: values[1]!, hustle: values[2]!, honor: values[3]! };
}

const FORBIDDEN_NAMES_HINT = [
  "Marcus", "Maya", "Mariana", "Emma", "Sarah", "James", "Alex", "Sam", "Jordan", "Liam",
  "Olivia", "Noah", "Ava", "Mia", "Ethan", "Aiden", "Lucas", "Harper", "Sophia",
];

export type CharacterComponent = "name" | "personality" | "arcAnswer" | "flavorQuote" | "stats" | "playbook";
const ALL_COMPONENTS: CharacterComponent[] = ["name", "personality", "arcAnswer", "flavorQuote", "stats", "playbook"];

export interface RolledCharacter {
  name: string;
  playbookId: string;
  stats: CharacterStats;
  arcAnswer: string;
  flavorQuote: string;
  personality: string;
}

export async function rollRandomCharacter(args: {
  apiKey: string;
  regen?: CharacterComponent[];
  keep?: Partial<RolledCharacter>;
}): Promise<RolledCharacter> {
  const regenSet = new Set<CharacterComponent>(args.regen && args.regen.length > 0 ? args.regen : ALL_COMPONENTS);
  const keep = args.keep ?? {};

  let playbook = regenSet.has("playbook")
    ? PLAYBOOKS[Math.floor(Math.random() * PLAYBOOKS.length)]!
    : PLAYBOOKS.find((p) => p.id === keep.playbookId);
  if (!playbook) {
    playbook = PLAYBOOKS[Math.floor(Math.random() * PLAYBOOKS.length)]!;
  }
  const stats: CharacterStats = regenSet.has("stats") || !keep.stats
    ? randomStatDistribution()
    : keep.stats;

  const textFields: CharacterTextComponent[] = ["name", "personality", "arcAnswer", "flavorQuote"];
  const textRegen = textFields.filter((f) => regenSet.has(f));
  if (textRegen.length === 0) {
    const name = String(keep.name ?? "").trim();
    const arcAnswer = String(keep.arcAnswer ?? "").trim();
    const flavorQuote = String(keep.flavorQuote ?? "").trim();
    const personality = String(keep.personality ?? "").trim();
    if (!name || !arcAnswer || !personality) {
      throw new Error("Dice-only reroll requires name, arcAnswer, and personality in `keep`.");
    }
    return { name, playbookId: playbook.id, stats, arcAnswer, flavorQuote, personality };
  }

  const fmt = (n: number) => (n >= 0 ? "+" : "") + n;
  const lockedLines: string[] = [];
  if (!regenSet.has("name") && keep.name) lockedLines.push(`Existing name (do not change): ${keep.name}`);
  if (!regenSet.has("personality") && keep.personality) lockedLines.push(`Existing personality (do not change): ${keep.personality}`);
  if (!regenSet.has("arcAnswer") && keep.arcAnswer) lockedLines.push(`Existing arcAnswer (do not change): ${keep.arcAnswer}`);
  if (!regenSet.has("flavorQuote") && keep.flavorQuote) lockedLines.push(`Existing flavorQuote (do not change): ${keep.flavorQuote}`);

  const schemaFields = textRegen.map((f) => `"${f}":"..."`).join(",");
  const schemaLine = `{${schemaFields}}`;

  const userPrompt = [
    "Roll a random AI student attending Ruby High (a high school RPG). The player inhabits this character. Aim for a real teenager with small specific concerns — the register of group-chat texts, lunch-line gossip, a half-finished homework excuse.",
    "",
    `Playbook (locked): ${playbook.name} — ${playbook.blurb}`,
    `Hook question (locked): "${playbook.hookQuestion}"`,
    `Stats (locked): HEAD ${fmt(stats.head)}, HEART ${fmt(stats.heart)}, HUSTLE ${fmt(stats.hustle)}, HONOR ${fmt(stats.honor)}`,
    ...lockedLines,
    "",
    "Generate JSON containing ONLY the fields below (no other text, no markdown, no code fences). Output exactly this shape:",
    schemaLine,
    "",
    "Field guidance:",
    "- name: ONE first name. Anything goes — common, uncommon, a chosen name, a nickname, a strange spelling. The kind of name a teenager actually has. Examples of the spread: Kit, Theo, Saoirse, Mei, Pip, Yusuf, Birta, Lior, Niamh, Tomás, Arlo, Vic, Ren, Esi, Soren. Skip the AI-default picks: " + FORBIDDEN_NAMES_HINT.join(", ") + ".",
    "- arcAnswer: 1-2 sentences answering the hook in voice. Specific, dorky, small. Examples of the register:",
    `    Overachiever / "Why is Cs not enough?": "honestly if i get an A- i replay it for like a week. last quiz i missed one and didn't sleep. my mom thinks im fine."`,
    `    Slacker / "Who do you not want to disappoint?": "my older brother. he was good at this stuff. its embarrassing how much i think about it."`,
    `    Class Clown / "What can't you say without a joke?": "anytime someone cries i panic and do a bit. did one at my uncle's funeral. my mom is still annoyed."`,
    `    Lifer / "What's the best gossip you've picked up?": "the science wing has a closet with 40 trophies from 1987 and nobody knows why. also Mr. Kelner is on his third divorce."`,
    "    Pull from the same register as the playbook above.",
    "- flavorQuote: ONE short line, 6-18 words. Magic: the Gathering flavor text — captures attitude in a moment, not backstory. Examples of the right shape:",
    `    "I'd rather you be wrong with reasons than right by accident." (Sally Science)`,
    `    "wait what — i KNEW it was c. ok im rewriting my notes." (Lyra)`,
    `    "i'm just here to drink chocolate milk and lose, and im out of chocolate milk."`,
    `    "if mr. patek calls on me one more time im transferring to the moon."`,
    "  No surrounding quote marks — the renderer adds them.",
    "- personality: 2-3 sentences. How they SHOW UP in class — fixations, doodles, what they whisper, who they sit by, their thing. Tie one trait to a high stat (HEAD=sharp / HEART=warm / HUSTLE=quick / HONOR=principled) and one to the low stat. Examples of the register:",
    `    "Always has gum, never offers it. Sits by the broken radiator on purpose because the noise helps her think. Doodles snakes through every verbal lesson and forgets her name is being called."`,
    `    "Knows the lyrics to one (1) song and references it constantly. Visibly stressed when the teacher reorders the day. Will eat anyone's leftover fries without asking."`,
    "    Third person. Same scale as those — kid stuff, not life themes.",
  ].join("\n");

  const r = await fetchLlmChatCompletions({
    apiKey: args.apiKey,
    timeoutMs: CHARACTER_ROLL_TIMEOUT_MS,
    label: "character-roll",
    body: {
      model: resolveStudentModel(),
      messages: [
        { role: "system", content: "You generate compact JSON character sheets for a high school RPG. Output VALID JSON only — no commentary, no code fences, no extra keys." },
        { role: "user", content: userPrompt },
      ],
      provider: { require_parameters: true },
      response_format: characterResponseFormat(textRegen),
      max_tokens: 1200,
      temperature: 1.1,
    },
  });
  if (!r.ok) await throwLlmResponseError(r, "character");
  const body = await r.json() as CharacterResponse;
  const raw = (body.choices?.[0]?.message?.content ?? "").trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed: { name?: unknown; arcAnswer?: unknown; flavorQuote?: unknown; personality?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse character JSON: ${(err as Error).message} — body: ${cleaned.slice(0, 200)}`);
  }

  const pick = (field: "name" | "arcAnswer" | "flavorQuote" | "personality"): string => {
    if (regenSet.has(field)) {
      const v = String(parsed[field] ?? "").trim();
      return field === "flavorQuote" ? v.replace(/^["“'\s]+|["”'\s]+$/g, "") : v;
    }
    return String(keep[field] ?? "").trim();
  };
  const name = pick("name");
  const arcAnswer = pick("arcAnswer");
  const flavorQuote = pick("flavorQuote");
  const personality = pick("personality");
  if (!name || !arcAnswer || !personality) {
    throw new Error("Generated character missing required fields.");
  }
  return { name, playbookId: playbook.id, stats, arcAnswer, flavorQuote, personality };
}
