import type { ViewerRenderOptions } from "../viewer.js";
import { createAccountCardReaderRenderer } from "./account-card-reader.js";
import { createAccountCharacterPanelRenderer } from "./account-character-panel.js";
import { createAccountComicPanelRenderer } from "./account-comic-panel.js";
import { createAccountHallPassCardsPanelRenderer } from "./account-hall-pass-cards-panel.js";
import { createAccountHistoryPanelRenderer } from "./account-history-panel.js";
import { createAccountPublicWorldController } from "./account-public-world.js";
import { createAccountTrustPanelRenderer } from "./account-trust-panel.js";
import { createViewerApiClient, withViewerTimeoutSignal } from "./api.js";
import { createBillingProductsRenderer } from "./billing-products.js";
import { createCardBurnSelector } from "./card-burn-selector.js";
import { createCcgCardRenderer } from "./ccg-card.js";
import { createCareerCardRenderer } from "./career-card.js";
import { createClassReportRenderer } from "./class-report.js";
import { createComicReaderRenderer } from "./comic-reader.js";
import { consumeViewerSseStream, parseViewerSseFrames } from "./sse.js";
import { createViewerTurnController } from "./turn-controller.js";
import { createViewerWorldActionsController } from "./world-actions.js";
import { createViewerWorldController } from "./world-controller.js";
import { createViewerWorldFeedClient } from "./world-feed.js";
import { createViewerWorldLifecycleController } from "./world-lifecycle.js";
import { createViewerWorldPanelController } from "./world-panel.js";
import { createWelcomeHallPassPopupRenderer } from "./welcome-hall-pass-popup.js";
import { createYearbookArchiveRenderer } from "./yearbook-archive.js";
import { createYearbookShareActionsRenderer } from "./yearbook-share-actions.js";
import { createRoomChannelRowsController } from "./room-channel-rows.js";
import { createLeaderboardPanelRenderer } from "./leaderboard-panel.js";
import { createPackMintProgressController } from "./pack-mint-progress.js";
import { createRaceStripRenderer } from "./race-strip.js";
import { createArcIndicatorRenderer } from "./arc-indicator.js";
import { createGuestSpotlightRenderer } from "./guest-spotlight.js";
import { createClassmateChannelRowsRenderer } from "./classmate-channel-rows.js";
import { runViewerClient } from "./client.js";
import * as Pure from "./client-pure.js";

// Returns the SPA viewer's inline JS as a string. The heavy browser client
// lives in client.ts as real JavaScript, then gets serialized here so Ruby
// High can keep the current no-extra-asset viewer delivery path.
//
// Pure helpers + constants live in client-pure.ts; they're stringified
// alongside runViewerClient so all of them end up as siblings at the IIFE
// scope. That means call sites inside runViewerClient still reference them
// by their original bare names — no `.helpers.x` dispatch.

