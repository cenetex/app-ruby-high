import { openRouterJson } from "./openrouter-client.js";
import { log } from "./logger.js";
import { publicBaseUrl } from "./generated-portrait-assets.js";
import {
  rubyHighPhotoSceneForGrade,
} from "./school-photo-scenes.js";

const YEARBOOK_MODEL = process.env.RUBY_HIGH_PORTRAIT_MODEL ?? "google/gemini-3.1-flash-image-preview";
const YEARBOOK_MAX_TOKENS = Number(process.env.RUBY_HIGH_PORTRAIT_MAX_TOKENS ?? 4000);
const YEARBOOK_TIMEOUT_MS = 120_000;

interface ImageResponse {
  choices?: Array<{
    message?: {
      images?: Array<{ image_url?: { url?: string } }>;
    };
  }>;
}

export interface YearbookCardInput {
  characterName: string;
  grade: string;
  playbookName: string;
  portraitDataUrl?: string;
  teacherImageUrl?: string;
  teacherName?: string;
  classmateImageUrl?: string;
  classmateName?: string;
}

function imageReferenceUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:image/")) return url;
  return new URL(url, publicBaseUrl() + "/").toString();
}

export async function renderYearbookCard(args: {
  apiKey: string;
  card: YearbookCardInput;
}): Promise<string> {
  const { apiKey, card } = args;

  const contentParts: Array<Record<string, unknown>> = [];

  const references: Array<{ label: string; url: string }> = [];
  if (card.portraitDataUrl) {
    references.push({ label: `${card.characterName} - graduating student`, url: card.portraitDataUrl });
  }
  if (card.classmateImageUrl) {
    references.push({ label: `${card.classmateName ?? "Classmate"} - classmate`, url: card.classmateImageUrl });
  }
  if (card.teacherImageUrl) {
    references.push({ label: `${card.teacherName ?? "Teacher"} - teacher`, url: card.teacherImageUrl });
  }
  references.forEach((ref, index) => {
    contentParts.push({
      type: "text",
      text: `REFERENCE IMAGE ${index + 1}: ${ref.label}. Use this exact character identity for that person.`,
    });
    contentParts.push({ type: "image_url", image_url: { url: imageReferenceUrl(ref.url) } });
  });

  const cast = [
    card.characterName,
    card.classmateName,
    card.teacherName,
  ].filter(Boolean);
  const scene = rubyHighPhotoSceneForGrade(card.grade, [
    card.grade,
    card.characterName,
    card.classmateName,
    card.teacherName,
  ].filter(Boolean).join(":"));

  const promptText = [
    `Arrange these ${cast.length} characters into a dynamic Ruby High campus yearbook scene.`,
    cast.length === 3
      ? `${card.characterName} (graduating student), ${card.classmateName} (classmate), and ${card.teacherName} (teacher).`
      : `Characters: ${cast.join(", ")}.`,
    card.grade ? `Grade level: ${card.grade}.` : "",
    references.length > 0
      ? `IDENTITY LOCK: Use the provided reference image${references.length === 1 ? "" : "s"} as canonical character sheets. Preserve each person's hair shape and color, outfit, silhouette, face, skin tone, proportions, role, and art style. Adapt pose and expression only. Do not substitute generic anime students or redesign the cast.`
      : "",
    "",
    `LOCATION: ${scene.roomName}. ${scene.setting}.`,
    `ACTION: ${scene.action}`,
    `CAMERA: ${scene.camera}.`,
    `ROOM DETAILS: ${scene.props}.`,
    "",
    "STYLE: JRPG-style school-life scene - a single wide horizontal image. The cast should be at different depths and angles, interacting with the room and each other in distinct fun poses. Each character keeps their original appearance, outfit, and art style from their reference image. Bold black outlines. Vibrant flat colors with subtle cel shading. Everyone visible, no one cut off. The composition feels like a freeze-frame from a school anime - a moment that matters.",
    "",
    "AVOID: plain homeroom, formal classroom photo-day backdrop, centered lineup, teacher-behind-students arrangement, stiff front-facing pose, chalkboard-centered composition, everyone standing still with arms at their sides, character redesigns, outfit swaps, age changes, extra people, missing cast members.",
    "OUTPUT: a single wide image (16:9). The school location fills the frame. No text, no names, no labels, no captions, no yearbook page layout. Just the characters in the scene.",
    "No visible text. No watermarks.",
  ].filter(Boolean).join("\n");

  contentParts.push({ type: "text", text: promptText });

  try {
    const body = await openRouterJson<ImageResponse>({
      apiKey,
      label: "yearbook-card",
      timeoutMs: YEARBOOK_TIMEOUT_MS,
      body: {
        model: YEARBOOK_MODEL,
        modalities: ["image", "text"],
        messages: [{ role: "user", content: contentParts }],
        max_tokens: YEARBOOK_MAX_TOKENS,
      },
    });
    const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) throw new Error("Yearbook image generation returned no image.");
    return url;
  } catch (err) {
    log.event("yearbook-image.first-attempt-failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    const body = await openRouterJson<ImageResponse>({
      apiKey,
      label: "yearbook-card-retry",
      timeoutMs: YEARBOOK_TIMEOUT_MS,
      body: {
        model: YEARBOOK_MODEL,
        modalities: ["image", "text"],
        messages: [{ role: "user", content: promptText }],
        max_tokens: YEARBOOK_MAX_TOKENS,
      },
    });
    const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) throw err;
    return url;
  }
}
