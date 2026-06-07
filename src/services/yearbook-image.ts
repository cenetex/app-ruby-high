import { openRouterJson } from "./openrouter-client.js";
import { log } from "./logger.js";

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

export async function renderYearbookCard(args: {
  apiKey: string;
  card: YearbookCardInput;
}): Promise<string> {
  const { apiKey, card } = args;

  const contentParts: Array<Record<string, unknown>> = [];

  if (card.portraitDataUrl) {
    contentParts.push({ type: "image_url", image_url: { url: card.portraitDataUrl } });
  }
  if (card.classmateImageUrl) {
    contentParts.push({ type: "image_url", image_url: { url: card.classmateImageUrl } });
  }
  if (card.teacherImageUrl) {
    contentParts.push({ type: "image_url", image_url: { url: card.teacherImageUrl } });
  }

  const cast = [
    card.characterName,
    card.classmateName,
    card.teacherName,
  ].filter(Boolean);

  const promptText = [
    `Arrange these ${cast.length} characters into a CLASSROOM SCENE at Ruby High.`,
    cast.length === 3
      ? `${card.characterName} (the student in the center), ${card.classmateName} (another student), and ${card.teacherName} (the teacher).`
      : `Characters: ${cast.join(", ")}.`,
    card.grade ? `Grade level: ${card.grade}.` : "",
    "",
    "STYLE: JRPG-style classroom scene — a single wide horizontal image. The teacher stands near a chalkboard or desk, two students are at their desks or standing nearby. Warm afternoon classroom lighting through windows. Chalk dust in the air. Books and papers on desks. Each character keeps their original appearance, outfit, and art style from their reference image. Bold black outlines. Vibrant flat colors with subtle cel shading. Everyone visible, no one cut off. The composition feels like a freeze-frame from a school anime — a moment that matters.",
    "",
    "OUTPUT: a single wide image (16:9). The classroom fills the frame. No text, no names, no labels, no captions, no yearbook page layout. Just the three characters in the room.",
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