// Every named export of client-pure.ts that's a function. Constants are
// emitted separately from VIEWER_CONSTANTS via JSON.stringify.
const PURE_HELPER_NAMES = [
  "statLabel",
  "scoreAwardLabel",
  "letterGradePasses",
  "letterGradeForScore",
  "streakScoreMultiplier",
  "formatClassScore",
  "todayCorrectSummary",
  "makeVisitorId",
  "getVisitorId",
  "attachVisitorHeader",
  "teacherShortName",
  "earnedCourseGrade",
  "subjectProgressShortLabel",
  "subjectProgressLongLabel",
  "subjectStandingLabel",
  "subjectStatusText",
  "questionsLeftInClass",
  "questionsLeftText",
  "questionsLeftSentence",
  "boardSubjectGradesTitleView",
  "subjectGradeChipView",
  "guestSpotlightView",
  "formatWholeNumber",
  "formatMoney",
  "formatTokenAmount",
  "formatTokenDisplayAmount",
  "formatDuration",
  "formatRelativeExpiry",
  "packCountLabel",
  "cardPackTokenSymbol",
  "cardPackDebitLabel",
  "cardPackCreditLabel",
  "cardPackPaymentDeltaLabel",
  "cardPackProductMeta",
  "billingCardPackPaymentChoiceView",
  "billingProductRowView",
  "billingProductsPanelView",
  "escapeHtml",
  "escape",
  "safeMarkdownHref",
  "sanitizeVisibleChatText",
  "markdownInlineHtml",
  "appendMarkdownInline",
  "renderMarkdownInto",
  "positiveWholeNumber",
  "hallPassCostLabel",
  "billingHallPassPaymentChoiceView",
  "welcomeHallPassPopupView",
  "clipPlayerContext",
  "imageRequestId",
  "shortWallet",
  "walletPreviewAddress",
  "walletPreviewLine",
  "officialRubyHighWebsite",
  "solanaAccountLink",
  "accountPublicWorldNameReview",
  "accountPublicWorldView",
  "formatAccountDate",
  "walletTransactionCardCount",
  "walletTransactionTitle",
  "walletTransactionDescription",
  "walletTransactionPackDeltaText",
  "walletTransactionSource",
  "accountHistoryRowView",
  "accountCharacterCardView",
  "accountEmptyCharacterSlotView",
  "accountCharacterPanelView",
  "accountAiPanelView",
  "accountWalletPanelView",
  "normalizeAccountPane",
  "accountPaneItemView",
  "accountTrustPanelView",
  "accountHallPassCardsPanelView",
  "accountHallPassPackTileView",
  "hallPassCardIsFaceDown",
  "hallPassCardTitle",
  "hallPassCardStatus",
  "hallPassCardDetail",
  "accountHallPassCardTileView",
  "hallPassCardDetailLabel",
  "hallPassCardProfile",
  "accountHallPassCardReaderView",
  "billingCardBurnChoiceView",
  "comicPageTitle",
  "accountComicPanelView",
  "formatSealedDate",
  "nextGradeAfterClient",
  "fmtStat",
  "fmtRewardStat",
  "seededShuffle",
  "hashCeremonySeed",
  "essayScoreText",
  "essayLetter",
  "clipEssayText",
  "normalizedWorldFeedEventAt",
  "pruneWorldFeedEventList",
  "mergeWorldFeedEventList",
  "worldFeedEventDisplayLabel",
  "worldFeedEventAgeLabel",
  "worldFeedGradeLabel",
  "worldFeedFacultyLabel",
  "worldFeedRoomTitle",
  "worldFeedSummaryLabel",
  "worldFeedTermRuleLabels",
  "worldFeedRoomPressureLabel",
  "worldFeedCurriculumPressureLabel",
  "worldFeedRoomBonusPressureLabel",
  "worldFeedRoomPressureText",
  "worldFeedRoomViews",
  "worldFeedRoomViewsForSummary",
  "worldFeedEventViews",
  "worldFeedPanelView",
  "worldFeedEventsUrl",
  "raceStripView",
  "raceStripPickText",
  "questionPromptView",
  "leaderboardView",
  "leaderboardRowView",
  "leaderboardPlaybookName",
  "leaderboardGradeChips",
  "leaderboardFacultyLabel",
  "arcIndicatorView",
  "classmateArcStanding",
  "classmateArcSubtitle",
  "classmateArcProgress",
  "classmateArcProgressLabel",
  "roomCompletionProgressView",
  "roomCompletionProgressLabel",
  "roomChannelRowViews",
] as const;

function serializePureHelpers(): string {
  // Each helper is referenced two ways inside the IIFE, so it must be declared
  // under both. esbuild renames colliding module-scope identifiers when the
  // same name exists in another bundled module (e.g. escapeHtml -> escapeHtml4,
  // escape -> escape2 collide with server-side helpers). Sibling helpers in
  // client-pure.ts call each other through those *renamed* bindings, while
  // runViewerClient in client.ts calls them by their *source* names as free
  // globals (it never imports them — it relies on them being IIFE siblings).
  // Declaring only one name leaves the other unresolved, throwing a
  // ReferenceError that crashes the viewer at boot.
  const declared = new Set<string>();
  const lines: string[] = [];
  for (const name of PURE_HELPER_NAMES) {
    const fn = (Pure as Record<string, unknown>)[name] as { name?: string } | undefined;
    if (typeof fn !== "function") {
      throw new Error(`viewerScript: expected client-pure export "${name}" to be a function`);
    }
    const bindingName = fn.name || name;
    if (!declared.has(bindingName)) {
      lines.push(`const ${bindingName} = ${fn.toString()};`);
      declared.add(bindingName);
    }
    if (name !== bindingName && !declared.has(name)) {
      lines.push(`const ${name} = ${bindingName};`);
      declared.add(name);
    }
  }
  return lines.join("\n  ");
}

function serializeConstants(): string {
  const keys = Object.keys(Pure.VIEWER_CONSTANTS);
  return [
    `const VIEWER_CONSTANTS = ${scriptJson(Pure.VIEWER_CONSTANTS)};`,
    `const { ${keys.join(", ")} } = VIEWER_CONSTANTS;`,
  ].join("\n  ");
}

export function viewerScript(opts: ViewerRenderOptions): string {
  const role = opts.role === "agent" ? "agent" : "human";
  const bootstrap = scriptJson({
    apiBase: opts.apiBase,
    sessionId: opts.sessionId,
    role,
    build: opts.build ?? "dev",
    privyConfig: opts.privy
      ? { appId: opts.privy.appId, clientId: opts.privy.clientId, loginMethods: opts.privy.loginMethods }
      : null,
  });

  return `
(() => {
  const bootstrap = ${bootstrap};
  ${serializeConstants()}
  ${serializePureHelpers()}
  const withViewerTimeoutSignal = ${withViewerTimeoutSignal.toString()};
  const createAccountCardReaderRenderer = ${createAccountCardReaderRenderer.toString()};
  const createAccountCharacterPanelRenderer = ${createAccountCharacterPanelRenderer.toString()};
  const createAccountComicPanelRenderer = ${createAccountComicPanelRenderer.toString()};
  const createAccountHallPassCardsPanelRenderer = ${createAccountHallPassCardsPanelRenderer.toString()};
  const createAccountHistoryPanelRenderer = ${createAccountHistoryPanelRenderer.toString()};
  const createAccountPublicWorldController = ${createAccountPublicWorldController.toString()};
  const createAccountTrustPanelRenderer = ${createAccountTrustPanelRenderer.toString()};
  const createViewerApiClient = ${createViewerApiClient.toString()};
  const createBillingProductsRenderer = ${createBillingProductsRenderer.toString()};
  const createCardBurnSelector = ${createCardBurnSelector.toString()};
  const createCcgCardRenderer = ${createCcgCardRenderer.toString()};
  const createCareerCardRenderer = ${createCareerCardRenderer.toString()};
  const createClassReportRenderer = ${createClassReportRenderer.toString()};
  const createComicReaderRenderer = ${createComicReaderRenderer.toString()};
  const createViewerTurnController = ${createViewerTurnController.toString()};
  const createViewerWorldActionsController = ${createViewerWorldActionsController.toString()};
  const createViewerWorldFeedClient = ${createViewerWorldFeedClient.toString()};
  const createViewerWorldLifecycleController = ${createViewerWorldLifecycleController.toString()};
  const createViewerWorldPanelController = ${createViewerWorldPanelController.toString()};
  const createWelcomeHallPassPopupRenderer = ${createWelcomeHallPassPopupRenderer.toString()};
  const createViewerWorldController = ${createViewerWorldController.toString()};
  const createRoomChannelRowsController = ${createRoomChannelRowsController.toString()};
  const createLeaderboardPanelRenderer = ${createLeaderboardPanelRenderer.toString()};
  const createYearbookArchiveRenderer = ${createYearbookArchiveRenderer.toString()};
  const createYearbookShareActionsRenderer = ${createYearbookShareActionsRenderer.toString()};
  const createPackMintProgressController = ${createPackMintProgressController.toString()};
  const createRaceStripRenderer = ${createRaceStripRenderer.toString()};
  const createArcIndicatorRenderer = ${createArcIndicatorRenderer.toString()};
  const createGuestSpotlightRenderer = ${createGuestSpotlightRenderer.toString()};
  const createClassmateChannelRowsRenderer = ${createClassmateChannelRowsRenderer.toString()};
  const parseViewerSseFrames = ${parseViewerSseFrames.toString()};
  const consumeViewerSseStream = ${consumeViewerSseStream.toString()};
  const runViewerClient = ${runViewerClient.toString()};
  runViewerClient(bootstrap);
})();`;
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, "<\\/");
}
