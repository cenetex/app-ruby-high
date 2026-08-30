import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FacultyService } from "../services/faculty-service.js";
import {
  HALL_PASS_CARDS_PER_PACK,
  RubyHighService,
  WELCOME_HALL_PASS_GRANT,
  WELCOME_HALL_PASS_GRANT_ID,
} from "../services/ruby-high-service.js";
import { SqliteStateStore } from "../services/sqlite-state-store.js";
import { StateStore, type StateStoreLike, type StoredServiceStateRecord } from "../services/state-store.js";
import {
  getLoadedPack,
  getPackByIdForSession,
  MAX_PACKS_PER_OWNER,
  publicCreatorPacks,
  registerPack,
  resetActivePack,
} from "../content/registry.js";
import type { ContentPack } from "../content/types.js";
import { PROJECT89_SIGNAL_TIMELINE_LAB_PACK_ID } from "../content/packs/project89-signal-timeline-lab.js";
import { FIRST_BELL_SET_CODE, FIRST_BELL_SET_NAME } from "../services/hall-pass-card-catalog.js";
import {
  HALL_PASS_PACK_REVEAL_LEGACY_VERSION,
  hallPassCatalogHash,
} from "../services/hall-pass-reveal-provenance.js";
import { DEFAULT_OPENROUTER_MODEL } from "../model-defaults.js";
import { cardMemoryKey, defaultCardMemory } from "../services/ruby-high/helpers.js";
import { applyTick as applyMashTick, emptyMashCard } from "../characters/mash.js";
import { dailyKey, type AnswerRecord, type QuizState } from "../types.js";

let tmpDir: string;
let storePath: string;
let activeRuby: RubyHighService | null = null;

beforeEach(async () => {
  resetActivePack();
  tmpDir = await mkdtemp(join(tmpdir(), "ruby-high-test-"));
  storePath = join(tmpDir, "state.json");
  activeRuby = null;
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (activeRuby) await activeRuby.stop();
  await rm(tmpDir, { recursive: true, force: true });
});

async function makeServices() {
  const faculty = await FacultyService.start({} as never);
  const ruby = new RubyHighService({} as never, new StateStore(storePath));
  await ruby["hydrate"]();
  ruby.setFacultyService(faculty);
  activeRuby = ruby;
  return { ruby, faculty };
}

function attachTestCharacter(ruby: RubyHighService, sid: string, streakCount = 0) {
  ruby.selectGrade(sid, "9");
  const state = ruby.getOrCreate(sid);
  state.character = {
    name: "Test",
    playbookId: "lifer",
    stats: { head: 99, heart: 99, hustle: 99, honor: 99 },
    arcAnswer: "—",
    personality: "—",
    yearbook: [],
    createdAt: Date.now(),
    ...(streakCount > 0 ? { streak: { grade: "9" as const, count: streakCount, lastDate: "2026-05-04" } } : {}),
  };
  return state;
}

function completedClassRecord(
  grade: "9" | "10" | "11" | "12",
  facultyId: string,
  date: string,
  letterGrade: string,
  scoreTotal: number,
) {
  return {
    grade,
    facultyId,
    date,
    status: "complete" as const,
    questionCount: 3,
    correctCount: letterGrade === "F" ? 0 : 3,
    scoreTotal,
    scoreMax: 300,
    letterGrade,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function usePublicWorldFixtureTime(now: number): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
}

function serviceStateOnlyStore(record: StoredServiceStateRecord | StoredServiceStateRecord[]): StateStoreLike {
  const records = new Map((Array.isArray(record) ? record : [record]).map((entry) => [entry.id, entry]));
  return {
    describe: () => "service-state-only",
    load: async () => new Map(),
    loadAuth: async () => ({ users: [], sessions: [] }),
    loadPacks: async () => [],
    loadTeachers: async () => [],
    loadDraftPacks: async () => [],
    loadPackInstallations: async () => [],
    loadMetricEvents: async () => [],
    loadSchoolEvents: async () => [],
    loadServiceState: async (id) => records.get(id) ?? null,
    save: async () => undefined,
    saveSession: async () => undefined,
    saveAuthUser: async () => undefined,
    saveAuthSession: async () => undefined,
    savePack: async () => undefined,
    saveDraftPack: async () => undefined,
    savePackInstallation: async () => undefined,
    saveTeacher: async () => undefined,
    saveMetricEvent: async () => undefined,
    saveSchoolEvent: async () => undefined,
    saveServiceState: async () => undefined,
    deletePack: async () => undefined,
    deleteTeacher: async () => undefined,
    deleteDraftPack: async () => undefined,
    deletePackInstallation: async () => undefined,
    deleteAuthSession: async () => undefined,
    flush: async () => undefined,
  };
}

describe("Social Card service", () => {
  it("retries unresolved earlier fortune axes at Senior graduation", async () => {
    const { ruby } = await makeServices();
    const state = attachTestCharacter(ruby, "rh:user:senior-fortunes");
    const card = emptyMashCard();
    ["lyra", "sami", "ravi", "mika"].forEach((studentId) => {
      applyMashTick(card.cells[studentId]!, 1);
      applyMashTick(card.cells[studentId]!, 1);
    });
    state.character!.mashCard = card;

    const resolutions = ruby["resolveMashAxesForGrade"](state.character!, "12");
    expect(resolutions.map((entry) => entry.axis)).toEqual([
      "crush",
      "job",
      "lives",
      "pet",
      "money",
      "lucky",
    ]);
  });
});

describe("Hall Pass wallet", () => {
  it("starts accounts without Hall Passes and claims the welcome grant once", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:welcome";

    const state = ruby.getOrCreate(sid);
    expect(state.wallet.hallPasses).toBe(0);
    expect(state.wallet.welcomeHallPassesGrantedAt).toBeUndefined();
    expect(state.wallet.hallPassCards?.filter((card) => card.status === "active") ?? []).toHaveLength(0);

    const grant = ruby.claimWelcomeHallPasses(sid);
    expect(grant.applied).toBe(true);
    expect(grant.state.wallet.hallPasses).toBe(WELCOME_HALL_PASS_GRANT);
    expect(grant.state.wallet.welcomeHallPassesGrantedAt).toEqual(expect.any(Number));
    expect(grant.transaction).toMatchObject({
      id: WELCOME_HALL_PASS_GRANT_ID,
      kind: "hall-pass-grant",
      hallPasses: WELCOME_HALL_PASS_GRANT,
      source: "system",
      description: "Welcome Hall Passes",
      metadata: expect.objectContaining({
        reason: "hall-pass-page-welcome",
      }),
    });

    const repeatGrant = ruby.claimWelcomeHallPasses(sid);
    expect(repeatGrant.applied).toBe(false);
    expect(repeatGrant.state.wallet.hallPasses).toBe(WELCOME_HALL_PASS_GRANT);

    const repeat = ruby.getOrCreate(sid);
    expect(state.wallet.hallPasses).toBe(WELCOME_HALL_PASS_GRANT);
    expect(repeat.wallet.hallPasses).toBe(WELCOME_HALL_PASS_GRANT);
    expect((repeat.wallet.transactions ?? []).filter((tx) => tx.id === WELCOME_HALL_PASS_GRANT_ID)).toHaveLength(1);
  });

  it("applies grants and spends idempotently", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:wallet";

    const grant = ruby.grantHallPasses(sid, {
      amount: 20,
      idempotencyKey: "stripe:checkout:cs_test_1",
      source: "stripe",
    });
    expect(grant.applied).toBe(true);
    expect(grant.state.wallet.hallPasses).toBe(20);
    expect(grant.cards).toBeUndefined();
    expect(grant.state.wallet.hallPassCards?.filter((card) => card.status === "active") ?? []).toHaveLength(0);

    const repeatGrant = ruby.grantHallPasses(sid, {
      amount: 20,
      idempotencyKey: "stripe:checkout:cs_test_1",
      source: "stripe",
    });
    expect(repeatGrant.applied).toBe(false);
    expect(repeatGrant.state.wallet.hallPasses).toBe(20);
    expect(repeatGrant.cards).toBeUndefined();

    const spend = ruby.spendHallPasses(sid, {
      amount: 3,
      idempotencyKey: "hosted-image:diploma:test",
      source: "hosted-image",
    });
    expect(spend.applied).toBe(true);
    expect(spend.state.wallet.hallPasses).toBe(17);
    expect(spend.cards).toBeUndefined();
    expect(spend.transaction.metadata).toBeUndefined();
    expect(spend.state.wallet.hallPassCards?.filter((card) => card.status === "active") ?? []).toHaveLength(0);

    const repeatSpend = ruby.spendHallPasses(sid, {
      amount: 3,
      idempotencyKey: "hosted-image:diploma:test",
      source: "hosted-image",
    });
    expect(repeatSpend.applied).toBe(false);
    expect(repeatSpend.state.wallet.hallPasses).toBe(17);
    expect(repeatSpend.cards).toBeUndefined();
    expect(() => ruby.spendHallPasses(sid, {
      amount: 23,
      idempotencyKey: "hosted-image:portrait:too-many",
      source: "hosted-image",
    })).toThrow(/Not enough Hall Passes/);
  });

  it("persists reversal debt and settles it before exposing future grants", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:wallet-reversal-debt";

    ruby.grantHallPasses(sid, {
      amount: 5,
      idempotencyKey: "stripe:checkout:debt-test",
      source: "stripe",
    });
    ruby.spendHallPasses(sid, {
      amount: 5,
      idempotencyKey: "hosted-image:debt-test",
      source: "hosted-image",
    });
    const reversal = ruby.revokeHallPasses(sid, {
      amount: 5,
      idempotencyKey: "stripe:refund:debt-test",
      source: "stripe",
    });

    expect(reversal.transaction.hallPasses).toBe(-5);
    expect(reversal.state.wallet).toMatchObject({ hallPasses: 0, hallPassDebt: 5 });
    expect(() => ruby.spendHallPasses(sid, {
      amount: 1,
      idempotencyKey: "hosted-image:while-in-debt",
      source: "hosted-image",
    })).toThrow(/Not enough Hall Passes/);

    ruby.grantHallPasses(sid, {
      amount: 7,
      idempotencyKey: "stripe:checkout:after-debt",
      source: "stripe",
    });
    expect(ruby.getOrCreate(sid).wallet.hallPasses).toBe(2);
    expect(ruby.getOrCreate(sid).wallet.hallPassDebt ?? 0).toBe(0);
  });

  it("spends Merit Stars idempotently", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:merit-stars";

    const grant = ruby.grantMeritStars(sid, {
      amount: 3,
      idempotencyKey: "test:stars:grant",
      source: "admin",
    });
    expect(grant.applied).toBe(true);
    expect(grant.state.wallet.meritStars).toBe(3);

    const spend = ruby.spendMeritStars(sid, {
      amount: 1,
      idempotencyKey: "chat:test:turn-1",
      source: "chat",
      description: "Classroom chat",
    });
    expect(spend.applied).toBe(true);
    expect(spend.state.wallet.meritStars).toBe(2);
    expect(spend.transaction).toMatchObject({
      kind: "merit-star-spend",
      meritStars: -1,
      source: "chat",
    });

    const repeatSpend = ruby.spendMeritStars(sid, {
      amount: 1,
      idempotencyKey: "chat:test:turn-1",
      source: "chat",
    });
    expect(repeatSpend.applied).toBe(false);
    expect(repeatSpend.state.wallet.meritStars).toBe(2);

    expect(() => ruby.spendMeritStars(sid, {
      amount: 3,
      idempotencyKey: "chat:test:too-many",
      source: "chat",
    })).toThrow(/Not enough Merit Stars/);
  });

  it("records owner-signed NFT card burns as exact card spends", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:nft-burn";
    const ownerWalletAddress = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
    const mintAddress = "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump";
    const grant = ruby.grantHallPassCards(sid, {
      cardCount: 4,
      idempotencyKey: "stripe:checkout:nft-burn",
      source: "stripe",
    });
    const card = grant.cards![0]!;
    ruby.recordHallPassCardMint(sid, {
      cardId: card.id,
      ownerWalletAddress,
      mintAddress,
      mintSignature: "5mMintSignature111111111111111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/card.json",
    });

    const spend = ruby.spendBurnedHallPassCards(sid, {
      burns: [{
        cardId: card.id,
        ownerWalletAddress,
        mintAddress,
        burnSignature: "4mBurnSignature111111111111111111111111111111111111111111111",
      }],
      idempotencyKey: "hosted-ai:nft-burn",
      source: "hosted-ai",
      description: "Server AI",
    });

    expect(spend.applied).toBe(true);
    expect(spend.state.wallet.hallPasses).toBe(0);
    expect(spend.cards).toHaveLength(1);
    expect(spend.transaction).toMatchObject({
      kind: "hall-pass-spend",
      hallPasses: -1,
      source: "hosted-ai",
    });
    expect(spend.transaction.metadata).toMatchObject({
      burnSignature: "4mBurnSignature111111111111111111111111111111111111111111111",
      hallPassCardIds: card.id,
    });
    const burned = spend.state.wallet.hallPassCards?.find((candidate) => candidate.id === card.id);
    expect(burned).toMatchObject({
      status: "redeemed",
      burnSignature: "4mBurnSignature111111111111111111111111111111111111111111111",
      redeemTransactionId: "hosted-ai:nft-burn",
    });
    const repeat = ruby.spendBurnedHallPassCards(sid, {
      burns: [{
        cardId: card.id,
        ownerWalletAddress,
        mintAddress,
        burnSignature: "4mBurnSignature111111111111111111111111111111111111111111111",
      }],
      idempotencyKey: "hosted-ai:nft-burn",
      source: "hosted-ai",
    });
    expect(repeat.applied).toBe(false);
    expect(() => ruby.spendBurnedHallPassCards(sid, {
      burns: [{
        cardId: card.id,
        ownerWalletAddress,
        mintAddress,
        burnSignature: "5mDifferentBurn111111111111111111111111111111111111111111",
      }],
      idempotencyKey: "hosted-ai:nft-burn-again",
      source: "hosted-ai",
    })).toThrow(/already burned/);
  });

  it("rejects replaying one on-chain card NFT as a different in-app card", async () => {
    const { ruby } = await makeServices();
    const ownerWalletAddress = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
    const mintAddress = "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump";
    const first = ruby.grantHallPassCards("rh:user:first-card-owner", {
      cardCount: 1,
      idempotencyKey: "grant:first-card-owner",
      source: "solana",
    }).cards![0]!;
    const second = ruby.grantHallPassCards("rh:user:second-card-owner", {
      cardCount: 1,
      idempotencyKey: "grant:second-card-owner",
      source: "solana",
    }).cards![0]!;
    ruby.recordHallPassCardMint("rh:user:first-card-owner", {
      cardId: first.id,
      ownerWalletAddress,
      mintAddress,
      mintSignature: "5mSharedMintSignature11111111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/card.json",
    });

    expect(() => ruby.recordHallPassCardMint("rh:user:second-card-owner", {
      cardId: second.id,
      ownerWalletAddress,
      mintAddress,
      mintSignature: "5mSharedMintSignature11111111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/card.json",
    })).toThrow(/already been recorded/);
  });

  it("persists card mint recovery and reveal retry markers across restarts", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:nft-mint-recovery-persistence";
    const ownerWalletAddress = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
    const mintAddress = "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump";
    const metadataUri = "https://ruby-high.ai/card-recovery.json";
    const mintSignature = "5mPersistentMintSignature111111111111111111111111111111111";
    const card = ruby.grantHallPassCards(sid, {
      cardCount: 1,
      idempotencyKey: "solana:card-mint-recovery-persistence",
      source: "solana",
    }).cards![0]!;
    ruby.recordHallPassCardMintPreparation(sid, {
      cardId: card.id,
      ownerWalletAddress,
      mintAddress,
      metadataUri,
      transactionMessageHash: "persistent-transaction-message-hash",
    });
    ruby.recordHallPassCardMintSubmission(sid, {
      cardId: card.id,
      ownerWalletAddress,
      mintAddress,
      metadataUri,
      mintSignature,
    });
    await ruby.flushSession(sid);
    await ruby.stop();
    activeRuby = null;

    const restored = new RubyHighService({} as never, new StateStore(storePath));
    await restored["hydrate"]();
    activeRuby = restored;
    expect(restored.mintableHallPassCards(sid)[0]).toMatchObject({
      id: card.id,
      pendingMintAddress: mintAddress,
      pendingMintSignature: mintSignature,
      pendingMintSubmittedAt: expect.any(Number),
    });

    restored.recordHallPassCardMint(sid, {
      cardId: card.id,
      ownerWalletAddress,
      mintAddress,
      mintSignature,
      metadataUri,
    });
    await restored.flushSession(sid);
    await restored.stop();
    activeRuby = null;

    const restoredAgain = new RubyHighService({} as never, new StateStore(storePath));
    await restoredAgain["hydrate"]();
    activeRuby = restoredAgain;
    expect(restoredAgain.pendingHallPassCardReveals(sid, ownerWalletAddress)).toEqual([
      expect.objectContaining({
        id: card.id,
        mintAddress,
        mintSignature,
        onChainRevealPending: true,
      }),
    ]);
  });

  it("records multiple NFT card burns from one owner-signed transaction", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:nft-burn-batch";
    const ownerWalletAddress = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
    const burnSignature = "4mBatchBurnSignature1111111111111111111111111111111111111111";
    const grant = ruby.grantHallPassCards(sid, {
      cardCount: 4,
      idempotencyKey: "stripe:checkout:nft-burn-batch",
      source: "stripe",
    });
    const cards = grant.cards!.slice(0, 2);
    const burns = cards.map((card, index) => {
      const mintAddress = index === 0
        ? "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump"
        : "BBoP7Eav3vUrF7kvQRrUMr7BXPr4u4D2nPWn84bWpump";
      ruby.recordHallPassCardMint(sid, {
        cardId: card.id,
        ownerWalletAddress,
        mintAddress,
        mintSignature: `5mMintSignatureBatch${index}111111111111111111111111111111111111`,
        metadataUri: "https://ruby-high.ai/card.json",
      });
      return {
        cardId: card.id,
        ownerWalletAddress,
        mintAddress,
        burnSignature,
      };
    });
    const before = ruby.getOrCreate(sid).wallet.hallPasses;

    const spend = ruby.spendBurnedHallPassCards(sid, {
      burns,
      idempotencyKey: "hosted-image:diploma:nft-burn-batch",
      source: "hosted-image",
      description: "Diploma Photo",
    });

    expect(spend.applied).toBe(true);
    expect(spend.state.wallet.hallPasses).toBe(before);
    expect(spend.cards).toHaveLength(2);
    expect(spend.state.wallet.hallPassCards?.filter((card) => card.status === "redeemed")).toHaveLength(2);
    expect(spend.transaction.metadata?.burnSignatures).toBe(`${burnSignature},${burnSignature}`);
  });

  it("converts owner-signed NFT card burns into Hall Passes", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:nft-burn-convert";
    const ownerWalletAddress = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
    const mintAddress = "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump";
    const grant = ruby.grantHallPassCards(sid, {
      cardCount: 1,
      idempotencyKey: "solana:pack:nft-burn-convert",
      source: "solana",
    });
    const card = grant.cards![0]!;
    ruby.recordHallPassCardMint(sid, {
      cardId: card.id,
      ownerWalletAddress,
      mintAddress,
      mintSignature: "5mMintSignatureConvert111111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/card.json",
    });

    const converted = ruby.convertBurnedHallPassCardsToHallPasses(sid, {
      burns: [{
        cardId: card.id,
        ownerWalletAddress,
        mintAddress,
        burnSignature: "4mBurnSignatureConvert111111111111111111111111111111111111",
      }],
      idempotencyKey: "hall-pass-card-burn:convert",
      source: "hall-pass-card",
    });

    expect(converted.applied).toBe(true);
    expect(converted.state.wallet.hallPasses).toBe(5);
    expect(converted.transaction).toMatchObject({
      kind: "hall-pass-card-burn",
      hallPasses: 5,
      source: "hall-pass-card",
    });
    expect(converted.transaction.metadata).toMatchObject({
      cardBurnConversion: true,
      hallPassesPerCard: 5,
      hallPassCardIds: card.id,
    });
    expect(converted.state.wallet.hallPassCards?.find((candidate) => candidate.id === card.id)).toMatchObject({
      status: "redeemed",
      redeemTransactionId: "hall-pass-card-burn:convert",
    });
  });

  it("credits burned card value before spending for legacy hosted AI activation", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:nft-burn-hosted-ai";
    const ownerWalletAddress = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
    const mintAddress = "ABHQGzXNoRbJ1sjUsCJ2TmTAo1uMx4EUpV1qYiSVpump";
    const grant = ruby.grantHallPassCards(sid, {
      cardCount: 1,
      idempotencyKey: "solana:pack:nft-burn-hosted-ai",
      source: "solana",
    });
    const card = grant.cards![0]!;
    ruby.recordHallPassCardMint(sid, {
      cardId: card.id,
      ownerWalletAddress,
      mintAddress,
      mintSignature: "5mMintSignatureHostedAi11111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/card.json",
    });

    const activated = ruby.activateHostedAiAccess(sid, {
      hallPassCost: 1,
      durationMs: 604_800_000,
      burns: [{
        cardId: card.id,
        ownerWalletAddress,
        mintAddress,
        burnSignature: "4mBurnSignatureHostedAi11111111111111111111111111111111111",
      }],
    });

    expect(activated.applied).toBe(true);
    expect(activated.state.wallet.hallPasses).toBe(4);
    expect(activated.transaction).toMatchObject({
      kind: "hall-pass-spend",
      hallPasses: -1,
      source: "hosted-ai",
    });
    const transactions = activated.state.wallet.transactions ?? [];
    expect(transactions.some((tx) =>
      tx.kind === "hall-pass-card-burn" &&
      tx.hallPasses === 5 &&
      tx.metadata?.hallPassesPerCard === 5 &&
      tx.metadata?.hallPassCardIds === card.id
    )).toBe(true);
  });

  it("keeps wallet idempotency after the visible transaction list rotates", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:wallet-ledger";

    ruby.grantHallPasses(sid, {
      amount: 20,
      idempotencyKey: "stripe:checkout:old",
      source: "stripe",
    });
    for (let i = 0; i < 205; i++) {
      ruby.grantHallPasses(sid, {
        amount: 1,
        idempotencyKey: `admin:grant:${i}`,
        source: "admin",
      });
    }
    expect(ruby.getOrCreate(sid).wallet.transactions?.some((tx) => tx.id === "stripe:checkout:old")).toBe(false);
    expect(ruby.hallPassBalance(sid)).toBe(225);

    await ruby.flush();
    const rehydrated = new RubyHighService({} as never, new StateStore(storePath));
    await rehydrated["hydrate"]();
    activeRuby = rehydrated;
    const repeat = rehydrated.grantHallPasses(sid, {
      amount: 20,
      idempotencyKey: "stripe:checkout:old",
      source: "stripe",
    });

    expect(repeat.applied).toBe(false);
    expect(repeat.state.wallet.hallPasses).toBe(225);
  });

  it("packs three students, one teacher, and one utility or special card into each Hall Pass set", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:super-rare-cards";

    const grant = ruby.grantHallPassCards(sid, {
      cardCount: 25,
      idempotencyKey: "admin:grant:super-2",
      source: "admin",
    });

    expect(grant.cards).toHaveLength(25);
    for (let i = 0; i < (grant.cards?.length ?? 0); i += HALL_PASS_CARDS_PER_PACK) {
      const pack = grant.cards!.slice(i, i + HALL_PASS_CARDS_PER_PACK);
      expect(pack.filter((card) => card.role === "student")).toHaveLength(3);
      expect(pack.filter((card) => card.role === "teacher")).toHaveLength(1);
      expect(pack.filter((card) => card.role === "item" || card.role === "location" || card.role === "special")).toHaveLength(1);
    }
    expect(grant.cards?.filter((card) => card.rarity === "ultra-rare").length).toBeGreaterThanOrEqual(1);
    expect(grant.cards?.some((card) => card.characterId === "captain-null" && card.role === "special")).toBe(true);
    expect(grant.cards?.find((card) => card.characterId === "mika")?.rarity).toBe("rare");
  });

  it("opens a recorded Pack NFT into deterministic in-app cards", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:open-pack";
    const ownerWalletAddress = "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY";
    const recorded = ruby.recordHallPassPackMint(sid, {
      productId: "card-pack-1",
      packCount: 1,
      cardCount: HALL_PASS_CARDS_PER_PACK,
      ownerWalletAddress,
      assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
      mintSignature: "5mPackMintSignature111111111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/api/apps/ruby-high/nft/metadata/core/pack/card-pack-1/123456.json?packs=1&cards=5",
      idempotencyKey: "solana:spl-token-transfer:pack-open",
      source: "solana",
    });

    expect(recorded.pack?.serial).toBe(123456);
    expect(recorded.pack).toMatchObject({
      packRevealVersion: "ruby-high-pack-reveal-v1.2",
      catalogHash: expect.any(String),
      commitment: expect.any(String),
      entropySource: "ruby-high-server-commit-v1",
    });
    const opened = ruby.openHallPassPack(sid, {
      packId: recorded.pack!.id,
      ownerWalletAddress,
    });

    expect(opened.applied).toBe(true);
    expect(opened.cards).toHaveLength(HALL_PASS_CARDS_PER_PACK);
    expect(opened.pack).toMatchObject({
      status: "opened",
      openTransactionId: `hall-pass-pack-open:${recorded.pack!.id}`,
      packRevealVersion: "ruby-high-pack-reveal-v1.2",
      catalogHash: recorded.pack!.catalogHash,
      commitment: recorded.pack!.commitment,
      entropySource: "ruby-high-server-commit-v1",
      revealSeed: expect.any(String),
      revealTransaction: `hall-pass-pack-open:${recorded.pack!.id}`,
    });
    expect(opened.transaction).toMatchObject({
      kind: "hall-pass-pack-open",
      source: "hall-pass-pack",
      metadata: {
        packId: recorded.pack!.id,
        cardCount: HALL_PASS_CARDS_PER_PACK,
        hallPassCardCount: HALL_PASS_CARDS_PER_PACK,
        packRevealVersion: "ruby-high-pack-reveal-v1.2",
        catalogHash: recorded.pack!.catalogHash,
        commitment: recorded.pack!.commitment,
        entropySource: "ruby-high-server-commit-v1",
        revealSeed: opened.pack!.revealSeed,
      },
    });
    expect(opened.cards?.filter((card) => card.role === "student")).toHaveLength(3);
    expect(new Set(opened.cards?.filter((card) => card.role === "student").map((card) => card.characterId)).size).toBe(3);
    expect(opened.cards?.filter((card) => card.role === "teacher")).toHaveLength(1);
    expect(opened.cards?.filter((card) => card.role === "item" || card.role === "location" || card.role === "special")).toHaveLength(1);
    expect(opened.cards?.[0]).toMatchObject({
      setName: FIRST_BELL_SET_NAME,
      setCode: FIRST_BELL_SET_CODE,
      setNumber: expect.stringMatching(/^FB-\d{3}$/),
      profileId: expect.any(String),
      cardName: expect.any(String),
      subject: expect.any(String),
      packRevealVersion: "ruby-high-pack-reveal-v1.2",
      catalogHash: recorded.pack!.catalogHash,
      commitment: recorded.pack!.commitment,
      entropySource: "ruby-high-server-commit-v1",
      revealSeed: opened.pack!.revealSeed,
      revealProof: expect.any(String),
      packAssetAddress: recorded.pack!.assetAddress,
      revealTransaction: `hall-pass-pack-open:${recorded.pack!.id}`,
    });

    const repeat = ruby.openHallPassPack(sid, {
      packId: recorded.pack!.id,
      ownerWalletAddress,
    });
    expect(repeat.applied).toBe(false);
    expect(repeat.cards).toHaveLength(HALL_PASS_CARDS_PER_PACK);
    expect(ruby.getOrCreate(sid).wallet.hallPassCards).toHaveLength(HALL_PASS_CARDS_PER_PACK);
  });

  it("guarantees one Ultra Rare special in every complete five-pack block", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:ten-pack";
    const recorded = ruby.recordHallPassPackMint(sid, {
      productId: "card-pack-10",
      packCount: 10,
      cardCount: HALL_PASS_CARDS_PER_PACK * 10,
      ownerWalletAddress: "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY",
      assetAddress: "GMDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4Q",
      mintSignature: "5mTenPackMintSignature111111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/packs/ten.json",
      idempotencyKey: "solana:ten-pack",
    });
    const opened = ruby.openHallPassPack(sid, { packId: recorded.pack!.id });

    expect(opened.cards).toHaveLength(50);
    for (let packIndex = 0; packIndex < 10; packIndex += 1) {
      const pack = opened.cards!.slice(packIndex * 5, packIndex * 5 + 5);
      const students = pack.filter((card) => card.role === "student");
      expect(new Set(students.map((card) => card.characterId)).size).toBe(3);
    }
    expect(opened.cards?.[24]?.rarity).toBe("ultra-rare");
    expect(opened.cards?.[49]?.rarity).toBe("ultra-rare");
  });

  it("keeps legacy unopened packs on their original reveal version", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:legacy-pack";
    const recorded = ruby.recordHallPassPackMint(sid, {
      productId: "card-pack-1",
      packCount: 1,
      cardCount: HALL_PASS_CARDS_PER_PACK,
      ownerWalletAddress: "1cfpmRU4oriteHQ9vPEN1GGuvTGuHiuX7MQCotKnHxY",
      assetAddress: "7MDKdHw2uSDroARQfGoZvZHWVYj6x8C1Qekn1NLu7D4R",
      mintSignature: "5mLegacyPackMintSignature111111111111111111111111111111111",
      metadataUri: "https://ruby-high.ai/packs/legacy.json",
      idempotencyKey: "solana:legacy-pack",
    });
    const storedPack = ruby.getOrCreate(sid).wallet.hallPassPacks?.[0];
    if (!storedPack) throw new Error("Legacy pack was not recorded.");
    storedPack.packRevealVersion = HALL_PASS_PACK_REVEAL_LEGACY_VERSION;
    storedPack.catalogHash = hallPassCatalogHash(HALL_PASS_PACK_REVEAL_LEGACY_VERSION);

    const opened = ruby.openHallPassPack(sid, { packId: recorded.pack!.id });
    expect(opened.cards).toHaveLength(5);
    expect(opened.cards?.every((card) => card.packRevealVersion === HALL_PASS_PACK_REVEAL_LEGACY_VERSION)).toBe(true);
  });

  it("does not backfill legacy Hall Pass balances into mintable cards", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:legacy-card-balance";
    const state = ruby.getOrCreate(sid);
    state.wallet = {
      meritStars: 0,
      hallPasses: 7,
      welcomeHallPassesGrantedAt: 123,
      transactions: [{
        id: "legacy:grant",
        kind: "hall-pass-grant",
        at: 123,
        hallPasses: 7,
        source: "stripe",
        description: "Legacy card balance",
      }],
    };
    await ruby.flushSession(sid);

    const reloaded = new RubyHighService({} as never, new StateStore(storePath));
    await reloaded["hydrate"]();
    const wallet = reloaded.getOrCreate(sid).wallet;
    expect(wallet.hallPasses).toBe(7);
    expect(wallet.hallPassCards?.filter((card) => card.status === "active") ?? []).toHaveLength(0);
    await reloaded.stop();
  });

  it("unlocks character slots for one Hall Pass and grants a Photo Day credit", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:slots";
    ruby.claimWelcomeHallPasses(sid);

    const unlock = ruby.unlockCharacterSlot(sid, { requestId: "slot-2", now: 1_700_000_000_000 });
    expect(unlock.applied).toBe(true);
    expect(unlock.state.wallet.hallPasses).toBe(4);
    expect(unlock.slots).toEqual({ unlockedSlots: 2, photoDayCredits: 1 });
    expect(unlock.transaction).toMatchObject({
      kind: "hall-pass-spend",
      hallPasses: -1,
      source: "character-slot",
      description: "Character slot 2",
    });

    const repeat = ruby.unlockCharacterSlot(sid, { requestId: "slot-2", now: 1_700_000_000_000 });
    expect(repeat.applied).toBe(false);
    expect(repeat.state.wallet.hallPasses).toBe(4);
    expect(repeat.slots).toEqual({ unlockedSlots: 2, photoDayCredits: 1 });

    ruby.resetSession(sid);
    const afterReset = ruby.getOrCreate(sid);
    expect(afterReset.wallet.hallPasses).toBe(4);
    expect((afterReset.wallet.transactions ?? []).filter((tx) => tx.id === WELCOME_HALL_PASS_GRANT_ID)).toHaveLength(1);
    expect(afterReset.characterSlots).toEqual({ unlockedSlots: 2, photoDayCredits: 1 });
  });

  it("spends and refunds Photo Day credits idempotently", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:photo-day";

    ruby.claimWelcomeHallPasses(sid);
    ruby.unlockCharacterSlot(sid, { requestId: "slot-2", now: 1_700_000_000_000 });
    const spend = ruby.consumePhotoDayCredit(sid, {
      idempotencyKey: "photo-day:portrait-1",
      source: "photo-day",
      description: "Photo Day character portrait",
    });
    expect(spend.applied).toBe(true);
    expect(spend.slots.photoDayCredits).toBe(0);
    expect(spend.state.wallet.hallPasses).toBe(4);
    expect(spend.transaction).toMatchObject({
      kind: "photo-day-spend",
      photoDayCredits: -1,
      source: "photo-day",
    });

    const repeatSpend = ruby.consumePhotoDayCredit(sid, {
      idempotencyKey: "photo-day:portrait-1",
      source: "photo-day",
    });
    expect(repeatSpend.applied).toBe(false);
    expect(repeatSpend.slots.photoDayCredits).toBe(0);

    const refund = ruby.refundPhotoDayCredit(sid, {
      idempotencyKey: "photo-day:portrait-1:refund",
      source: "photo-day",
    });
    expect(refund.applied).toBe(true);
    expect(refund.slots.photoDayCredits).toBe(1);
    expect(refund.transaction).toMatchObject({
      kind: "photo-day-refund",
      photoDayCredits: 1,
      source: "photo-day",
    });
  });
});

function fakeAnkiPackWithSally(id = "anki:vocab-test", questionId = "vocab-q1"): ContentPack {
  return {
    id,
    name: "VOCAB",
    description: "Imported vocabulary deck",
    version: "1.0.0",
    faculty: [{
      id: "vocab-test-course",
      displayName: "Sally Science",
      shortName: "Sally",
      assetTeacherId: "sally-science",
      subjects: ["vocab"],
      bio: "Sally teaching an imported deck.",
      accent: "#3aa3e0",
      systemPrompt: "You are Sally Science teaching the imported VOCAB deck.",
      defaultModel: DEFAULT_OPENROUTER_MODEL,
      questions: [{
        id: questionId,
        prompt: "What does ephemeral mean?",
        options: { A: "short-lived", B: "loud", C: "ancient", D: "careful" },
        correct: "A",
        explanation: "Ephemeral means short-lived.",
        subject: "vocab",
        difficulty: "medium",
        faculty: "vocab-test-course",
      }],
    }],
    courses: [{
      id: "vocab-test-course",
      title: "VOCAB",
      facultyId: "vocab-test-course",
      roomId: "vocab-test-room",
      teacherTemplateId: "sally-science",
      subjects: ["vocab"],
    }],
    rooms: [{
      id: "vocab-test-room",
      name: "VOCAB",
      channelName: "vocab",
      teacherId: "vocab-test-course",
      description: "Imported vocabulary deck",
      teaches: true,
    }],
  };
}

describe("imported pack persistence", () => {
  it("cleans abandoned empty private drafts at startup", async () => {
    const old = Date.now() - 60 * 60 * 1000;
    await new StateStore(storePath).saveDraftPack({
      id: "draft-abandoned-empty",
      ownerUserId: "inactive-owner",
      ownerSessionId: "rh:user:inactive-owner",
      name: "Untitled Content Pack",
      description: "",
      visibility: "private",
      teachers: [],
      createdAt: old,
      updatedAt: old,
    });

    const { ruby } = await makeServices();
    expect(await ruby.listDraftPackRecords()).toEqual([]);
    await ruby.flush();
    expect(await new StateStore(storePath).loadDraftPacks()).toEqual([]);
  });

  it("migrates legacy private creator packs out of the global registry", async () => {
    const ownerSessionId = "rh:user:private-pack-owner";
    const pack = fakeAnkiPackWithSally("pack:legacy-private-course", "legacy-private-q");
    const now = Date.now();
    await new StateStore(storePath).savePack({
      pack,
      ownerSessionId: null,
      creatorUserId: "private-pack-owner",
      courseSlot: {
        id: "slot-legacy-private-course",
        ownerUserId: "private-pack-owner",
        ownerSessionId,
        draftId: "draft-legacy-private-course",
        shareSlug: "legacy-private-course",
        visibility: "private",
        status: "published",
        walletTransactionId: "wallet-legacy-private-course",
        createdAt: now,
        updatedAt: now,
        packId: pack.id,
        publishedAt: now,
      },
      touchedAt: now,
    });

    const { ruby } = await makeServices();
    expect(getPackByIdForSession(pack.id, null)).toBeNull();
    expect(getPackByIdForSession(pack.id, ownerSessionId)?.id).toBe(pack.id);
    expect(publicCreatorPacks().map((entry) => entry.id)).not.toContain(pack.id);

    await ruby.flush();
    const stored = (await new StateStore(storePath).loadPacks())
      .filter((entry) => entry.pack.id === pack.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ ownerSessionId, visibility: "private" });
  });

  it("does not let a persisted global built-in snapshot override bundled question assets", async () => {
    const staleOriginal: ContentPack = {
      ...fakeAnkiPackWithSally("ruby-high-original", "stale-global-q"),
      name: "Stale Ruby High",
      faculty: [
        {
          ...fakeAnkiPackWithSally("stale-ruby", "stale-ruby-q").faculty[0]!,
          id: "ruby",
          questions: [fakeAnkiPackWithSally("stale-ruby", "stale-ruby-q").faculty[0]!.questions[0]!],
        },
      ],
    };
    await new StateStore(storePath).savePack({
      pack: staleOriginal,
      ownerSessionId: "__ruby_high_global__",
      touchedAt: 1,
    });

    const { ruby, faculty } = await makeServices();
    expect(getLoadedPack().name).toBe("Ruby High");
    expect(faculty.bank("ruby")?.questions.length).toBeGreaterThanOrEqual(200);
    expect(faculty.bank("sally-science")?.questions.length).toBeGreaterThanOrEqual(200);
    expect(faculty.bank("professor-edward")?.questions.length).toBeGreaterThanOrEqual(200);

    await ruby.flush();
    const persisted = await new StateStore(storePath).loadPacks();
    expect(persisted.some((record) =>
      record.ownerSessionId === "__ruby_high_global__" && record.pack.id === "ruby-high-original")).toBe(false);
  });

  it("prunes persisted imported packs to the same per-owner cap as the registry", async () => {
    const { ruby } = await makeServices();
    const sid = "rh:user:packs";
    const now = vi.spyOn(Date, "now");

    for (let i = 0; i < MAX_PACKS_PER_OWNER + 2; i++) {
      const touchedAt = 10_000 + i;
      const pack = fakeAnkiPackWithSally(`anki:lru-${i}`, `lru-q-${i}`);
      now.mockReturnValue(touchedAt);
      registerPack(pack, sid, touchedAt);
      await ruby.persistImportedPack(sid, pack);
    }

    const persisted = (await new StateStore(storePath).loadPacks())
      .filter((record) => record.ownerSessionId === sid)
      .map((record) => record.pack.id)
      .sort();
    expect(persisted).toHaveLength(MAX_PACKS_PER_OWNER);
    expect(persisted).not.toContain("anki:lru-0");
    expect(persisted).not.toContain("anki:lru-1");
    expect(persisted).toContain(`anki:lru-${MAX_PACKS_PER_OWNER + 1}`);
  });
});

function fakeAnkiSourcePack(id = "anki:vocab-source", cardId = "anki-vocab-card-1"): ContentPack {
  return {
    id,
    name: "VOCAB Source",
    description: "Imported vocabulary source-card deck",
    version: "1.0.0",
    faculty: [{
      id: "vocab-source-course",
      displayName: "Sally Science",
      shortName: "Sally",
      assetTeacherId: "sally-science",
      subjects: ["vocab"],
      bio: "Sally teaching imported source cards.",
      accent: "#3aa3e0",
      systemPrompt: "You are Sally Science teaching imported source cards.",
      defaultModel: DEFAULT_OPENROUTER_MODEL,
      questions: [],
      sourceCards: [{
        id: cardId,
        kind: "basic",
        front: "What does ephemeral mean?",
        back: "short-lived",
        acceptedAnswers: ["short-lived", "brief"],
        deckName: "VOCAB Source",
        tags: ["vocab"],
        subject: "vocab",
        difficulty: "medium",
        faculty: "vocab-source-course",
      }],
    }],
    courses: [{
      id: "vocab-source-course",
      title: "VOCAB Source",
      facultyId: "vocab-source-course",
      roomId: "vocab-source-room",
      teacherTemplateId: "sally-science",
      subjects: ["vocab"],
    }],
    rooms: [{
      id: "vocab-source-room",
      name: "VOCAB Source",
      channelName: "vocab-source",
      teacherId: "vocab-source-course",
      description: "Imported vocabulary source-card deck",
      teaches: true,
    }],
  };
}

function fakeGeneratedAnkiPack(id = "anki:generated-vocab", questionId = "generated-vocab-q1"): ContentPack {
  const pack = fakeAnkiPackWithSally(id, questionId);
  pack.faculty[0] = {
    ...pack.faculty[0]!,
    id: "generated-vocab-course",
    displayName: "Dr. Vocab",
    shortName: "Vocab",
    systemPrompt: "You are Dr. Vocab teaching an imported deck.",
    questions: [{
      ...pack.faculty[0]!.questions[0]!,
      id: questionId,
      faculty: "generated-vocab-course",
    }],
  };
  delete pack.faculty[0]!.assetTeacherId;
  pack.courses![0] = {
    id: "generated-vocab-course",
    title: "Generated Vocab",
    facultyId: "generated-vocab-course",
    roomId: "generated-vocab-room",
    subjects: ["vocab"],
  };
  pack.rooms[0] = {
    id: "generated-vocab-room",
    name: "Generated Vocab",
    channelName: "generated-vocab",
    teacherId: "generated-vocab-course",
    description: "Generated imported vocabulary deck",
    teaches: true,
  };
  return pack;
}

function fakeLeveledPack(id = "pack:level-test"): ContentPack {
  return {
    id,
    name: "Leveled Test",
    description: "Small built-in-style pack with easy/medium/hard questions",
    version: "1.0.0",
    faculty: [{
      id: "level-test-course",
      displayName: "Ruby",
      shortName: "Ruby",
      assetTeacherId: "ruby",
      subjects: ["leveling"],
      bio: "A tiny level-gated bank.",
      accent: "#d22a2a",
      systemPrompt: "You are Ruby testing level-gated picks.",
      defaultModel: DEFAULT_OPENROUTER_MODEL,
      questions: [
        {
          id: "level-easy",
          prompt: "Easy?",
          options: { A: "yes", B: "no", C: "maybe", D: "later" },
          correct: "A",
          subject: "leveling",
          difficulty: "easy",
          faculty: "level-test-course",
        },
        {
          id: "level-medium",
          prompt: "Medium?",
          options: { A: "yes", B: "no", C: "maybe", D: "later" },
          correct: "A",
          subject: "leveling",
          difficulty: "medium",
          faculty: "level-test-course",
        },
        {
          id: "level-hard",
          prompt: "Hard?",
          options: { A: "yes", B: "no", C: "maybe", D: "later" },
          correct: "A",
          subject: "leveling",
          difficulty: "hard",
          faculty: "level-test-course",
        },
      ],
    }],
    courses: [{
      id: "level-test-course",
      title: "Leveled Test",
      facultyId: "level-test-course",
      roomId: "level-test-room",
      teacherTemplateId: "ruby",
      subjects: ["leveling"],
    }],
    rooms: [{
      id: "level-test-room",
      name: "Leveled Test",
      channelName: "level-test",
      teacherId: "level-test-course",
      description: "Test room",
      teaches: true,
    }],
  };
}

describe("RubyHighService Phase 1", () => {
  it("pickAndPose draws from the current faculty's bank", async () => {
    const { ruby } = await makeServices();
    const sid = "test:1";
    const state = ruby.pickAndPose(sid, { faculty: "sally-science", subject: "physics" });
    expect(state.current).not.toBeNull();
    expect(state.current?.faculty).toBe("sally-science");
    expect(state.current?.subject).toBe("physics");
    expect(state.askedQuestionIds).toHaveLength(1);
  });

  it("draws review cards from the current faculty's bank", async () => {
    const { ruby, faculty } = await makeServices();
    const sid = "test:2";
    ruby.selectGrade(sid, "12");
    const total = faculty.bank("ruby")!.questions.length;
    const seen = new Set<string>();
    for (let i = 0; i < Math.min(5, total); i++) {
      const s = ruby.pickAndPose(sid, { faculty: "ruby" });
      const id = s.current!.id;
      seen.add(id);
      ruby.submitAnswer(sid, s.current!.correctChoice!);
    }
    expect(seen.size).toBeGreaterThan(0);
    expect(ruby.questionBankStatus(sid, "ruby").total).toBeGreaterThanOrEqual(total);
  });

  it("weights automatic difficulty by grade instead of hard-locking one level", async () => {
    const { ruby } = await makeServices();
    const sid = "test:weighted-grade-difficulty";
    const pack = fakeLeveledPack("pack:weighted-grade-difficulty");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);

    ruby.selectGrade(sid, "11");
    vi.spyOn(Math, "random").mockReturnValue(0.99);

    const state = ruby.pickAndPose(sid, { faculty: "level-test-course" });

    expect(state.current?.difficulty).toBe("hard");
    expect(ruby.questionBankStatus(sid, "level-test-course").difficultyWeights).toEqual({
      easy: 0.1,
      medium: 0.55,
      hard: 0.35,
    });
  });

  it("keeps Freshman auto-picks on easy questions", async () => {
    const { ruby } = await makeServices();
    const sid = "test:freshman-easy-weight";
    const pack = fakeLeveledPack("pack:freshman-easy-weight");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);

    ruby.selectGrade(sid, "9");
    vi.spyOn(Math, "random").mockReturnValue(0.99);

    const state = ruby.pickAndPose(sid, { faculty: "level-test-course" });

    expect(state.current?.difficulty).toBe("easy");
    expect(ruby.questionBankStatus(sid, "level-test-course").remainingByDifficulty).toEqual({
      easy: 1,
    });
  });

  it("keeps Freshman built-in banks curated before unlocking teacher corpora", async () => {
    const { ruby, faculty } = await makeServices();
    const sid = "test:freshman-curated-core";
    ruby.selectGrade(sid, "9");

    const rubyFaculty = getLoadedPack().faculty.find((f) => f.id === "ruby")!;
    const freshmanBankTotal = rubyFaculty.questions.filter((q) => q.difficulty === "easy" && !q.minGrade).length;
    const sophomoreBankTotal = rubyFaculty.questions.filter((q) =>
      (q.difficulty === "easy" || q.difficulty === "medium") &&
      (!q.minGrade || Number(q.minGrade) <= 10)
    ).length + (rubyFaculty.sourceCards ?? []).filter((q) =>
      (q.difficulty === "easy" || q.difficulty === "medium") &&
      (!q.minGrade || Number(q.minGrade) <= 10)
    ).length;
    const oldDifficultyOnlyFreshmanTotal = faculty.bank("ruby")!.questions.filter((q) => q.difficulty === "easy").length;
    const freshmanStatus = ruby.questionBankStatus(sid, "ruby");
    expect(freshmanStatus.total).toBe(freshmanBankTotal);
    expect(freshmanStatus.total).toBeLessThan(oldDifficultyOnlyFreshmanTotal);

    ruby.selectGrade(sid, "10");
    const sophomoreStatus = ruby.questionBankStatus(sid, "ruby");
    expect(sophomoreStatus.total).toBeGreaterThan(freshmanBankTotal);
    expect(sophomoreStatus.total).toBe(sophomoreBankTotal);
  });

  it("reports curriculum coverage by grade and teacher for active characters", async () => {
    const { ruby } = await makeServices();
    const freshmanSid = "test:curriculum-coverage-freshman";
    const sophomoreSid = "test:curriculum-coverage-sophomore";
    const freshmanPack = fakeLeveledPack("pack:curriculum-coverage-freshman");
    const sophomorePack = fakeLeveledPack("pack:curriculum-coverage-sophomore");
    freshmanPack.faculty[0]!.sourceCards = [{
      id: "level-corpus-easy",
      kind: "basic",
      front: "What does a source corpus let a teacher research?",
      back: "A reusable concept base for new questions.",
      acceptedAnswers: ["A reusable concept base for new questions."],
      deckName: "level-test-corpus",
      tags: ["curriculum"],
      subject: "research",
      difficulty: "easy",
      minGrade: "10",
      faculty: "level-test-course",
    }];
    sophomorePack.faculty[0]!.sourceCards = freshmanPack.faculty[0]!.sourceCards.map((card) => ({ ...card }));
    registerPack(freshmanPack, freshmanSid);
    registerPack(sophomorePack, sophomoreSid);

    attachTestCharacter(ruby, freshmanSid);
    ruby.setActivePackForSession(freshmanSid, freshmanPack.id);
    ruby.selectGrade(freshmanSid, "9");
    const posed = ruby.pickAndPose(freshmanSid, { faculty: "level-test-course" });
    ruby.submitAnswer(freshmanSid, posed.current!.correctChoice!);
    ruby.getOrCreate(freshmanSid).history.push({
      questionId: posed.current!.id,
      picked: posed.current!.correctChoice!,
      correct: posed.current!.correctChoice!,
      wasCorrect: true,
      at: Date.now() + 1,
    });

    attachTestCharacter(ruby, sophomoreSid);
    ruby.setActivePackForSession(sophomoreSid, sophomorePack.id);
    ruby.selectGrade(sophomoreSid, "10");

    const coverage = ruby.curriculumCoverageSnapshot();
    const freshman = coverage.rows.find((row) => row.grade === "9" && row.facultyId === "level-test-course");
    const sophomore = coverage.rows.find((row) => row.grade === "10" && row.facultyId === "level-test-course");

    expect(freshman).toMatchObject({
      sessions: 1,
      totalEligibleMax: 1,
      averageSeen: 1,
      averageRemaining: 0,
      lowPoolSessions: 1,
      exhaustedSessions: 1,
      replenishment: {
        mode: "manual-curation",
        targetMinGrade: "9",
        targetDifficulty: "easy",
        recentConcepts: ["leveling"],
        weakSubjects: ["leveling"],
        repetitionPressure: 1,
      },
      repeatedAnswers: 1,
      repeatedAnswerSessions: 1,
    });
    expect(sophomore).toMatchObject({
      sessions: 1,
      totalEligibleMax: 3,
      averageSeen: 0,
      averageRemaining: 3,
      lowPoolSessions: 1,
      exhaustedSessions: 0,
      weakSubjects: ["research"],
      replenishment: {
        mode: "generate",
        targetMinGrade: "10",
        targetDifficulty: "easy",
        sourceCardCount: 1,
        focusSubjects: ["research"],
        weakSubjects: ["research"],
        sourceCardIds: ["level-corpus-easy"],
        corpusId: null,
      },
    });
    expect(sophomore?.replenishment?.promptSeed).toContain("actively researching");
    expect(sophomore?.replenishment?.researchDirective).toContain("source cards as a temporary corpus");
    expect(coverage.lowPools.map((row) => `${row.grade}:${row.facultyId}`)).toContain("9:level-test-course");
    expect(coverage.activeCharacterSessions).toBeGreaterThanOrEqual(2);

    await ruby.flush();
    const agendaState = await new StateStore(storePath).loadServiceState("ruby-high:public-world-teacher-agendas:v1");
    expect(agendaState?.data).toMatchObject({
      version: 1,
      agendas: expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/^teacher:agenda:[a-f0-9]{16}$/),
          schoolYear: expect.stringMatching(/^\d{4}-\d{4}$/),
          grade: "9",
          facultyId: "level-test-course",
          displayName: "Ruby",
          agendaKind: "curriculum-replenishment",
          mode: "manual-curation",
          executionStatus: "ready",
          executionReason: "exhausted-pool",
          nextAction: "manual-curation",
          priorityScore: 225,
          targetDifficulty: "easy",
          lowPoolSessions: 1,
          exhaustedSessions: 1,
          weakSubjects: ["leveling"],
          recentConcepts: ["leveling"],
          corpusId: null,
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^teacher:agenda:[a-f0-9]{16}$/),
          schoolYear: expect.stringMatching(/^\d{4}-\d{4}$/),
          grade: "10",
          facultyId: "level-test-course",
          displayName: "Ruby",
          agendaKind: "curriculum-replenishment",
          mode: "generate",
          executionStatus: "queued",
          executionReason: "low-pool",
          nextAction: "monitor-coverage",
          priorityScore: 25,
          targetDifficulty: "easy",
          focusSubjects: ["research"],
          weakSubjects: ["research"],
          sourcePacketIds: [],
          corpusId: null,
        }),
      ]),
    });
    expect(JSON.stringify(agendaState)).not.toContain(freshmanSid);
    expect(JSON.stringify(agendaState)).not.toContain(sophomoreSid);
    expect(JSON.stringify(agendaState)).not.toContain("A reusable concept base");
    expect(ruby.worldHealthSnapshot()).toMatchObject({
      durableTeacherAgendas: 2,
      durableTeacherAgendaLimit: 80,
      teacherAgendaExecution: {
        ready: 1,
        queued: 1,
        watching: 0,
      },
      recentTeacherAgendas: expect.arrayContaining([
        expect.objectContaining({
          executionStatus: expect.stringMatching(/^(ready|queued)$/),
          nextAction: expect.stringMatching(/^(manual-curation|monitor-coverage)$/),
          priorityScore: expect.any(Number),
        }),
      ]),
    });
  });

  it("uses Seraph's research corpus when Project 89 occupies the Guest Faculty course", async () => {
    const { ruby } = await makeServices();
    const sid = "test:project89-guest-research-corpus";
    const state = attachTestCharacter(ruby, sid);
    ruby.setGuestPackOverrideForSession(sid, PROJECT89_SIGNAL_TIMELINE_LAB_PACK_ID);
    ruby.selectGrade(sid, "10");

    const eligible = ruby["courseQuestionsFor"](state, "guest");
    state.cardMemory = {};
    for (const question of eligible.slice(0, -1)) {
      state.cardMemory[cardMemoryKey("guest", question.id)] = {
        ...defaultCardMemory("guest", question.id),
        dueAt: Date.UTC(2036, 0, 1),
      };
    }

    const guest = ruby.curriculumCoverageSnapshot().rows.find((row) =>
      row.grade === "10" && row.facultyId === "guest"
    );
    expect(guest?.replenishment).toMatchObject({
      corpusId: "seraph-project89-research-corpus",
      corpusTitle: "Seraph Project 89 Research Corpus",
      corpusPath: "assets/corpora/project89.md",
      researchInterests: expect.arrayContaining(["signal verification", "bounded intervention"]),
      sourcePackets: expect.arrayContaining([
        expect.objectContaining({ id: "seraph-source-human-ai-agency" }),
        expect.objectContaining({ id: "seraph-source-bounded-intervention" }),
      ]),
    });
  });

  it("hydrates legacy durable teacher agendas with derived execution rules", async () => {
    const now = Date.UTC(2026, 5, 16, 12);
    const store = serviceStateOnlyStore([
      {
        id: "ruby-high:public-world-teacher-agendas:v1",
        updatedAt: now,
        data: {
          version: 1,
          agendas: [
            {
              schoolYear: "2025-2026",
              termId: "2025-2026",
              grade: "10",
              facultyId: "ruby",
              displayName: "Ruby",
              agendaKind: "curriculum-replenishment",
              mode: "generate",
              targetDifficulty: "easy",
              targetNewQuestions: 12,
              lowPoolSessions: 2,
              exhaustedSessions: 1,
              repetitionPressure: 0.75,
              focusSubjects: ["algorithms"],
              weakSubjects: ["algorithms"],
              recentConcepts: ["search"],
              sourcePacketIds: ["ruby-search"],
              corpusId: "ruby",
              generatedAt: now,
              updatedAt: now,
            },
          ],
        },
      },
    ]);
    const ruby = new RubyHighService({} as never, store);
    await ruby["hydrate"]();
    activeRuby = ruby;

    expect(ruby.worldHealthSnapshot(now)).toMatchObject({
      durableTeacherAgendas: 1,
      teacherAgendaExecution: {
        ready: 1,
        queued: 0,
        watching: 0,
      },
      recentTeacherAgendas: [
        expect.objectContaining({
          executionStatus: "ready",
          executionReason: "exhausted-pool",
          nextAction: "generate-draft",
          priorityScore: 225,
        }),
      ],
    });
  });

  it("does not replace or clear a live unresolved board", async () => {
    const { ruby } = await makeServices();
    const sid = "test:live-board-lock";
    const first = ruby.pickAndPose(sid, { faculty: "ruby" });
    const firstId = first.current!.id;

    expect(() => ruby.pickAndPose(sid, { faculty: "ruby" })).toThrow(/Cannot post another question while a question is live/);
    expect(() => ruby.clearBoard(sid)).toThrow(/Cannot clear the board while a question is live/);

    ruby.submitAnswer(sid, first.current!.correctChoice!);
    const second = ruby.pickAndPose(sid, { faculty: "ruby" });
    expect(second.current!.id).not.toBe(firstId);
  });

  it("scores correct vs incorrect picks", async () => {
    const { ruby } = await makeServices();
    const sid = "test:3";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    let s = ruby.getOrCreate(sid);
    const correct = s.current!.correctChoice!;
    s = ruby.submitAnswer(sid, correct);
    expect(s.score).toMatchObject({ correct: 1, total: 1, points: 80, possible: 100 });
    expect(s.wallet).toMatchObject({ meritStars: 80, hallPasses: 0 });
    expect(s.lastReveal?.scoreAward).toMatchObject({ base: 80, multiplier: 1, points: 80, possible: 100 });
    expect(s.lastReveal?.wasCorrect).toBe(true);

    ruby.pickAndPose(sid, { faculty: "ruby" });
    s = ruby.getOrCreate(sid);
    const wrong = s.current!.correctChoice! === "A" ? "B" : "A";
    s = ruby.submitAnswer(sid, wrong);
    // Wrong answers earn no points (the dice can't pile on a miss).
    // session.points stays at the previous correct's value; possible still ticks.
    expect(s.score).toMatchObject({ correct: 1, total: 2, points: 80, possible: 200 });
    expect(s.wallet).toMatchObject({ meritStars: 80, hallPasses: 0 });
    expect(s.lastReveal?.scoreAward).toMatchObject({ base: 0, multiplier: 1, points: 0, possible: 100 });
    expect(s.lastReveal?.wasCorrect).toBe(false);
  });

  it("marks expired unanswered rounds as idleTriggered, not hard-forfeited", async () => {
    const { ruby } = await makeServices();
    const sid = "test:timeout-forfeit";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    let s = ruby.getOrCreate(sid);
    s.activeRound!.expiresAt = Date.now() - 1;

    s = ruby.getOrCreate(sid);

    // Clock expired: tickRound sets idleTriggered so the AI teacher can
    // intervene instead of hard-forfeiting immediately.
    expect(s.activeRound?.resolved).toBeFalsy();
    expect(s.activeRound?.idleTriggered).toBe(true);
    expect(s.activeRound?.player.picked).toBeNull();
    // No hard forfeit — lastReveal is untouched
    expect(s.lastReveal).toBeNull();
    expect(s.history).toHaveLength(0);
  });

  it("setFaculty accepts active faculty and rejects unknown ids", async () => {
    const { ruby } = await makeServices();
    const sid = "test:4";
    expect(ruby.setFaculty(sid, "sally-science").faculty).toBe("sally-science");
    expect(ruby.setFaculty(sid, "professor-edward").faculty).toBe("professor-edward");
    expect(() => ruby.setFaculty(sid, "no-such-teacher")).toThrow(/Unknown faculty/);
  });

  it("validates stored character image references on every write path", async () => {
    const { ruby } = await makeServices();
    const sid = "test:image-ref-guard";
    ruby.createCharacter(sid, {
      name: "Test",
      playbookId: "lifer",
      stats: { head: 1, heart: 0, hustle: 0, honor: 0 },
      arcAnswer: "keeps receipts",
      personality: "careful",
    });

    // createCharacter no portrait passed — starts undefined.

    // setPortrait validates and enqueues — rejects invalid URLs.
    expect(() => ruby.setPortrait(sid, "not-an-image")).toThrow(/portraitDataUrl must be an image data URL/i);
    expect(() => ruby.setPortrait(sid, `data:image/png;base64,${"a".repeat(280_000)}`)).toThrow(/portraitDataUrl too large/i);

    // Valid portrait is enqueued, not set directly.
    const state = ruby.setPortrait(sid, "/api/apps/ruby-high/assets/portrait/test.png");
    expect(state.character?.portraitDataUrl).toBeUndefined();
    expect(state.character?.pendingPhotos).toHaveLength(1);
    expect(state.character?.pendingPhotos![0]!.kind).toBe("portrait");
    expect(state.character?.pendingPhotos![0]!.imageUrl).toBe("/api/apps/ruby-high/assets/portrait/test.png");

    // setDiplomaImage validates size.
    expect(() => ruby.setDiplomaImage(sid, `data:image/png;base64,${"a".repeat(280_000)}`)).toThrow(/diplomaImageDataUrl too large/i);

    // Valid diploma is enqueued, not set directly.
    const diplomaState = ruby.setDiplomaImage(sid, "https://cdn.example.test/diploma.png");
    expect(diplomaState.character?.diplomaImageDataUrl).toBeUndefined();
    expect(diplomaState.character?.pendingPhotos).toHaveLength(2);

    // revealPhoto moves a photo from queue to permanent fields.
    const photoId = diplomaState.character!.pendingPhotos![1]!.photoId;
    ruby.revealPhoto(sid, photoId, "tweet-123");
    const revealed = ruby.getOrCreate(sid);
    expect(revealed.character?.diplomaImageDataUrl).toBe("https://cdn.example.test/diploma.png");
    expect(revealed.character?.pendingPhotos).toHaveLength(1);
  });

  it("keeps synthetic smoke and pacing students out of social feeds", async () => {
    const { ruby } = await makeServices();
    const today = dailyKey();
    const now = Date.now();

    const real = attachTestCharacter(ruby, "test:social-real");
    real.sessionId = "test:social-real";
    real.currentGrade = "9";
    real.character!.name = "Noor";
    real.character!.createdAt = now;
    real.character!.portraitDataUrl = "/api/apps/ruby-high/assets/portrait/noor.png";
    real.character!.dailyClasses = {
      ruby: completedClassRecord("9", "ruby", today, "A", 300),
    };
    real.character!.pendingPhotos = [{
      photoId: "photo:real",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/noor.png",
      teacherFacultyId: "ruby",
      earnedAt: now,
    }];

    const privateStudent = attachTestCharacter(ruby, "test:social-private");
    privateStudent.sessionId = "test:social-private";
    privateStudent.currentGrade = "9";
    privateStudent.character!.name = "Ari";
    privateStudent.character!.createdAt = now;
    privateStudent.character!.socialConsent = false;
    privateStudent.character!.portraitDataUrl = "/api/apps/ruby-high/assets/portrait/ari.png";
    privateStudent.character!.dailyClasses = {
      ruby: completedClassRecord("9", "ruby", today, "A", 300),
    };
    privateStudent.character!.pendingPhotos = [{
      photoId: "photo:private",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/ari.png",
      teacherFacultyId: "ruby",
      earnedAt: now - 3,
    }];

    const smoke = attachTestCharacter(ruby, "test:social-smoke");
    smoke.sessionId = "test:social-smoke";
    smoke.currentGrade = "9";
    smoke.character!.name = "Smoke mqe1pkx3";
    smoke.character!.createdAt = now;
    smoke.character!.dailyClasses = {
      ruby: completedClassRecord("9", "ruby", today, "A", 300),
    };
    smoke.character!.pendingPhotos = [{
      photoId: "photo:smoke",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/smoke.png",
      teacherFacultyId: "ruby",
      earnedAt: now - 1,
    }];

    const pacing = attachTestCharacter(ruby, "test:social-pacing");
    pacing.sessionId = "test:social-pacing";
    pacing.currentGrade = "9";
    pacing.character!.name = "Pacing mqe1pl4d";
    pacing.character!.createdAt = now;
    pacing.character!.dailyClasses = {
      ruby: completedClassRecord("9", "ruby", today, "A", 300),
    };
    pacing.character!.pendingPhotos = [{
      photoId: "photo:pacing",
      kind: "class-photo",
      imageUrl: "/api/apps/ruby-high/assets/class-photo/pacing.png",
      teacherFacultyId: "ruby",
      earnedAt: now - 2,
    }];

    const blank = attachTestCharacter(ruby, "test:social-blank");
    blank.sessionId = "test:social-blank";
    blank.currentGrade = "9";
    blank.character!.name = "   ";
    blank.character!.createdAt = now;
    blank.character!.dailyClasses = {
      ruby: completedClassRecord("9", "ruby", today, "A", 300),
    };
    blank.character!.pendingPhotos = [{
      photoId: "photo:blank",
      kind: "class-photo",
      imageUrl: "/api/apps/ruby-high/assets/class-photo/blank.png",
      teacherFacultyId: "ruby",
      earnedAt: now - 4,
    }];

    const malformedClasses = attachTestCharacter(ruby, "test:social-malformed-classes");
    malformedClasses.sessionId = "test:social-malformed-classes";
    malformedClasses.currentGrade = "9";
    malformedClasses.character!.name = "Malformed Mina";
    malformedClasses.character!.createdAt = now - 2 * 24 * 60 * 60 * 1000;
    malformedClasses.character!.dailyClasses = [null] as never;
    malformedClasses.character!.pendingPhotos = [{
      photoId: "photo:malformed-classes",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/malformed.png",
      teacherFacultyId: "ruby",
      earnedAt: now - 5,
    }];

    const memories = ruby.getDailyMemories();
    expect(memories.charactersCreated).toEqual(["Noor"]);
    expect(memories.classesPassed.map((entry) => entry.studentName)).toEqual(["Noor"]);
    expect(memories.totalStudents).toBe(2);
    expect(memories.totalQuestionsAnswered).toBe(3);

    expect(ruby.getRecentlyActiveStudents().map((student) => student.name)).toEqual(["Noor"]);
    expect(ruby.getClassPhotoCandidates()).toEqual([{
      sessionId: "test:social-real",
      name: "Noor",
      imageUrl: "/api/apps/ruby-high/assets/portrait/noor.png",
      grade: "9",
    }]);

    const snapshot = ruby.getSchoolSnapshot();
    expect(snapshot.photoPool.map((photo) => photo.studentName)).toEqual(["Noor"]);
    expect(JSON.stringify(snapshot)).not.toContain("Ari");
    expect(JSON.stringify(snapshot)).not.toContain("Smoke");
    expect(JSON.stringify(snapshot)).not.toContain("Pacing");
    expect(JSON.stringify(snapshot)).not.toContain("blank.png");
    expect(JSON.stringify(snapshot)).not.toContain("malformed.png");

    const photoId = ruby.enqueueClassPhotoReveal("ruby", "/api/apps/ruby-high/assets/class-photo/noor.png", ruby.getClassPhotoCandidates());
    expect(photoId).toMatch(/^photo:test:social-real:class-photo:/);
    expect(real.character!.pendingPhotos?.at(-1)).toMatchObject({
      photoId,
      kind: "class-photo",
      imageUrl: "/api/apps/ruby-high/assets/class-photo/noor.png",
      teacherFacultyId: "ruby",
    });
  });

  it("keeps malformed character array fields from breaking social snapshots", async () => {
    const { ruby } = await makeServices();
    const oldDate = "2026-05-01";
    const oldAt = Date.UTC(2026, 4, 1, 12);

    const state = attachTestCharacter(ruby, "test:social-malformed-arrays");
    state.sessionId = "test:social-malformed-arrays";
    state.currentGrade = "9";
    state.faculty = "ruby";
    state.character!.name = "Malformed Array Mina";
    state.character!.createdAt = oldAt;
    state.character!.dailyClasses = {
      ruby: {
        ...completedClassRecord("9", "ruby", oldDate, "A", 300),
        completedAt: oldAt,
        updatedAt: oldAt,
      },
    };
    state.character!.pendingPhotos = { length: 1 } as never;
    state.character!.classPhotos = { length: 1 } as never;
    state.character!.levelUps = { length: 1 } as never;
    state.character!.yearbook = { length: 1 } as never;
    state.schoolEvents = { length: 1 } as never;
    state.studentPool = [{
      id: "student:malformed-yearbook",
      name: "Malformed Pool Mina",
      playbookId: "check",
      stats: { heart: 0, head: 0, hustle: 0, honor: 0 },
      personality: "",
      yearbook: { length: 1 } as never,
      createdAt: oldAt,
      completedAt: oldAt,
    } as never];

    const memories = ruby.getDailyMemories();
    const snapshot = ruby.getSchoolSnapshot(Date.UTC(2026, 5, 15, 12));
    const analytics = ruby.analyticsSnapshot(Date.UTC(2026, 5, 15, 12));

    expect(memories.totalStudents).toBe(1);
    expect(memories.classesPassed).toEqual([]);
    expect(memories.gradesAdvanced).toEqual([]);
    expect(memories.graduations).toEqual([]);
    expect(memories.totalQuestionsAnswered).toBe(3);
    expect(analytics.completedGrades).toBe(0);
    expect(analytics.graduatedCharacters).toBe(0);
    expect(ruby.yearbookSharesForSession("test:social-malformed-arrays")).toEqual([]);
    expect(ruby.getSchoolWorldEvents(10, Date.UTC(2026, 5, 15, 12)).every((event) => event.id !== undefined)).toBe(true);
    expect(ruby.pendingPhotoPoolSize()).toBe(0);
    expect(ruby.getRecentlyActiveStudents(Date.UTC(2026, 5, 15, 12))).toEqual([
      expect.objectContaining({ name: "Malformed Array Mina", yearbookCount: 0 }),
    ]);
    expect(snapshot.photoPool).toEqual([]);
    expect(snapshot.classPhotoHistory).toEqual([]);
  });

  it("preflights class photo reveal targets before image generation", async () => {
    const { ruby } = await makeServices();
    const publicState = attachTestCharacter(ruby, "test:class-photo-public");
    publicState.sessionId = "test:class-photo-public";
    publicState.character!.name = "Noor";

    const privateState = attachTestCharacter(ruby, "test:class-photo-private");
    privateState.sessionId = "test:class-photo-private";
    privateState.character!.name = "Ari";
    privateState.character!.socialConsent = false;

    const syntheticState = attachTestCharacter(ruby, "test:class-photo-synthetic");
    syntheticState.sessionId = "test:class-photo-synthetic";
    syntheticState.character!.name = "Smoke mqe1pkx3";

    expect(ruby.hasClassPhotoRevealTarget([
      {
        sessionId: "test:class-photo-private",
        name: "Ari",
        imageUrl: "/api/apps/ruby-high/assets/portrait/ari.png",
        grade: "9",
      },
      {
        sessionId: "test:class-photo-synthetic",
        name: "Smoke mqe1pkx3",
        imageUrl: "/api/apps/ruby-high/assets/portrait/smoke.png",
        grade: "9",
      },
    ])).toBe(false);

    expect(ruby.hasClassPhotoRevealTarget([
      {
        sessionId: "test:class-photo-private",
        name: "Ari",
        imageUrl: "/api/apps/ruby-high/assets/portrait/ari.png",
        grade: "9",
      },
      {
        sessionId: "test:class-photo-public",
        name: "Noor",
        imageUrl: "/api/apps/ruby-high/assets/portrait/noor.png",
        grade: "9",
      },
    ])).toBe(true);

    const photoId = ruby.enqueueClassPhotoReveal("ruby", "/api/apps/ruby-high/assets/class-photo/noor.png", [
      {
        sessionId: "test:class-photo-private",
        name: "Ari",
        imageUrl: "/api/apps/ruby-high/assets/portrait/ari.png",
        grade: "9",
      },
      {
        sessionId: "test:class-photo-public",
        name: "Noor",
        imageUrl: "/api/apps/ruby-high/assets/portrait/noor.png",
        grade: "9",
      },
    ]);

    expect(photoId).toMatch(/^photo:test:class-photo-public:class-photo:/);
    expect(privateState.character!.pendingPhotos ?? []).toEqual([]);
    expect(publicState.character!.pendingPhotos).toHaveLength(1);
  });

  it("counts only postable public photos in global photo queue metrics", async () => {
    const { ruby } = await makeServices();
    const today = dailyKey();
    const now = Date.now();

    const publicState = attachTestCharacter(ruby, "test:photo-count-public");
    publicState.sessionId = "test:photo-count-public";
    publicState.character!.name = "Noor";
    publicState.character!.dailyClasses = {
      ruby: completedClassRecord("9", "ruby", today, "A", 300),
    };
    publicState.character!.pendingPhotos = [{
      photoId: "photo:public",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/noor.png",
      teacherFacultyId: "ruby",
      earnedAt: now,
    }];

    const classPhotoOnly = attachTestCharacter(ruby, "test:photo-count-class-photo");
    classPhotoOnly.sessionId = "test:photo-count-class-photo";
    classPhotoOnly.character!.name = "Mina";
    classPhotoOnly.character!.dailyClasses = {};
    classPhotoOnly.character!.pendingPhotos = [{
      photoId: "photo:class-photo",
      kind: "class-photo",
      imageUrl: "/api/apps/ruby-high/assets/class-photo/mina.png",
      teacherFacultyId: "ruby",
      earnedAt: now + 1,
    }, {
      photoId: "photo:class-photo-stowaway-portrait",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/mina.png",
      teacherFacultyId: "ruby",
      earnedAt: now + 2,
    }];

    const noClassPortrait = attachTestCharacter(ruby, "test:photo-count-no-class");
    noClassPortrait.sessionId = "test:photo-count-no-class";
    noClassPortrait.character!.name = "Sol";
    noClassPortrait.character!.dailyClasses = {};
    noClassPortrait.character!.pendingPhotos = [{
      photoId: "photo:no-class",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/sol.png",
      teacherFacultyId: "ruby",
      earnedAt: now + 3,
    }];

    const privateState = attachTestCharacter(ruby, "test:photo-count-private");
    privateState.sessionId = "test:photo-count-private";
    privateState.character!.name = "Ari";
    privateState.character!.socialConsent = false;
    privateState.character!.dailyClasses = {
      ruby: completedClassRecord("9", "ruby", today, "A", 300),
    };
    privateState.character!.pendingPhotos = [{
      photoId: "photo:private",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/ari.png",
      teacherFacultyId: "ruby",
      earnedAt: now + 4,
    }];

    const syntheticState = attachTestCharacter(ruby, "test:photo-count-synthetic");
    syntheticState.sessionId = "test:photo-count-synthetic";
    syntheticState.character!.name = "Smoke mqe1pkx3";
    syntheticState.character!.dailyClasses = {
      ruby: completedClassRecord("9", "ruby", today, "A", 300),
    };
    syntheticState.character!.pendingPhotos = [{
      photoId: "photo:synthetic",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/smoke.png",
      teacherFacultyId: "ruby",
      earnedAt: now + 5,
    }];

    const blankState = attachTestCharacter(ruby, "test:photo-count-blank");
    blankState.sessionId = "test:photo-count-blank";
    blankState.character!.name = "   ";
    blankState.character!.dailyClasses = {
      ruby: completedClassRecord("9", "ruby", today, "A", 300),
    };
    blankState.character!.pendingPhotos = [{
      photoId: "photo:blank",
      kind: "class-photo",
      imageUrl: "/api/apps/ruby-high/assets/class-photo/blank.png",
      teacherFacultyId: "ruby",
      earnedAt: now + 6,
    }];

    expect(ruby.pendingPhotoPoolSize()).toBe(2);
    expect(ruby.photoPostSchedulerSnapshot()).toMatchObject({
      pendingPhotos: 2,
    });
    expect(ruby.getSchoolSnapshot().photoPool).toEqual([
      {
        studentName: "Noor",
        kind: "portrait",
        teacherFacultyId: "ruby",
        earnedAt: now,
      },
      {
        studentName: "Mina",
        kind: "class-photo",
        teacherFacultyId: "ruby",
        earnedAt: now + 1,
      },
    ]);
  });

  it("bounds the school snapshot photo pool to the oldest postable photos", async () => {
    const { ruby } = await makeServices();
    const today = dailyKey();
    const now = Date.now();

    for (let i = 0; i < 125; i += 1) {
      const state = attachTestCharacter(ruby, `test:photo-pool-cap-${i}`);
      state.sessionId = `test:photo-pool-cap-${i}`;
      state.character!.name = `Photo Student ${String(i).padStart(3, "0")}`;
      state.character!.dailyClasses = {
        ruby: completedClassRecord("9", "ruby", today, "A", 300),
      };
      state.character!.pendingPhotos = [{
        photoId: `photo:pool-cap:${i}`,
        kind: "portrait",
        imageUrl: `/api/apps/ruby-high/assets/portrait/${i}.png`,
        teacherFacultyId: "ruby",
        earnedAt: now + i,
      }];
    }

    const snapshot = ruby.getSchoolSnapshot();

    expect(snapshot.photoPool).toHaveLength(100);
    expect(snapshot.photoPool[0]).toMatchObject({
      studentName: "Photo Student 000",
      earnedAt: now,
    });
    expect(snapshot.photoPool.at(-1)).toMatchObject({
      studentName: "Photo Student 099",
      earnedAt: now + 99,
    });
  });

  it("bounds daily memory detail lists without losing aggregate counts", async () => {
    const { ruby } = await makeServices();
    const today = dailyKey();
    const now = Date.now();

    for (let i = 0; i < 35; i += 1) {
      const state = attachTestCharacter(ruby, `test:daily-memory-cap-${i}`);
      state.sessionId = `test:daily-memory-cap-${i}`;
      state.currentGrade = "9";
      state.character!.name = `Student ${String(i).padStart(2, "0")}`;
      state.character!.createdAt = now;
      state.character!.dailyClasses = {
        ruby: completedClassRecord("9", "ruby", today, "A", 300),
      };
    }

    const memories = ruby.getDailyMemories();

    expect(memories.charactersCreated).toHaveLength(25);
    expect(memories.classesPassed).toHaveLength(25);
    expect(memories.charactersCreated[0]).toBe("Student 00");
    expect(memories.charactersCreated.at(-1)).toBe("Student 24");
    expect(memories.classesPassed.at(-1)).toMatchObject({ studentName: "Student 24" });
    expect(memories.totalStudents).toBe(35);
    expect(memories.totalQuestionsAnswered).toBe(105);
    expect(JSON.stringify(memories)).not.toContain("Student 34");
  });

  it("keeps stale public school events out of the world feed", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    const state = attachTestCharacter(ruby, "test:world-stale-events");
    state.sessionId = "test:world-stale-events";
    state.currentGrade = "10";
    state.faculty = "ruby";
    state.character!.name = "Noor";
    state.character!.createdAt = now - 2 * 24 * 60 * 60 * 1000;
    const todayClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    todayClass.completedAt = now;
    todayClass.updatedAt = now;
    state.character!.dailyClasses = { ruby: todayClass };
    state.schoolEvents.push({
      id: "school:event:stale-world",
      kind: "comic.page-unlocked",
      at: now - 10 * 24 * 60 * 60 * 1000,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-old",
      pageNumber: 1,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Old public page",
    });
    state.schoolEvents.push({
      id: "school:event:nan-world",
      kind: "comic.page-unlocked",
      at: Number.NaN,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-nan",
      pageNumber: 1,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Broken NaN public page",
    });
    state.schoolEvents.push({
      id: "school:event:future-infinity-world",
      kind: "comic.page-unlocked",
      at: Number.POSITIVE_INFINITY,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-infinity",
      pageNumber: 1,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Broken infinite public page",
    });
    state.schoolEvents.push({
      id: "school:event:future-world",
      kind: "comic.page-unlocked",
      at: now + 60_000,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-future",
      pageNumber: 1,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Future public page",
    });
    state.schoolEvents.push({
      id: "school:event:fresh-world",
      kind: "comic.page-unlocked",
      at: now - 60_000,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-new",
      pageNumber: 2,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Fresh public page",
    });

    const world = ruby.getSchoolWorldSnapshot(10, now);
    const comicEvents = world.recentEvents.filter((event) => event.kind === "comic.page-unlocked");

    expect(world.activeStudents).toBe(1);
    expect(comicEvents.map((event) => event.label)).toEqual(["Fresh public page"]);
    expect(JSON.stringify(world)).not.toContain("Old public page");
    expect(JSON.stringify(world)).not.toContain("Broken NaN public page");
    expect(JSON.stringify(world)).not.toContain("Broken infinite public page");
    expect(JSON.stringify(world)).not.toContain("Future public page");
    expect(JSON.stringify(world)).not.toContain("school:event:fresh-world");
    expect(JSON.stringify(world)).not.toContain("teacher:ruby:grade:10");
  });

  it("persists malformed-time school events with a safe durable timestamp", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const state = attachTestCharacter(ruby, "test:world-event-malformed-time");
    state.sessionId = "test:world-event-malformed-time";

    (ruby as unknown as {
      appendSchoolEvent(state: QuizState, event: QuizState["schoolEvents"][number]): void;
    }).appendSchoolEvent(state, {
      id: "school:event:malformed-time",
      kind: "comic.page-unlocked",
      at: Number.NaN,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-malformed-time",
      pageNumber: 1,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Malformed time page",
    });
    await ruby.flush();

    const events = await new StateStore(storePath).loadSchoolEvents();

    expect(events).toEqual([
      expect.objectContaining({
        id: "school:event:malformed-time",
        occurredAt: now,
        day: "2026-06-15",
      }),
    ]);
  });

  it("hydrates only the bounded durable school-world event cache", async () => {
    const loadSchoolEvents = vi.fn(async () => []);
    const store = {
      loadPacks: vi.fn(async () => []),
      loadTeachers: vi.fn(async () => []),
      loadDraftPacks: vi.fn(async () => []),
      loadPackInstallations: vi.fn(async () => []),
      load: vi.fn(async () => new Map()),
      loadMetricEvents: vi.fn(async () => []),
      loadSchoolEvents,
      loadServiceState: vi.fn(async () => null),
      saveSession: vi.fn(async () => {}),
      saveAuthUser: vi.fn(async () => {}),
      saveAuthSession: vi.fn(async () => {}),
      savePack: vi.fn(async () => {}),
      saveDraftPack: vi.fn(async () => {}),
      savePackInstallation: vi.fn(async () => {}),
      saveTeacher: vi.fn(async () => {}),
      deletePack: vi.fn(async () => {}),
      deleteTeacher: vi.fn(async () => {}),
      deleteDraftPack: vi.fn(async () => {}),
      deletePackInstallation: vi.fn(async () => {}),
      deleteAuthSession: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
      describe: () => "test bounded school event store",
      flush: vi.fn(async () => {}),
    };
    const ruby = new RubyHighService({} as never, store as never);
    activeRuby = ruby;

    await ruby["hydrate"]();

    expect(loadSchoolEvents).toHaveBeenCalledWith({ limit: 400 });
  });

  it("uses sanitized public session ids for world event fallback visibility", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);

    const visible = attachTestCharacter(ruby, "test:world-event-visible");
    visible.sessionId = "test:world-event-visible";
    visible.currentGrade = "10";
    visible.faculty = "ruby";
    visible.character!.name = "Visible Noor";
    visible.character!.createdAt = now;
    const visibleClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    visibleClass.completedAt = now;
    visibleClass.updatedAt = now;
    visible.character!.dailyClasses = { ruby: visibleClass };
    visible.schoolEvents.push({
      id: "school:event:visible-session",
      kind: "comic.page-unlocked",
      at: now,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-visible",
      pageNumber: 1,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Visible public page",
    });

    const malformedSessionId = "test:world-event-\u0000malformed";
    const malformed = attachTestCharacter(ruby, malformedSessionId);
    malformed.sessionId = malformedSessionId;
    malformed.currentGrade = "10";
    malformed.faculty = "ruby";
    malformed.character!.name = "Malformed Noor";
    malformed.character!.createdAt = now;
    const malformedClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    malformedClass.completedAt = now;
    malformedClass.updatedAt = now;
    malformed.character!.dailyClasses = { ruby: malformedClass };
    malformed.schoolEvents.push({
      id: "school:event:malformed-session",
      kind: "comic.page-unlocked",
      at: now,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-malformed",
      pageNumber: 1,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Malformed public page",
    });

    const world = ruby.getSchoolWorldSnapshot(10, now);
    const events = ruby
      .getSchoolWorldEvents(10, now)
      .filter((event) => event.kind === "comic.page-unlocked");

    expect(world.activeStudents).toBe(1);
    expect(JSON.stringify(world)).not.toContain("Malformed Noor");
    expect(events.map((event) => event.label)).toEqual(["Visible public page"]);
    expect(JSON.stringify(events)).not.toContain("Malformed public page");
    expect(JSON.stringify(events)).not.toContain("Malformed Noor");
  });

  it("keeps no-class characters out of public world rooms", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    const noClass = attachTestCharacter(ruby, "test:world-no-class");
    noClass.sessionId = "test:world-no-class";
    noClass.currentGrade = "10";
    noClass.faculty = "ruby";
    noClass.character!.name = "No Class Noor";
    noClass.character!.createdAt = now;
    noClass.character!.dailyClasses = {};

    const completed = attachTestCharacter(ruby, "test:world-completed-class");
    completed.sessionId = "test:world-completed-class";
    completed.currentGrade = "10";
    completed.faculty = "ruby";
    completed.character!.name = "Completed Mina";
    completed.character!.createdAt = now;
    const todayClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    todayClass.completedAt = now;
    todayClass.updatedAt = now;
    completed.character!.dailyClasses = { ruby: todayClass };

    const world = ruby.getSchoolWorldSnapshot(10, now);

    expect(world.activeStudents).toBe(1);
    expect(world.activeRooms).toEqual([
      expect.objectContaining({
        activeStudents: 1,
        students: [expect.objectContaining({ name: "Completed Mina" })],
      }),
    ]);
    expect(JSON.stringify(world)).not.toContain("No Class Noor");
  });

  it("places public students in the classroom where they were last active instead of their selected room", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    const student = attachTestCharacter(ruby, "test:world-last-active-room");
    student.sessionId = "test:world-last-active-room";
    student.currentGrade = "10";
    student.faculty = "ruby";
    student.character!.name = "Moving Mina";
    student.character!.createdAt = now - 10_000;
    student.character!.portraitDataUrl = "/api/apps/ruby-high/assets/portrait/moving-mina.png";
    const homeroomClass = completedClassRecord("10", "ruby", "2026-06-14", "A", 300);
    homeroomClass.completedAt = now - 5_000;
    homeroomClass.updatedAt = now - 5_000;
    student.character!.dailyClasses = { ruby: homeroomClass };
    student.cardMemory = {
      [cardMemoryKey("sally-science", "science-practice")]: {
        ...defaultCardMemory("sally-science", "science-practice"),
        lastReviewedAt: now - 1_000,
      },
    };

    const world = ruby.getSchoolWorldSnapshot(10, now);
    const roomStudents = ruby.getPublicRoomHumanStudentsForSession("test:world-last-active-viewer", now);

    expect(world.activeRooms).toEqual([
      expect.objectContaining({
        facultyId: "sally-science",
        displayName: "Sally Science",
        students: [expect.objectContaining({ name: "Moving Mina", lastActive: now - 1_000 })],
      }),
    ]);
    expect(roomStudents).toContainEqual(expect.objectContaining({
      name: "Moving Mina",
      facultyId: "sally-science",
      lastActive: now - 1_000,
    }));
  });

  it("lists human students by their last active room only when they have custom public portraits", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    const viewer = attachTestCharacter(ruby, "test:room-human-viewer");
    viewer.sessionId = "test:room-human-viewer";
    viewer.currentGrade = "10";
    viewer.faculty = "ruby";
    viewer.character!.name = "Viewer Mina";
    viewer.character!.createdAt = now;
    viewer.character!.portraitDataUrl = "/api/apps/ruby-high/assets/portrait/viewer-mina.png";
    const viewerClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    viewerClass.completedAt = now;
    viewerClass.updatedAt = now;
    viewer.character!.dailyClasses = { ruby: viewerClass };

    const custom = attachTestCharacter(ruby, "test:room-human-custom");
    custom.sessionId = "test:room-human-custom";
    custom.currentGrade = "10";
    custom.faculty = "ruby";
    custom.character!.name = "Sloan";
    custom.character!.playbookId = "slacker";
    custom.character!.createdAt = now;
    custom.character!.portraitDataUrl = "/api/apps/ruby-high/assets/portrait/sloan.png";

    const defaultPortrait = attachTestCharacter(ruby, "test:room-human-default");
    defaultPortrait.sessionId = "test:room-human-default";
    defaultPortrait.currentGrade = "10";
    defaultPortrait.faculty = "ruby";
    defaultPortrait.character!.name = "Default Lyra";
    defaultPortrait.character!.playbookId = "lifer";
    defaultPortrait.character!.createdAt = now;
    defaultPortrait.character!.portraitDataUrl = "/api/apps/ruby-high/assets/students/lyra-full.png";
    const defaultClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    defaultClass.completedAt = now;
    defaultClass.updatedAt = now;
    defaultPortrait.character!.dailyClasses = { ruby: defaultClass };

    const otherRoom = attachTestCharacter(ruby, "test:room-human-other-room");
    otherRoom.sessionId = "test:room-human-other-room";
    otherRoom.currentGrade = "10";
    otherRoom.faculty = "sally-science";
    otherRoom.character!.name = "Other Room Noor";
    otherRoom.character!.createdAt = now;
    otherRoom.character!.portraitDataUrl = "https://ruby-high-portraits.s3.us-east-1.amazonaws.com/portrait/other-room-noor.png";
    const otherRoomClass = completedClassRecord("10", "sally-science", "2026-06-15", "A", 300);
    otherRoomClass.completedAt = now;
    otherRoomClass.updatedAt = now;
    otherRoom.character!.dailyClasses = { "sally-science": otherRoomClass };

    const crossGrade = attachTestCharacter(ruby, "test:room-human-cross-grade");
    crossGrade.sessionId = "test:room-human-cross-grade";
    crossGrade.currentGrade = "12";
    crossGrade.faculty = "ruby";
    crossGrade.character!.name = "Tariq";
    crossGrade.character!.playbookId = "outsider";
    crossGrade.character!.createdAt = now;
    crossGrade.character!.portraitDataUrl = "https://ruby-high-portraits.s3.us-east-1.amazonaws.com/portrait/tariq.png";

    expect(ruby.getPublicRoomHumanStudentsForSession("test:room-human-viewer", now)).toEqual([
      {
        id: expect.stringMatching(/^world:session:[a-f0-9]{16}$/),
        name: "Other Room Noor",
        playbookId: "lifer",
        grade: "10",
        facultyId: "sally-science",
        portraitUrl: "https://ruby-high-portraits.s3.us-east-1.amazonaws.com/portrait/other-room-noor.png",
        stats: { head: 99, heart: 99, hustle: 99, honor: 99 },
        classGrades: { "sally-science": "A" },
        yearbookCount: 0,
        lastActive: now,
      },
      {
        id: expect.stringMatching(/^world:session:[a-f0-9]{16}$/),
        name: "Sloan",
        playbookId: "slacker",
        grade: "10",
        facultyId: "ruby",
        portraitUrl: "/api/apps/ruby-high/assets/portrait/sloan.png",
        stats: { head: 99, heart: 99, hustle: 99, honor: 99 },
        classGrades: {},
        yearbookCount: 0,
        lastActive: now,
      },
      {
        id: expect.stringMatching(/^world:session:[a-f0-9]{16}$/),
        name: "Tariq",
        playbookId: "outsider",
        grade: "12",
        facultyId: "ruby",
        portraitUrl: "https://ruby-high-portraits.s3.us-east-1.amazonaws.com/portrait/tariq.png",
        stats: { head: 99, heart: 99, hustle: 99, honor: 99 },
        classGrades: {},
        yearbookCount: 0,
        lastActive: now,
      },
    ]);
  });

  it("keeps public-world-hidden characters out of rooms while preserving social consent", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    const hidden = attachTestCharacter(ruby, "test:world-presence-hidden");
    hidden.sessionId = "test:world-presence-hidden";
    hidden.currentGrade = "10";
    hidden.faculty = "ruby";
    hidden.character!.name = "Hidden World Noor";
    hidden.character!.createdAt = now;
    hidden.character!.socialConsent = true;
    hidden.character!.publicWorldVisible = false;
    const hiddenClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    hiddenClass.completedAt = now;
    hiddenClass.updatedAt = now;
    hidden.character!.dailyClasses = { ruby: hiddenClass };

    const visible = attachTestCharacter(ruby, "test:world-presence-visible");
    visible.sessionId = "test:world-presence-visible";
    visible.currentGrade = "10";
    visible.faculty = "ruby";
    visible.character!.name = "Visible World Mina";
    visible.character!.createdAt = now;
    const visibleClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    visibleClass.completedAt = now;
    visibleClass.updatedAt = now;
    visible.character!.dailyClasses = { ruby: visibleClass };

    const world = ruby.getSchoolWorldSnapshot(10, now);

    expect(hidden.character!.socialConsent).toBe(true);
    expect(world.activeStudents).toBe(1);
    expect(JSON.stringify(world)).toContain("Visible World Mina");
    expect(JSON.stringify(world)).not.toContain("Hidden World Noor");
  });

  it("keeps names that need review out of public world rooms", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    const reviewed = attachTestCharacter(ruby, "test:world-name-review");
    reviewed.sessionId = "test:world-name-review";
    reviewed.currentGrade = "10";
    reviewed.faculty = "ruby";
    reviewed.character!.name = "noor@example.test";
    reviewed.character!.createdAt = now;
    reviewed.character!.socialConsent = true;
    reviewed.character!.publicWorldVisible = true;
    const reviewedClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    reviewedClass.completedAt = now;
    reviewedClass.updatedAt = now;
    reviewed.character!.dailyClasses = { ruby: reviewedClass };

    const visible = attachTestCharacter(ruby, "test:world-name-visible");
    visible.sessionId = "test:world-name-visible";
    visible.currentGrade = "10";
    visible.faculty = "ruby";
    visible.character!.name = "Visible World Mina";
    visible.character!.createdAt = now;
    const visibleClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    visibleClass.completedAt = now;
    visibleClass.updatedAt = now;
    visible.character!.dailyClasses = { ruby: visibleClass };

    const world = ruby.getSchoolWorldSnapshot(10, now);

    expect(world.activeStudents).toBe(1);
    expect(JSON.stringify(world)).toContain("Visible World Mina");
    expect(JSON.stringify(world)).not.toContain("noor@example.test");
  });

  it("blocks public-name-review failures from live-room rewards", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    const reviewed = attachTestCharacter(ruby, "test:world-name-review-reward");
    reviewed.sessionId = "test:world-name-review-reward";
    reviewed.currentGrade = "10";
    reviewed.faculty = "ruby";
    reviewed.character!.name = "noor@example.test";
    reviewed.character!.createdAt = now;
    reviewed.character!.socialConsent = true;
    reviewed.character!.publicWorldVisible = true;
    const reviewedClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    reviewedClass.completedAt = now;
    reviewedClass.updatedAt = now;
    reviewed.character!.dailyClasses = { ruby: reviewedClass };

    const visible = attachTestCharacter(ruby, "test:world-name-visible-reward");
    visible.sessionId = "test:world-name-visible-reward";
    visible.currentGrade = "10";
    visible.faculty = "ruby";
    visible.character!.name = "Visible World Mina";
    visible.character!.createdAt = now;
    const visibleClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    visibleClass.completedAt = now;
    visibleClass.updatedAt = now;
    visible.character!.dailyClasses = { ruby: visibleClass };

    expect(ruby.contributeLiveRoomGoal(reviewed.sessionId, now)).toBeNull();
    expect(ruby.contributeLiveRoomGoal(visible.sessionId, now + 1)).toMatchObject({
      grade: "10",
      facultyId: "ruby",
      progress: 1,
      target: 3,
      complete: false,
      duplicate: false,
    });

    const world = ruby.getSchoolWorldSnapshot(10, now + 1);
    const roomGoalEvents = world.recentEvents.filter((event) => event.kind === "room.goal-progress");
    expect(world.activeRooms[0]).toMatchObject({
      grade: "10",
      facultyId: "ruby",
      activeStudents: 1,
      goal: {
        kind: "live-class",
        progress: 1,
        target: 3,
        complete: false,
        updatedAt: now + 1,
      },
    });
    expect(roomGoalEvents).toHaveLength(1);
    expect(roomGoalEvents[0]).toMatchObject({
      kind: "room.goal-progress",
      progress: 1,
      target: 3,
      complete: false,
    });
    expect(JSON.stringify(world)).toContain("Visible World Mina");
    expect(JSON.stringify(world)).not.toContain("noor@example.test");
    expect(JSON.stringify(world)).not.toContain("test:world-name-review-reward");

    await ruby.flush();
    const goalState = await new StateStore(storePath).loadServiceState("ruby-high:live-room-goals:v1");
    expect(goalState?.data).toMatchObject({
      version: 1,
      goals: [
        expect.objectContaining({
          grade: "10",
          facultyId: "ruby",
          day: "2026-06-15",
          contributors: [expect.stringMatching(/^world:session:[a-f0-9]{16}$/)],
          updatedAt: now + 1,
        }),
      ],
    });
    expect(JSON.stringify(goalState)).not.toContain("noor@example.test");
    expect(JSON.stringify(goalState)).not.toContain("test:world-name-review-reward");
  });

  it("exposes shared live-room goal progress through the public world feed", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    usePublicWorldFixtureTime(now + 60_000);

    const first = attachTestCharacter(ruby, "test:world-room-goal-a");
    first.sessionId = "test:world-room-goal-a";
    first.currentGrade = "10";
    first.faculty = "ruby";
    first.updatedAt = now - 100;
    first.character!.name = "Goal Noor";
    first.character!.createdAt = now - 100;
    const firstClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    firstClass.completedAt = now - 100;
    firstClass.updatedAt = now - 100;
    first.character!.dailyClasses = { ruby: firstClass };

    const second = attachTestCharacter(ruby, "test:world-room-goal-b");
    second.sessionId = "test:world-room-goal-b";
    second.currentGrade = "10";
    second.faculty = "ruby";
    second.updatedAt = now;
    second.character!.name = "Goal Mina";
    second.character!.createdAt = now;
    const secondClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    secondClass.completedAt = now;
    secondClass.updatedAt = now;
    second.character!.dailyClasses = { ruby: secondClass };

    const third = attachTestCharacter(ruby, "test:world-room-goal-c");
    third.sessionId = "test:world-room-goal-c";
    third.currentGrade = "10";
    third.faculty = "ruby";
    third.updatedAt = now;
    third.character!.name = "Goal Sol";
    third.character!.createdAt = now;
    const thirdClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    thirdClass.completedAt = now;
    thirdClass.updatedAt = now;
    third.character!.dailyClasses = { ruby: thirdClass };

    expect(ruby.contributeLiveRoomGoal(first.sessionId, now - 50)).toMatchObject({
      grade: "10",
      facultyId: "ruby",
      progress: 1,
      target: 3,
      complete: false,
      duplicate: false,
    });
    expect(ruby.contributeLiveRoomGoal(first.sessionId, now - 25)).toMatchObject({
      progress: 1,
      duplicate: true,
    });
    expect(ruby.contributeLiveRoomGoal(second.sessionId, now)).toMatchObject({
      progress: 2,
      target: 3,
      complete: false,
      duplicate: false,
    });

    const world = ruby.getSchoolWorldSnapshot(10, now);
    const roomGoalEvents = world.recentEvents.filter((event) => event.kind === "room.goal-progress");

    expect(world.activeRooms[0]).toMatchObject({
      grade: "10",
      facultyId: "ruby",
      activeStudents: 3,
      goal: {
        kind: "live-class",
        label: "Ruby live class 2/3",
        progress: 2,
        target: 3,
        complete: false,
        updatedAt: now,
      },
    });
    expect(roomGoalEvents).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^world:event:[a-f0-9]{16}$/),
        kind: "room.goal-progress",
        at: now,
        faculty: "ruby",
        grade: "10",
        roomTitle: "Ruby room",
        progress: 2,
        target: 3,
        complete: false,
        label: "Ruby live class is 2/3",
      }),
    ]);
    expect(JSON.stringify(roomGoalEvents)).not.toContain("test:world-room-goal");
    expect(JSON.stringify(roomGoalEvents)).not.toContain("Goal Noor");
    expect(JSON.stringify(roomGoalEvents)).not.toContain("Goal Mina");
    expect(JSON.stringify(roomGoalEvents)).not.toContain("Goal Sol");
    await ruby.flush();
    const roomState = await new StateStore(storePath).loadServiceState("ruby-high:public-world-rooms:v1");
    expect(roomState?.data).toMatchObject({
      version: 1,
      rooms: [
        {
          key: "2025-2026:10:ruby",
          schoolYear: "2025-2026",
          termId: "2025-2026",
          grade: "10",
          facultyId: "ruby",
          displayName: "Ruby",
          activeStudents: 3,
          goal: {
            kind: "live-class",
            progress: 2,
            target: 3,
            complete: false,
            updatedAt: now,
          },
          updatedAt: now,
        },
      ],
    });
    expect(JSON.stringify(roomState)).not.toContain("test:world-room-goal");
    expect(JSON.stringify(roomState)).not.toContain("Goal Noor");
    expect(JSON.stringify(roomState)).not.toContain("Goal Mina");
    expect(JSON.stringify(roomState)).not.toContain("Goal Sol");

    expect(ruby.contributeLiveRoomGoal(third.sessionId, now + 10)).toMatchObject({
      progress: 3,
      target: 3,
      complete: true,
      duplicate: false,
      bonusLabel: "Ruby earned a Class Chain bonus",
    });
    await ruby.flush();
    const roomOutcomeState = await new StateStore(storePath).loadServiceState("ruby-high:public-world-room-outcomes:v1");
    expect(roomOutcomeState?.data).toMatchObject({
      version: 1,
      outcomes: [
        {
          id: expect.stringMatching(/^room:outcome:[a-f0-9]{16}$/),
          schoolYear: "2025-2026",
          termId: "2025-2026",
          day: "2026-06-15",
          grade: "10",
          facultyId: "ruby",
          displayName: "Ruby",
          goalKind: "live-class",
          roomTitle: "Ruby room",
          summaryLabel: "Ruby live class completed 3/3 with 3 contributors",
          rewardKind: "study-spark",
          rewardLabel: "Ruby earned a class-wide Study Spark",
          bonusLabel: "Ruby earned a Class Chain bonus",
          progress: 3,
          target: 3,
          contributorCount: 3,
          completedAt: now + 10,
          createdAt: now + 10,
        },
      ],
    });
    expect(JSON.stringify(roomOutcomeState)).not.toContain("test:world-room-goal");
    expect(JSON.stringify(roomOutcomeState)).not.toContain("Goal Noor");
    expect(JSON.stringify(roomOutcomeState)).not.toContain("Goal Mina");
    expect(JSON.stringify(roomOutcomeState)).not.toContain("Goal Sol");

    await ruby.stop();
    activeRuby = null;
    const rehydrated = new RubyHighService({} as never, new StateStore(storePath));
    await rehydrated["hydrate"]();
    activeRuby = rehydrated;

    const rehydratedWorld = rehydrated.getSchoolWorldSnapshot(10, now + 10);
    expect(rehydratedWorld.activeRooms[0]).toMatchObject({
      grade: "10",
      facultyId: "ruby",
      activeStudents: 3,
      goal: {
        kind: "live-class",
        label: "Ruby live class 3/3",
        progress: 3,
        target: 3,
        complete: true,
        updatedAt: now + 10,
        bonusLabel: "Ruby earned a Class Chain bonus",
      },
    });
    expect(rehydratedWorld.summary).toMatchObject({
      roomGoalEvents: {
        total: 2,
        complete: 1,
      },
      studySparks: {
        total: 1,
        byGrade: {
          "10": 1,
        },
      },
      termProgress: {
        totalSparks: 1,
        level: 0,
        nextLevelAt: 3,
        sparksToNextLevel: 2,
        label: "Term Spark 1/3",
      },
    });
    expect(rehydratedWorld.recentEvents.filter((event) => event.kind === "room.goal-progress")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "room.goal-progress",
        at: now + 10,
        faculty: "ruby",
        grade: "10",
        progress: 3,
        target: 3,
        complete: true,
        label: "Ruby filled a live class goal",
        rewardLabel: "Ruby earned a class-wide Study Spark",
        bonusLabel: "Ruby earned a Class Chain bonus",
      }),
    ]));
    expect(rehydrated.worldHealthSnapshot(now + 10)).toMatchObject({
      durableRoomRecords: 1,
      durableRoomRecordLimit: 80,
      durableRoomOutcomes: 1,
      durableRoomOutcomeLimit: 120,
      recentRoomOutcomes: [
        expect.objectContaining({
          roomTitle: "Ruby room",
          summaryLabel: "Ruby live class completed 3/3 with 3 contributors",
          rewardKind: "study-spark",
          rewardLabel: "Ruby earned a class-wide Study Spark",
          bonusLabel: "Ruby earned a Class Chain bonus",
        }),
      ],
      liveRoomGoals: 1,
      summary: {
        roomGoalEvents: {
          total: 2,
          complete: 1,
        },
        studySparks: {
          total: 1,
          byGrade: {
            "10": 1,
          },
        },
        termProgress: {
          label: "Term Spark 1/3",
          sparksToNextLevel: 2,
        },
      },
    });
  });

  it("uses term progress to reduce the next live-room goal target", async () => {
    const { ruby } = await makeServices();
    const start = Date.UTC(2026, 5, 15, 12);
    usePublicWorldFixtureTime(start + 3 * 24 * 60 * 60 * 1000 + 60_000);
    const sessions = ["test:term-room-a", "test:term-room-b", "test:term-room-c"].map((sid, index) => {
      const state = attachTestCharacter(ruby, sid);
      state.sessionId = sid;
      state.currentGrade = "10";
      state.faculty = "ruby";
      state.updatedAt = start + index;
      state.character!.name = `Term Student ${index + 1}`;
      state.character!.createdAt = start + index;
      state.character!.publicWorldVisible = true;
      state.character!.dailyClasses = {
        ruby: {
          ...completedClassRecord("10", "ruby", "2026-06-15", "A", 300),
          completedAt: start + index,
          updatedAt: start + index,
        },
      };
      return state;
    });

    for (let day = 0; day < 3; day += 1) {
      const now = start + day * 24 * 60 * 60 * 1000;
      for (const state of sessions) {
        expect(ruby.contributeLiveRoomGoal(state.sessionId, now)).toMatchObject({
          target: 3,
        });
      }
      expect(ruby.getSchoolWorldSnapshot(10, now).summary.termProgress).toMatchObject({
        totalSparks: day + 1,
      });
    }

    const momentumAt = start + 3 * 24 * 60 * 60 * 1000;
    expect(ruby.publicWorldSummarySnapshot(momentumAt).termProgress).toMatchObject({
      totalSparks: 3,
      level: 1,
      label: "Term Level 1",
    });
    const freshman = attachTestCharacter(ruby, "test:term-room-freshman");
    freshman.sessionId = "test:term-room-freshman";
    freshman.currentGrade = "9";
    freshman.faculty = "sally-science";
    freshman.updatedAt = momentumAt;
    freshman.character!.name = "Freshman Term Student";
    freshman.character!.createdAt = momentumAt;
    freshman.character!.publicWorldVisible = true;
    freshman.character!.dailyClasses = {
      "sally-science": {
        ...completedClassRecord("9", "sally-science", "2026-06-18", "A", 300),
        completedAt: momentumAt,
        updatedAt: momentumAt,
      },
    };
    expect(ruby.contributeLiveRoomGoal(freshman.sessionId, momentumAt)).toMatchObject({
      grade: "9",
      progress: 1,
      target: 3,
      complete: false,
    });
    expect(ruby.contributeLiveRoomGoal(sessions[0]!.sessionId, momentumAt)).toMatchObject({
      progress: 1,
      target: 2,
      complete: false,
      ruleLabel: "Term Momentum",
    });
    expect(ruby.contributeLiveRoomGoal(sessions[1]!.sessionId, momentumAt + 1)).toMatchObject({
      progress: 2,
      target: 2,
      complete: true,
      ruleLabel: "Term Momentum",
    });

    const world = ruby.getSchoolWorldSnapshot(10, momentumAt + 1);
    const rubyRoom = world.activeRooms.find((room) => room.grade === "10" && room.facultyId === "ruby");
    expect(rubyRoom?.goal).toMatchObject({
      label: "Ruby live class 2/2 · Term Momentum",
      progress: 2,
      target: 2,
      complete: true,
      ruleLabel: "Term Momentum",
    });
    expect(world.recentEvents.filter((event) => event.kind === "room.goal-progress")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "room.goal-progress",
        progress: 2,
        target: 2,
        complete: true,
        ruleLabel: "Term Momentum",
        rewardLabel: "Ruby earned a class-wide Study Spark",
      }),
    ]));
    expect(world.summary.termProgress).toMatchObject({
      totalSparks: 4,
      level: 1,
      label: "Term Spark 1/3",
    });
    expect(world.summary.termRules).toEqual({
      byGrade: {
        "10": {
          kind: "term-momentum",
          label: "Term Momentum",
          target: 2,
        },
      },
    });
    await ruby.flush();
    const roomOutcomeState = await new StateStore(storePath).loadServiceState("ruby-high:public-world-room-outcomes:v1");
    expect(roomOutcomeState?.data).toMatchObject({
      outcomes: expect.arrayContaining([
        expect.objectContaining({
          summaryLabel: "Ruby live class completed 2/2 with 2 contributors",
          ruleLabel: "Term Momentum",
          progress: 2,
          target: 2,
          contributorCount: 2,
        }),
      ]),
    });
    const termState = await new StateStore(storePath).loadServiceState("ruby-high:public-world-terms:v1");
    expect(termState?.data).toMatchObject({
      version: 1,
    });
    const persistedTerm = (termState?.data as { terms?: Array<Record<string, unknown>> } | undefined)?.terms?.[0];
    expect(persistedTerm).toMatchObject({
      id: expect.stringMatching(/^term:[a-f0-9]{16}$/),
      schoolYear: "2025-2026",
      termId: "2025-2026",
      totalSparks: 4,
      level: 1,
      label: "Term Spark 1/3",
      activeRuleLabels: ["Term Momentum"],
    });
    expect(persistedTerm?.cohortTerms).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringMatching(/^term:cohort:[a-f0-9]{16}$/),
        schoolYear: "2025-2026",
        termId: "2025-2026",
        grade: "10",
        totalSparks: 4,
        level: 1,
        activeRuleLabels: ["Term Momentum"],
        curriculumLoops: {
          inReview: 0,
          promoted: 0,
        },
        roomRule: {
          kind: "term-momentum",
          label: "Term Momentum",
          target: 2,
        },
      }),
    ]));
    const persistedGradeProgress = persistedTerm?.gradeProgress as Record<string, unknown> | undefined;
    expect(persistedGradeProgress?.["9"]).toMatchObject({
      totalSparks: 0,
      level: 0,
      activeRuleLabels: [],
    });
    expect(persistedGradeProgress?.["9"]).not.toHaveProperty("roomRule");
    expect(persistedGradeProgress?.["10"]).toMatchObject({
      totalSparks: 4,
      level: 1,
      activeRuleLabels: ["Term Momentum"],
      roomRule: {
        kind: "term-momentum",
        label: "Term Momentum",
        target: 2,
      },
    });
    await ruby.stop();
    activeRuby = null;
    const rehydrated = new RubyHighService({} as never, new StateStore(storePath));
    await rehydrated["hydrate"]();
    activeRuby = rehydrated;
    expect(rehydrated.worldHealthSnapshot(momentumAt + 1)).toMatchObject({
      durableTermRecords: 1,
      durableTermRecordLimit: 12,
      durableCohortTerms: 4,
      recentCohortTerms: expect.arrayContaining([
        expect.objectContaining({
          grade: "10",
          level: 1,
          roomRule: {
            kind: "term-momentum",
            label: "Term Momentum",
            target: 2,
          },
        }),
      ]),
      recentTerms: [
        expect.objectContaining({
          totalSparks: 4,
          level: 1,
          activeRuleLabels: ["Term Momentum"],
          gradeProgress: expect.objectContaining({
            "10": expect.objectContaining({
              level: 1,
              activeRuleLabels: ["Term Momentum"],
              roomRule: {
                kind: "term-momentum",
                label: "Term Momentum",
                target: 2,
              },
            }),
          }),
          cohortTerms: expect.arrayContaining([
            expect.objectContaining({
              grade: "10",
              level: 1,
              roomRule: {
                kind: "term-momentum",
                label: "Term Momentum",
                target: 2,
              },
            }),
          ]),
        }),
      ],
    });
    expect(JSON.stringify(world)).not.toContain("test:term-room");
  });

  it("uses term level two to start a four-student Term Rally with a visible Rally Spark reward", async () => {
    const { ruby } = await makeServices();
    const start = Date.UTC(2026, 5, 12, 12);
    usePublicWorldFixtureTime(start + 7 * 24 * 60 * 60 * 1000 + 60_000);
    const sessions = ["test:term-rally-a", "test:term-rally-b", "test:term-rally-c", "test:term-rally-d"].map((sid, index) => {
      const state = attachTestCharacter(ruby, sid);
      state.sessionId = sid;
      state.currentGrade = "10";
      state.faculty = "ruby";
      state.updatedAt = start + index;
      state.character!.name = `Rally Student ${index + 1}`;
      state.character!.createdAt = start + index;
      state.character!.publicWorldVisible = true;
      state.character!.dailyClasses = {
        ruby: {
          ...completedClassRecord("10", "ruby", "2026-06-12", "A", 300),
          completedAt: start + index,
          updatedAt: start + index,
        },
      };
      return state;
    });

    for (let day = 0; day < 3; day += 1) {
      const now = start + day * 24 * 60 * 60 * 1000;
      for (const [index, state] of sessions.slice(0, 3).entries()) {
        state.updatedAt = now + index;
        expect(ruby.contributeLiveRoomGoal(state.sessionId, now + index)).toMatchObject({
          target: 3,
          complete: index === 2,
        });
      }
      ruby.getSchoolWorldSnapshot(10, now + 2);
      expect(ruby.publicWorldSummarySnapshot(now + 2).studySparks.byGrade["10"]).toBe(day + 1);
    }
    for (let day = 3; day < 6; day += 1) {
      const now = start + day * 24 * 60 * 60 * 1000;
      for (const [index, state] of sessions.slice(0, 2).entries()) {
        state.updatedAt = now + index;
        expect(ruby.contributeLiveRoomGoal(state.sessionId, now + index)).toMatchObject({
          target: 2,
          complete: index === 1,
          ruleLabel: "Term Momentum",
        });
      }
      ruby.getSchoolWorldSnapshot(10, now + 1);
      expect(ruby.publicWorldSummarySnapshot(now + 1).studySparks.byGrade["10"]).toBe(day + 1);
    }
    const rallyAt = start + 6 * 24 * 60 * 60 * 1000;
    usePublicWorldFixtureTime(rallyAt + 60_000);
    expect(ruby.publicWorldSummarySnapshot(rallyAt).termProgress).toMatchObject({
      totalSparks: 6,
      level: 2,
      label: "Term Level 2",
    });
    expect(ruby.publicWorldSummarySnapshot(rallyAt).termRules).toEqual({
      byGrade: {
        "10": {
          kind: "term-rally",
          label: "Term Rally",
          target: 4,
        },
      },
    });

    for (const [index, state] of sessions.entries()) {
      state.updatedAt = rallyAt + index;
      expect(ruby.contributeLiveRoomGoal(state.sessionId, rallyAt + index)).toMatchObject({
        grade: "10",
        progress: index + 1,
        target: 4,
        complete: index === 3,
        ruleLabel: "Term Rally",
      });
    }

    const world = ruby.getSchoolWorldSnapshot(10, rallyAt + 3);
    const rubyRoom = world.activeRooms.find((room) => room.grade === "10" && room.facultyId === "ruby");
    expect(rubyRoom?.goal).toMatchObject({
      label: "Ruby live class 4/4 · Term Rally",
      progress: 4,
      target: 4,
      complete: true,
      ruleLabel: "Term Rally",
    });
    expect(world.recentEvents.filter((event) => event.kind === "room.goal-progress")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        progress: 4,
        target: 4,
        complete: true,
        ruleLabel: "Term Rally",
        rewardLabel: "Ruby earned a class-wide Rally Spark",
      }),
    ]));
    expect(world.summary.termProgress).toMatchObject({
      totalSparks: 7,
      level: 2,
      label: "Term Spark 1/3",
    });

    await ruby.flush();
    const roomOutcomeState = await new StateStore(storePath).loadServiceState("ruby-high:public-world-room-outcomes:v1");
    expect(roomOutcomeState?.data).toMatchObject({
      outcomes: expect.arrayContaining([
        expect.objectContaining({
          summaryLabel: "Ruby live class completed 4/4 with 4 contributors",
          rewardLabel: "Ruby earned a class-wide Rally Spark",
          ruleLabel: "Term Rally",
          progress: 4,
          target: 4,
          contributorCount: 4,
        }),
      ]),
    });
    expect(JSON.stringify(world)).not.toContain("test:term-rally");
  });

  it("replays sanitized public world events from durable service state without private sessions", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    usePublicWorldFixtureTime(now + 60_000);
    const state = attachTestCharacter(ruby, "test:world-public-event-log");
    state.sessionId = "test:world-public-event-log";
    state.currentGrade = "10";
    state.faculty = "ruby";
    state.updatedAt = now;
    state.character!.name = "Replay Noor";
    state.character!.createdAt = now;
    state.character!.dailyClasses = {
      ruby: {
        ...completedClassRecord("10", "ruby", "2026-06-15", "A", 300),
        completedAt: now,
        updatedAt: now,
      },
    };
    state.schoolEvents.push({
      id: "school:event:public-log",
      kind: "comic.page-unlocked",
      at: now + 1,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-public-log",
      pageNumber: 4,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Replayable public page",
    });

    const firstEvents = ruby.getSchoolWorldEvents(10, now + 2);
    expect(firstEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "comic.page-unlocked",
        label: "Replayable public page",
      }),
    ]));
    await ruby.flush();
    const publicEventState = await new StateStore(storePath).loadServiceState("ruby-high:public-world-events:v1");
    expect(publicEventState?.data.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringMatching(/^world:event:[a-f0-9]{16}$/),
        kind: "comic.page-unlocked",
        label: "Replayable public page",
      }),
    ]));
    expect(JSON.stringify(publicEventState)).not.toContain("school:event:public-log");
    expect(JSON.stringify(publicEventState)).not.toContain("teacher:ruby:grade:10");
    expect(JSON.stringify(publicEventState)).not.toContain("Replay Noor");
    const publicSummaryState = await new StateStore(storePath).loadServiceState("ruby-high:public-world-summary:v1");
    expect(publicSummaryState?.data).toMatchObject({
      version: 1,
      summary: {
        schoolYear: "2025-2026",
        eventCount: 2,
        newestEventAt: now + 1,
        byKind: {
          "comic.page-unlocked": 1,
          "room.goal-progress": 1,
        },
        byGrade: {
          "10": 2,
        },
        roomGoalEvents: {
          total: 1,
          complete: 0,
        },
        studySparks: {
          total: 0,
        },
        termProgress: {
          totalSparks: 0,
          level: 0,
          nextLevelAt: 3,
          sparksToNextLevel: 3,
          label: "Term Spark 0/3",
        },
        termRules: {
          byGrade: {},
        },
      },
    });
    expect(JSON.stringify(publicSummaryState)).not.toContain("school:event:public-log");
    expect(JSON.stringify(publicSummaryState)).not.toContain("Replay Noor");

    await ruby.stop();
    activeRuby = null;
    const replayOnlyStore = serviceStateOnlyStore(publicEventState!);
    const rehydrated = new RubyHighService({} as never, replayOnlyStore);
    await rehydrated["hydrate"]();
    activeRuby = rehydrated;

    expect(rehydrated.getSchoolWorldEvents(10, now + 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "comic.page-unlocked",
        label: "Replayable public page",
        faculty: "ruby",
        grade: "10",
      }),
    ]));
    expect(rehydrated.worldHealthSnapshot(now + 2)).toMatchObject({
      activeStudents: 0,
      publicEventLogSize: 2,
      recentEvents: 2,
      summary: {
        schoolYear: "2025-2026",
        eventCount: 2,
        byKind: {
          "comic.page-unlocked": 1,
          "room.goal-progress": 1,
        },
      },
    });
  });

  it("hydrates legacy durable room outcomes with derived aggregate labels", async () => {
    const now = Date.UTC(2026, 5, 16, 12);
    const store = serviceStateOnlyStore([
      {
        id: "ruby-high:public-world-room-outcomes:v1",
        updatedAt: now,
        data: {
          version: 1,
          outcomes: [
            {
              day: "2026-06-16",
              schoolYear: "2025-2026",
              termId: "2025-2026",
              grade: "10",
              facultyId: "ruby",
              displayName: "Ruby",
              goalKind: "live-class",
              progress: 3,
              target: 3,
              contributorCount: 3,
              completedAt: now,
              createdAt: now,
            },
          ],
        },
      },
    ]);
    const ruby = new RubyHighService({} as never, store);
    await ruby["hydrate"]();
    activeRuby = ruby;

    expect(ruby.worldHealthSnapshot(now)).toMatchObject({
      durableRoomOutcomes: 1,
      recentRoomOutcomes: [
        expect.objectContaining({
          roomTitle: "Ruby room",
          summaryLabel: "Ruby live class completed 3/3 with 3 contributors",
          rewardKind: "study-spark",
          rewardLabel: "Ruby earned a class-wide Study Spark",
        }),
      ],
    });
  });

  it("promotes low-pool teacher agendas when an active term room rule needs that grade", async () => {
    const now = Date.UTC(2026, 5, 18, 12);
    const store = new StateStore(storePath);
    await store.saveServiceState({
      id: "ruby-high:public-world-events:v1",
      updatedAt: now,
      data: {
        version: 1,
        events: Array.from({ length: 6 }, (_value, index) => ({
          id: `world:event:${String(index + 1).padStart(16, "0")}`,
          kind: "room.goal-progress",
          at: now - index,
          faculty: "ruby",
          grade: "10",
          roomTitle: "Ruby room",
          goalKind: "live-class",
          progress: 3,
          target: 3,
          complete: true,
          label: "Ruby filled a live class goal",
          rewardLabel: "Ruby earned a class-wide Study Spark",
        })),
      },
    });
    const ruby = new RubyHighService({} as never, store);
    await ruby["hydrate"]();
    activeRuby = ruby;

    ruby["syncPublicWorldTeacherAgendaRecords"]([{
      grade: "10",
      facultyId: "ruby",
      displayName: "Ruby",
      lowPoolSessions: 1,
      exhaustedSessions: 0,
      repetitionPressure: 0,
      replenishment: {
        mode: "generate",
        targetDifficulty: "easy",
        targetNewQuestions: 12,
        focusSubjects: ["systems"],
        weakSubjects: ["systems"],
        recentConcepts: ["queues"],
        sourcePackets: [],
        corpusId: "ruby",
      },
    } as never], now);

    expect(ruby.worldHealthSnapshot(now)).toMatchObject({
      teacherAgendaExecution: {
        ready: 1,
        queued: 0,
        watching: 0,
      },
      recentTeacherAgendas: [
        expect.objectContaining({
          grade: "10",
          facultyId: "ruby",
          executionStatus: "ready",
          executionReason: "term-rule-pressure",
          nextAction: "generate-draft",
          priorityScore: 225,
          termRuleLabel: "Term Rally",
          termRuleTarget: 4,
        }),
      ],
    });

    await ruby["persistPublicWorldTeacherAgendaState"]({ surfaceErrors: true }, now);
    const agendaState = await store.loadServiceState?.("ruby-high:public-world-teacher-agendas:v1");
    expect(agendaState?.data).toMatchObject({
      agendas: [
        expect.objectContaining({
          executionStatus: "ready",
          executionReason: "term-rule-pressure",
          termRuleLabel: "Term Rally",
          termRuleTarget: 4,
        }),
      ],
    });
  });

  for (const backend of ["json", "sqlite"] as const) {
    it(`replays durable public-world state after restart from ${backend} store`, async () => {
      const now = Date.UTC(2026, 5, 16, 12);
      const schoolYear = "2025-2026";
      const records: StoredServiceStateRecord[] = [
        {
          id: "ruby-high:public-world-events:v1",
          updatedAt: now,
          data: {
            version: 1,
            events: [
              {
                id: "world:event:aaaaaaaaaaaaaaaa",
                kind: "room.goal-progress",
                at: now,
                faculty: "ruby",
                grade: "10",
                roomTitle: "Ruby room",
                goalKind: "live-class",
                progress: 3,
                target: 3,
                complete: true,
                label: "Ruby filled a live class goal",
                rewardLabel: "Ruby earned a class-wide Study Spark",
              },
            ],
          },
        },
        {
          id: "ruby-high:public-world-room-outcomes:v1",
          updatedAt: now,
          data: {
            version: 1,
            outcomes: [
              {
                day: "2026-06-16",
                schoolYear,
                termId: schoolYear,
                grade: "10",
                facultyId: "ruby",
                displayName: "Ruby",
                goalKind: "live-class",
                roomTitle: "Ruby room",
                summaryLabel: "Ruby live class completed 3/3 with 3 contributors",
                rewardKind: "study-spark",
                rewardLabel: "Ruby earned a class-wide Study Spark",
                progress: 3,
                target: 3,
                contributorCount: 3,
                completedAt: now,
                createdAt: now,
              },
            ],
          },
        },
        {
          id: "ruby-high:public-world-teacher-agendas:v1",
          updatedAt: now,
          data: {
            version: 1,
            agendas: [
              {
                schoolYear,
                termId: schoolYear,
                grade: "10",
                facultyId: "ruby",
                displayName: "Ruby",
                agendaKind: "curriculum-replenishment",
                mode: "generate",
                executionStatus: "ready",
                executionReason: "exhausted-pool",
                nextAction: "generate-draft",
                priorityScore: 125,
                targetDifficulty: "easy",
                targetNewQuestions: 12,
                lowPoolSessions: 1,
                exhaustedSessions: 1,
                repetitionPressure: 0,
                focusSubjects: ["systems"],
                weakSubjects: ["systems"],
                recentConcepts: ["B-trees"],
                sourcePacketIds: ["ruby-btrees"],
                corpusId: "ruby",
                generatedAt: now,
                updatedAt: now,
              },
            ],
          },
        },
      ];
      const jsonPath = join(tmpDir, `world-replay-${backend}.json`);
      const sqlitePath = join(tmpDir, `world-replay-${backend}.db`);
      let writer: StateStore | SqliteStateStore | null = backend === "json"
        ? new StateStore(jsonPath, { debounceMs: 0 })
        : new SqliteStateStore({ path: sqlitePath, ttlSeconds: 0 });
      for (const record of records) await writer.saveServiceState(record);
      await writer.flush?.();
      if (writer instanceof SqliteStateStore) writer.close();
      writer = null;

      const reader = backend === "json"
        ? new StateStore(jsonPath, { debounceMs: 0 })
        : new SqliteStateStore({ path: sqlitePath, ttlSeconds: 0 });
      let ruby: RubyHighService | null = null;
      try {
        ruby = new RubyHighService({} as never, reader);
        await ruby["hydrate"]();
        activeRuby = ruby;

        expect(ruby.getSchoolWorldEvents(10, now + 1)).toEqual([
          expect.objectContaining({
            kind: "room.goal-progress",
            complete: true,
            rewardLabel: "Ruby earned a class-wide Study Spark",
          }),
        ]);
        expect(ruby.worldHealthSnapshot(now + 1)).toMatchObject({
          activeStudents: 0,
          publicEventLogSize: 1,
          recentEvents: 1,
          durableRoomOutcomes: 1,
          recentRoomOutcomes: [
            expect.objectContaining({
              summaryLabel: "Ruby live class completed 3/3 with 3 contributors",
              rewardKind: "study-spark",
            }),
          ],
          durableTeacherAgendas: 1,
          teacherAgendaExecution: {
            ready: 1,
            queued: 0,
            watching: 0,
          },
          recentTeacherAgendas: [
            expect.objectContaining({
              executionStatus: "ready",
              nextAction: "generate-draft",
              priorityScore: 125,
            }),
          ],
          summary: {
            roomGoalEvents: {
              total: 1,
              complete: 1,
            },
            studySparks: {
              total: 1,
              byGrade: {
                "10": 1,
              },
            },
            termProgress: {
              label: "Term Spark 1/3",
              sparksToNextLevel: 2,
            },
          },
        });
      } finally {
        if (ruby) {
          await ruby.stop();
          if (activeRuby === ruby) activeRuby = null;
        }
        if (reader instanceof SqliteStateStore) reader.close();
      }
    });
  }

  it("ignores unknown or malformed durable public-world state during migration rollback", async () => {
    const now = Date.UTC(2026, 5, 16, 12);
    const store = serviceStateOnlyStore([
      {
        id: "ruby-high:public-world-events:v1",
        updatedAt: now,
        data: {
          version: 2,
          events: [{
            id: "world:event:future",
            kind: "room.goal-progress",
            at: now,
            label: "Future schema should be ignored",
          }],
        },
      },
      {
        id: "ruby-high:public-world-moderation:v1",
        updatedAt: now,
        data: {
          version: 1,
          suppressedEvents: [
            null,
            { eventId: "", reason: "spam", suppressedAt: now },
            { eventId: "world:event:bad reason", reason: "not-a-reason", suppressedAt: "soon" },
          ],
        },
      },
      {
        id: "ruby-high:public-world-rooms:v1",
        updatedAt: now,
        data: {
          version: 1,
          rooms: [
            null,
            { key: "2025-2026:10:ruby", schoolYear: "2025-2026", grade: "10", facultyId: "sally-science", activeStudents: 2, updatedAt: now },
            { key: "2025-2026:13:ruby", schoolYear: "2025-2026", grade: "13", facultyId: "ruby", activeStudents: 2, updatedAt: now },
            { schoolYear: "bad-year", grade: "10", facultyId: "ruby", activeStudents: 2, updatedAt: now },
          ],
        },
      },
      {
        id: "ruby-high:public-world-room-outcomes:v1",
        updatedAt: now,
        data: {
          version: 1,
          outcomes: [
            null,
            { id: "room:outcome:bad", day: "2026-06-16", grade: "10", facultyId: "ruby", schoolYear: "2025-2026", progress: 3, target: 3, completedAt: now },
            { day: "bad-day", grade: "10", facultyId: "ruby", schoolYear: "2025-2026", progress: 3, target: 3, completedAt: now },
            { day: "2026-06-16", grade: "13", facultyId: "ruby", schoolYear: "2025-2026", progress: 3, target: 3, completedAt: now },
          ],
        },
      },
      {
        id: "ruby-high:public-world-teacher-agendas:v1",
        updatedAt: now,
        data: {
          version: 1,
          agendas: [
            null,
            { id: "teacher:agenda:bad", schoolYear: "2025-2026", grade: "10", facultyId: "ruby", mode: "generate", targetDifficulty: "easy", generatedAt: now, updatedAt: now },
            { schoolYear: "bad-year", grade: "10", facultyId: "ruby", mode: "generate", targetDifficulty: "easy", generatedAt: now, updatedAt: now },
            { schoolYear: "2025-2026", grade: "13", facultyId: "ruby", mode: "generate", targetDifficulty: "easy", generatedAt: now, updatedAt: now },
            { schoolYear: "2025-2026", grade: "10", facultyId: "ruby", mode: "automatic", targetDifficulty: "easy", generatedAt: now, updatedAt: now },
          ],
        },
      },
      {
        id: "ruby-high:live-room-goals:v1",
        updatedAt: now,
        data: {
          version: 1,
          goals: [
            null,
            { grade: "13", facultyId: "ruby", day: "2026-06-16", contributors: ["public:bad"], updatedAt: now },
            { grade: "10", facultyId: "", day: "bad-day", contributors: [], updatedAt: 0 },
          ],
        },
      },
    ]);
    const ruby = new RubyHighService({} as never, store);
    await ruby["hydrate"]();
    activeRuby = ruby;

    expect(ruby.getSchoolWorldEvents(10, now)).toEqual([]);
    expect(ruby.worldHealthSnapshot(now)).toMatchObject({
      activeStudents: 0,
      activeRooms: 0,
      recentEvents: 0,
      durableRoomRecords: 0,
      durableRoomOutcomes: 0,
      recentRoomOutcomes: [],
      durableTeacherAgendas: 0,
      teacherAgendaExecution: {
        ready: 0,
        queued: 0,
        watching: 0,
      },
      recentTeacherAgendas: [],
      publicEventLogSize: 0,
      liveRoomGoals: 0,
      suppressedEvents: 0,
      summary: {
        eventCount: 0,
        roomGoalEvents: {
          total: 0,
          complete: 0,
        },
        studySparks: {
          total: 0,
        },
      },
    });
  });

  it("uses the supplied world clock for both room and cohort presence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const { ruby } = await makeServices();
      const stale = attachTestCharacter(ruby, "test:world-stale-cohort-clock");
      stale.sessionId = "test:world-stale-cohort-clock";
      stale.currentGrade = "10";
      stale.faculty = "ruby";
      stale.updatedAt = 0;
      stale.character!.name = "Stale Mina";
      stale.character!.createdAt = 0;
      stale.character!.dailyClasses = {
        ruby: {
          ...completedClassRecord("10", "ruby", "2026-06-01", "A", 300),
          completedAt: 0,
          updatedAt: 0,
        },
      };

      const world = ruby.getSchoolWorldSnapshot(10, 7 * 24 * 60 * 60 * 1000 + 2_000);

      expect(world.activeStudents).toBe(0);
      expect(world.activeRooms).toEqual([]);
      expect(world.cohorts).toEqual({});
      expect(JSON.stringify(world)).not.toContain("Stale Mina");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not count session metadata writes as public world activity", async () => {
    const { ruby } = await makeServices();
    const oldAt = Date.UTC(2026, 4, 1, 12);
    const now = Date.UTC(2026, 5, 15, 12);
    const metadataTouched = attachTestCharacter(ruby, "test:world-metadata-touch");
    metadataTouched.sessionId = "test:world-metadata-touch";
    metadataTouched.currentGrade = "10";
    metadataTouched.faculty = "ruby";
    metadataTouched.updatedAt = now;
    metadataTouched.character!.name = "Touched Noor";
    metadataTouched.character!.createdAt = oldAt;
    metadataTouched.character!.dailyClasses = {
      ruby: {
        ...completedClassRecord("10", "ruby", "2026-05-01", "A", 300),
        completedAt: oldAt,
        updatedAt: oldAt,
      },
    };

    const world = ruby.getSchoolWorldSnapshot(10, now);

    expect(world.activeStudents).toBe(0);
    expect(world.activeRooms).toEqual([]);
    expect(world.cohorts).toEqual({});
    expect(JSON.stringify(world)).not.toContain("Touched Noor");
  });

  it("refreshes public world snapshots from durable sessions without stale overwrites", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);

    const local = attachTestCharacter(ruby, "test:world-local-newer");
    local.sessionId = "test:world-local-newer";
    local.currentGrade = "10";
    local.faculty = "ruby";
    local.updatedAt = now + 500;
    local.character!.name = "Local Mina";
    local.character!.createdAt = now;
    const localClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    localClass.completedAt = now;
    localClass.updatedAt = now;
    local.character!.dailyClasses = { ruby: localClass };

    const template = structuredClone(ruby.getOrCreate("test:world-template")) as QuizState;
    const external = structuredClone(template) as QuizState;
    external.sessionId = "test:world-external";
    external.currentGrade = "10";
    external.faculty = "ruby";
    external.updatedAt = now + 100;
    const externalClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    externalClass.completedAt = now;
    externalClass.updatedAt = now;
    external.character = {
      name: "External Noor",
      playbookId: "lifer",
      stats: { head: 90, heart: 88, hustle: 86, honor: 84 },
      arcAnswer: "-",
      personality: "-",
      yearbook: [],
      createdAt: now,
      dailyClasses: {
        ruby: externalClass,
      },
    };

    const staleLocal = structuredClone(local) as QuizState;
    staleLocal.updatedAt = now;
    staleLocal.character!.name = "Stored Old Mina";

    const externalStore = new StateStore(storePath, { debounceMs: 0 });
    await externalStore.saveSession(external);
    await externalStore.saveSession(staleLocal);
    await externalStore.flush?.();

    const world = await ruby.getFreshSchoolWorldSnapshot(10, now + 1_000);
    const serialized = JSON.stringify(world);

    expect(world.activeStudents).toBe(2);
    expect(serialized).toContain("External Noor");
    expect(serialized).toContain("Local Mina");
    expect(serialized).not.toContain("Stored Old Mina");
  });

  it("uses the supplied world clock when throttling durable world refreshes", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    const store = ruby["store"] as StateStore;
    const loadSpy = vi.spyOn(store, "loadRecentSessions");

    await ruby.getFreshSchoolWorldSnapshot(10, now);
    await ruby.getFreshSchoolWorldSnapshot(10, now + 1_000);
    await ruby.getFreshSchoolWorldSnapshot(10, now + 1_999);
    await ruby.getFreshSchoolWorldSnapshot(10, now + 2_000);

    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(loadSpy).toHaveBeenLastCalledWith({
      since: now + 2_000 - 7 * 24 * 60 * 60 * 1000,
      limit: 5_000,
    });
  });

  it("keeps private curriculum pools out of public world snapshots", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    const customPack = fakeLeveledPack("pack:private-curriculum-world");

    const privateState = attachTestCharacter(ruby, "test:world-private-curriculum");
    privateState.sessionId = "test:world-private-curriculum";
    privateState.currentGrade = "9";
    privateState.faculty = "level-test-course";
    privateState.updatedAt = now;
    privateState.character!.name = "Private Course Mina";
    privateState.character!.socialConsent = false;
    privateState.character!.createdAt = now;
    privateState.character!.dailyClasses = {
      "level-test-course": completedClassRecord("9", "level-test-course", "2026-06-15", "A", 300),
    };
    registerPack(customPack, privateState.sessionId);
    ruby.setActivePackForSession(privateState.sessionId, customPack.id);

    const publicState = attachTestCharacter(ruby, "test:world-public-curriculum");
    publicState.sessionId = "test:world-public-curriculum";
    publicState.currentGrade = "10";
    publicState.faculty = "sally-science";
    publicState.updatedAt = now;
    publicState.character!.name = "Public Sally Noor";
    publicState.character!.createdAt = now;
    publicState.character!.dailyClasses = {
      "sally-science": completedClassRecord("10", "sally-science", "2026-06-15", "A", 300),
    };

    const adminCoverage = ruby.curriculumCoverageSnapshot();
    const world = ruby.getSchoolWorldSnapshot(10, now);

    expect(adminCoverage.lowPools.map((row) => row.facultyId)).toContain("level-test-course");
    expect(world.curriculum.activeCharacterSessions).toBe(1);
    expect(world.curriculum.lowPools.map((row) => row.facultyId)).not.toContain("level-test-course");
    expect(JSON.stringify(world)).not.toContain("Private Course Mina");
    expect(JSON.stringify(world)).not.toContain("level-test-course");
  });

  it("includes durable school outbox events in public world snapshots", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    const external = structuredClone(ruby.getOrCreate("test:world-outbox-template")) as QuizState;
    external.sessionId = "test:world-outbox";
    external.currentGrade = "10";
    external.faculty = "ruby";
    external.updatedAt = now;
    external.schoolEvents = [];
    external.character = {
      name: "Outbox Noor",
      playbookId: "lifer",
      stats: { head: 90, heart: 88, hustle: 86, honor: 84 },
      arcAnswer: "-",
      personality: "-",
      yearbook: [],
      createdAt: now,
      dailyClasses: {
        ruby: completedClassRecord("10", "ruby", "2026-06-15", "A", 300),
      },
    };
    const externalStore = new StateStore(storePath, { debounceMs: 0 });
    await externalStore.saveSession(external);
    await externalStore.saveSchoolEvent({
      id: "school:event:outbox-world",
      sessionId: external.sessionId,
      occurredAt: now + 1,
      day: "2026-06-15",
      event: {
        id: "school:event:outbox-world",
        kind: "comic.page-unlocked",
        at: now + 1,
        faculty: "ruby",
        grade: "10",
        issueId: "first-bell",
        pageId: "first-bell-outbox",
        pageNumber: 5,
        reason: "teacher-class-aced",
        sourceId: "teacher:ruby:grade:10",
        label: "Outbox public page",
      },
    });
    await externalStore.flush?.();

    const world = await ruby.getFreshSchoolWorldSnapshot(10, now + 2);

    expect(world.activeStudents).toBe(1);
    expect(world.recentEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "comic.page-unlocked",
        label: "Outbox public page",
      }),
    ]));
    expect(JSON.stringify(world)).not.toContain("school:event:outbox-world");
    expect(JSON.stringify(world)).not.toContain("teacher:ruby:grade:10");
  });

  it("keeps malformed durable characters out of public world snapshots", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    const completedClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    completedClass.completedAt = now;
    completedClass.updatedAt = now;

    const blankName = structuredClone(ruby.getOrCreate("test:world-blank-template")) as QuizState;
    blankName.sessionId = "test:world-blank-name";
    blankName.currentGrade = "10";
    blankName.faculty = "ruby";
    blankName.updatedAt = now;
    blankName.character = {
      name: "   ",
      playbookId: "lifer",
      stats: { head: 90, heart: 88, hustle: 86, honor: 84 },
      arcAnswer: "-",
      personality: "-",
      yearbook: [],
      createdAt: now,
      dailyClasses: {
        ruby: completedClass,
      },
    };

    const malformedClasses = structuredClone(blankName) as QuizState;
    malformedClasses.sessionId = "test:world-malformed-classes";
    malformedClasses.character = {
      ...blankName.character!,
      name: "Malformed Classes Noor",
      dailyClasses: "complete" as never,
    };

    const externalStore = new StateStore(storePath, { debounceMs: 0 });
    await externalStore.saveSession(blankName);
    await externalStore.saveSession(malformedClasses);
    await externalStore.flush?.();

    const world = await ruby.getFreshSchoolWorldSnapshot(10, now + 1_000);
    const serialized = JSON.stringify(world);

    expect(world.activeStudents).toBe(0);
    expect(world.activeRooms).toEqual([]);
    expect(world.cohorts).toEqual({});
    expect(serialized).not.toContain("Malformed Classes Noor");
  });

  it("bounds aggregate public world events across many active students", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);

    for (let i = 0; i < 130; i += 1) {
      const label = `World event ${String(i).padStart(3, "0")}`;
      const state = attachTestCharacter(ruby, `test:world-event-cap-${i}`);
      state.sessionId = `test:world-event-cap-${i}`;
      state.currentGrade = "10";
      state.faculty = "ruby";
      state.character!.name = `World Student ${String(i).padStart(3, "0")}`;
      state.character!.createdAt = now;
      const todayClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
      todayClass.completedAt = now;
      todayClass.updatedAt = now;
      state.character!.dailyClasses = { ruby: todayClass };
      state.schoolEvents.push({
        id: `school:event:world-cap-${i}`,
        kind: "comic.page-unlocked",
        at: now - i,
        faculty: "ruby",
        grade: "10",
        issueId: "first-bell",
        pageId: `first-bell-cap-${i}`,
        pageNumber: i,
        reason: "teacher-class-aced",
        sourceId: "teacher:ruby:grade:10",
        label,
      });
    }

    const world = ruby.getSchoolWorldSnapshot(120, now);
    const labels = world.recentEvents
      .filter((event) => event.kind === "comic.page-unlocked")
      .map((event) => event.label);

    expect(world.recentEvents).toHaveLength(100);
    expect(labels[0]).toBe("World event 000");
    expect(labels.at(-1)).toBe("World event 099");
    expect(labels).not.toContain("World event 100");
    expect(labels).not.toContain("World event 129");
    expect(ruby.getSchoolWorldSnapshot(0, now).recentEvents).toEqual([]);
  });

  it("bounds cached durable school events under world-feed pressure", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const state = attachTestCharacter(ruby, "test:world-event-cache-bound");
    state.sessionId = "test:world-event-cache-bound";
    state.currentGrade = "10";
    state.faculty = "ruby";
    state.character!.name = "Cache Noor";
    state.character!.createdAt = now;
    const todayClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    todayClass.completedAt = now;
    todayClass.updatedAt = now;
    state.character!.dailyClasses = { ruby: todayClass };
    const appendSchoolEvent = (ruby as unknown as {
      appendSchoolEvent(state: QuizState, event: QuizState["schoolEvents"][number]): void;
    }).appendSchoolEvent.bind(ruby);
    for (let i = 0; i < 430; i += 1) {
      const fresh = i < 420;
      const occurredAt = fresh ? now - i : now - 10 * 24 * 60 * 60 * 1000 - i;
      appendSchoolEvent(state, {
        id: `school:event:cache-bound-${i}`,
        kind: "comic.page-unlocked",
        at: occurredAt,
        faculty: "ruby",
        grade: "10",
        issueId: "first-bell",
        pageId: `first-bell-cache-${i}`,
        pageNumber: i + 1,
        reason: "teacher-class-aced",
        sourceId: "teacher:ruby:grade:10",
        label: `Cache event ${String(i).padStart(3, "0")}`,
      });
    }

    const world = ruby.getSchoolWorldSnapshot(100, now);
    const cached = ruby["schoolEventRecords"] as Map<string, unknown>;

    expect(cached.size).toBe(400);
    expect(world.recentEvents).toHaveLength(100);
    const comicEvents = world.recentEvents.filter((event) => event.kind === "comic.page-unlocked");
    expect(comicEvents[0]).toMatchObject({ kind: "comic.page-unlocked", label: "Cache event 000" });
    expect(comicEvents.at(-1)).toMatchObject({ kind: "comic.page-unlocked", label: "Cache event 099" });
    expect(JSON.stringify(world)).not.toContain("Cache event 420");
  });

  it("prunes stale durable school events even while the cache is under capacity", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const state = attachTestCharacter(ruby, "test:world-event-cache-stale-under-cap");
    state.sessionId = "test:world-event-cache-stale-under-cap";

    (ruby as unknown as {
      appendSchoolEvent(state: QuizState, event: QuizState["schoolEvents"][number]): void;
    }).appendSchoolEvent(state, {
      id: "school:event:cache-stale-under-cap",
      kind: "comic.page-unlocked",
      at: now - 10 * 24 * 60 * 60 * 1000,
      faculty: "ruby",
      grade: "10",
      issueId: "first-bell",
      pageId: "first-bell-cache-stale-under-cap",
      pageNumber: 1,
      reason: "teacher-class-aced",
      sourceId: "teacher:ruby:grade:10",
      label: "Stale cache event",
    });

    const cached = ruby["schoolEventRecords"] as Map<string, unknown>;

    expect(cached.size).toBe(0);
  });

  it("keeps inline portrait data out of the public world feed", async () => {
    const { ruby } = await makeServices();
    const now = Date.UTC(2026, 5, 15, 12);
    const inlineState = attachTestCharacter(ruby, "test:world-inline-portrait");
    inlineState.sessionId = "test:world-inline-portrait";
    inlineState.currentGrade = "10";
    inlineState.faculty = "ruby";
    inlineState.character!.name = "Inline Noor";
    inlineState.character!.createdAt = now;
    inlineState.character!.portraitDataUrl = "data:image/png;base64,INLINE";
    const inlineClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    inlineClass.completedAt = now;
    inlineClass.updatedAt = now;
    inlineState.character!.dailyClasses = { ruby: inlineClass };

    const pathState = attachTestCharacter(ruby, "test:world-path-portrait");
    pathState.sessionId = "test:world-path-portrait";
    pathState.currentGrade = "10";
    pathState.faculty = "ruby";
    pathState.character!.name = "Path Mina";
    pathState.character!.createdAt = now;
    pathState.character!.portraitDataUrl = "/api/apps/ruby-high/assets/portrait/path-mina.png";
    const pathClass = completedClassRecord("10", "ruby", "2026-06-15", "A", 300);
    pathClass.completedAt = now;
    pathClass.updatedAt = now;
    pathState.character!.dailyClasses = { ruby: pathClass };

    const world = ruby.getSchoolWorldSnapshot(10, now);
    const students = world.activeRooms.flatMap((room) => room.students);
    const inlineStudent = students.find((student) => student.name === "Inline Noor");
    const pathStudent = students.find((student) => student.name === "Path Mina");

    expect(inlineStudent).not.toHaveProperty("portraitUrl");
    expect(pathStudent).toMatchObject({
      portraitUrl: "/api/apps/ruby-high/assets/portrait/path-mina.png",
    });
    expect(JSON.stringify(world)).not.toContain("data:image");
    expect(JSON.stringify(world)).not.toContain("INLINE");
  });

  it("does not start duplicate X photo posts while a photo is in flight", async () => {
    let resolvePost: (tweetId: string | null) => void = () => {};
    const maybePostMilestone = vi.fn(
      () => new Promise<string | null>((resolve) => { resolvePost = resolve; }),
    );
    const runtime = {
      getService: (type: string) => {
        if (type !== "x-social") return null;
        return {
          listConnected: () => [{ teacherId: "ruby" }],
          getStatus: () => ({ connected: true }),
          maybePostMilestone,
        };
      },
    };
    const { ruby } = await makeServices();
    Object.defineProperty(ruby, "runtime", { value: runtime });

    const state = attachTestCharacter(ruby, "test:photo-in-flight");
    state.sessionId = "test:photo-in-flight";
    state.character!.name = "Noor";
    state.character!.pendingPhotos = [{
      photoId: "photo:class",
      kind: "class-photo",
      imageUrl: "data:image/png;base64,aW1hZ2U=",
      teacherFacultyId: "ruby",
      earnedAt: Date.now(),
    }];

    ruby.maybePostDailyPhoto();
    ruby.maybePostDailyPhoto();

    expect(maybePostMilestone).toHaveBeenCalledTimes(1);
    expect(ruby.photoPostSchedulerSnapshot()).toMatchObject({
      schedulerActive: false,
      schedulerRunning: false,
      schedulerIntervalMs: null,
      pendingPhotos: 1,
      inFlightPosts: 1,
      deferredPosts: 0,
      lastAttemptAt: expect.any(Number),
      lastResult: null,
    });

    resolvePost(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ruby.photoPostSchedulerSnapshot()).toMatchObject({
      pendingPhotos: 1,
      inFlightPosts: 0,
      deferredPosts: 1,
      nextRetryAt: expect.any(Number),
      lastAttemptAt: expect.any(Number),
      lastResult: expect.objectContaining({
        photoId: "photo:class",
        posted: false,
        revealed: false,
        deferredUntil: expect.any(Number),
      }),
    });

    ruby.maybePostDailyPhoto();
    expect(maybePostMilestone).toHaveBeenCalledTimes(1);

    (ruby as any).deferredPhotoPosts.set("photo:class", Date.now() - 1);
    ruby.maybePostDailyPhoto();
    expect(maybePostMilestone).toHaveBeenCalledTimes(2);
  });

  it("runs a single non-overlapping photo post scheduler tick and reports lifecycle state", async () => {
    let resolvePost!: (value: string | null) => void;
    const maybePostMilestone = vi.fn(
      () => new Promise<string | null>((resolve) => { resolvePost = resolve; }),
    );
    const runtime = {
      getService: (type: string) => {
        if (type !== "x-social") return null;
        return {
          listConnected: () => [{ teacherId: "ruby" }],
          getStatus: () => ({ connected: true }),
          maybePostMilestone,
        };
      },
    };
    const { ruby } = await makeServices();
    Object.defineProperty(ruby, "runtime", { value: runtime });

    const state = attachTestCharacter(ruby, "test:photo-scheduler");
    state.sessionId = "test:photo-scheduler";
    state.character!.name = "Mina";
    state.character!.pendingPhotos = [{
      photoId: "photo:scheduler",
      kind: "class-photo",
      imageUrl: "data:image/png;base64,aW1hZ2U=",
      teacherFacultyId: "ruby",
      earnedAt: Date.now(),
    }];

    ruby.startPhotoPostScheduler(10_000);
    expect(ruby.photoPostSchedulerSnapshot()).toMatchObject({
      schedulerActive: true,
      schedulerRunning: false,
      schedulerIntervalMs: 10_000,
    });

    const firstTick = ruby.runPhotoPostSchedulerTick();
    expect(maybePostMilestone).toHaveBeenCalledTimes(1);
    expect(ruby.photoPostSchedulerSnapshot()).toMatchObject({
      schedulerActive: true,
      schedulerRunning: true,
      inFlightPosts: 1,
    });

    await expect(ruby.runPhotoPostSchedulerTick()).resolves.toBeNull();
    expect(maybePostMilestone).toHaveBeenCalledTimes(1);

    resolvePost("tweet-scheduler");
    await expect(firstTick).resolves.toMatchObject({
      photoId: "photo:scheduler",
      posted: true,
      revealed: true,
      tweetId: "tweet-scheduler",
    });
    expect(ruby.photoPostSchedulerSnapshot()).toMatchObject({
      schedulerActive: true,
      schedulerRunning: false,
      pendingPhotos: 0,
      inFlightPosts: 0,
      lastResult: expect.objectContaining({ tweetId: "tweet-scheduler" }),
    });

    ruby.stopPhotoPostScheduler();
    expect(ruby.photoPostSchedulerSnapshot()).toMatchObject({
      schedulerActive: false,
      schedulerRunning: false,
      schedulerIntervalMs: null,
    });
  });

  it("persists deferred photo post retries across service restarts", async () => {
    const maybePostMilestone = vi.fn(async () => null);
    const runtime = {
      getService: (type: string) => {
        if (type !== "x-social") return null;
        return {
          listConnected: () => [{ teacherId: "ruby" }],
          getStatus: () => ({ connected: true }),
          maybePostMilestone,
        };
      },
    };
    const { ruby, faculty } = await makeServices();
    Object.defineProperty(ruby, "runtime", { value: runtime });

    const state = attachTestCharacter(ruby, "test:photo-restart");
    state.sessionId = "test:photo-restart";
    state.character!.name = "Iris";
    state.character!.pendingPhotos = [{
      photoId: "photo:restart",
      kind: "class-photo",
      imageUrl: "data:image/png;base64,aW1hZ2U=",
      teacherFacultyId: "ruby",
      earnedAt: Date.now(),
    }];

    await expect(ruby.maybePostDailyPhoto()).resolves.toMatchObject({
      photoId: "photo:restart",
      posted: false,
      revealed: false,
      deferredUntil: expect.any(Number),
    });
    expect(maybePostMilestone).toHaveBeenCalledTimes(1);
    const deferredUntil = ruby.photoPostSchedulerSnapshot().nextRetryAt;
    expect(deferredUntil).toEqual(expect.any(Number));

    await ruby.stop();

    const fresh = new RubyHighService({} as never, new StateStore(storePath));
    await fresh["hydrate"]();
    fresh.setFacultyService(faculty);
    Object.defineProperty(fresh, "runtime", { value: runtime });
    activeRuby = fresh;

    expect(fresh.photoPostSchedulerSnapshot()).toMatchObject({
      pendingPhotos: 1,
      deferredPosts: 1,
      nextRetryAt: deferredUntil,
      lastResult: expect.objectContaining({
        photoId: "photo:restart",
        posted: false,
        revealed: false,
        deferredUntil,
      }),
    });

    await expect(fresh.maybePostDailyPhoto()).resolves.toBeNull();
    expect(maybePostMilestone).toHaveBeenCalledTimes(1);
  });

  it("posts the requested class photo instead of randomly picking another pending photo", async () => {
    const maybePostMilestone = vi.fn(async (_teacher, ctx) => ctx.imageUrl?.includes("target") ? "tweet-target" : "tweet-wrong");
    const runtime = {
      getService: (type: string) => {
        if (type !== "x-social") return null;
        return {
          listConnected: () => [{ teacherId: "ruby" }],
          getStatus: () => ({ connected: true }),
          maybePostMilestone,
        };
      },
    };
    const { ruby } = await makeServices();
    Object.defineProperty(ruby, "runtime", { value: runtime });

    const older = attachTestCharacter(ruby, "test:photo-target-older");
    older.sessionId = "test:photo-target-older";
    older.character!.name = "Ari";
    older.character!.pendingPhotos = [{
      photoId: "photo:older",
      kind: "class-photo",
      imageUrl: "/api/apps/ruby-high/assets/class-photo/older.png",
      teacherFacultyId: "ruby",
      earnedAt: Date.now() - 10_000,
    }];

    const target = attachTestCharacter(ruby, "test:photo-target-new");
    target.sessionId = "test:photo-target-new";
    target.character!.name = "Noor";
    target.character!.pendingPhotos = [{
      photoId: "photo:target",
      kind: "class-photo",
      imageUrl: "/api/apps/ruby-high/assets/class-photo/target.png",
      teacherFacultyId: "ruby",
      earnedAt: Date.now(),
    }];

    const result = await ruby.maybePostDailyPhoto({ photoId: "photo:target" });

    expect(result).toMatchObject({
      photoId: "photo:target",
      posted: true,
      revealed: true,
      tweetId: "tweet-target",
    });
    expect(maybePostMilestone).toHaveBeenCalledTimes(1);
    expect(maybePostMilestone.mock.calls[0]?.[1]).toMatchObject({
      kind: "class-photo",
      characterName: "Noor",
      imageUrl: "/api/apps/ruby-high/assets/class-photo/target.png",
    });
    expect(older.character!.pendingPhotos).toHaveLength(1);
    expect(target.character!.pendingPhotos).toEqual([]);
    expect(target.character!.classPhotos).toHaveLength(1);
    expect(target.character!.classPhotos![0]).toMatchObject({
      photoId: "photo:target",
      imageUrl: "/api/apps/ruby-high/assets/class-photo/target.png",
      teacherFacultyId: "ruby",
      tweetId: "tweet-target",
      tweetedAt: expect.any(Number),
      revealedAt: expect.any(Number),
    });

    const blankHistory = attachTestCharacter(ruby, "test:photo-target-blank-history");
    blankHistory.sessionId = "test:photo-target-blank-history";
    blankHistory.character!.name = " ";
    blankHistory.character!.classPhotos = [{
      photoId: "photo:blank-history",
      imageUrl: "/api/apps/ruby-high/assets/class-photo/blank-history.png",
      teacherFacultyId: "ruby",
      earnedAt: Date.now(),
      revealedAt: Date.now(),
      tweetId: "tweet-blank",
      tweetedAt: Date.now(),
    }];

    const snapshot = ruby.getSchoolSnapshot();
    expect(snapshot.photoPool.filter((photo) => photo.kind === "class-photo").map((photo) => photo.studentName)).toEqual(["Ari"]);
    expect(snapshot.classPhotoHistory).toEqual([
      expect.objectContaining({
        studentName: "Noor",
        teacherFacultyId: "ruby",
        status: "posted",
        tweetId: "tweet-target",
        tweetedAt: expect.any(Number),
        revealedAt: expect.any(Number),
      }),
    ]);
    expect(JSON.stringify(snapshot.classPhotoHistory)).not.toContain("class-photo/target.png");
    expect(JSON.stringify(snapshot.classPhotoHistory)).not.toContain("blank-history");
  });

  it("keeps social-consent-off pending photos out of daily photo posting", async () => {
    const { ruby } = await makeServices();
    const today = dailyKey();
    const runtime = {
      getService: (type: string) => {
        if (type !== "x-social") return null;
        return {
          listConnected: () => [],
          getStatus: () => ({ connected: false }),
          maybePostMilestone: vi.fn(),
        };
      },
    };
    Object.defineProperty(ruby, "runtime", { value: runtime });

    const publicState = attachTestCharacter(ruby, "test:photo-public-consent");
    publicState.sessionId = "test:photo-public-consent";
    publicState.character!.name = "Noor";
    publicState.character!.dailyClasses = {
      ruby: completedClassRecord("9", "ruby", today, "A", 300),
    };
    publicState.character!.pendingPhotos = [{
      photoId: "photo:public",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/noor.png",
      teacherFacultyId: "ruby",
      earnedAt: Date.now(),
    }];

    const privateState = attachTestCharacter(ruby, "test:photo-private-consent");
    privateState.sessionId = "test:photo-private-consent";
    privateState.character!.name = "Ari";
    privateState.character!.socialConsent = false;
    privateState.character!.dailyClasses = {
      ruby: completedClassRecord("9", "ruby", today, "A", 300),
    };
    privateState.character!.pendingPhotos = [{
      photoId: "photo:private",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/ari.png",
      teacherFacultyId: "ruby",
      earnedAt: Date.now(),
    }];

    ruby.maybePostDailyPhoto();

    expect(publicState.character!.pendingPhotos).toEqual([]);
    expect(publicState.character!.portraitDataUrl).toBe("/api/apps/ruby-high/assets/portrait/noor.png");
    expect(privateState.character!.pendingPhotos).toHaveLength(1);
    expect(privateState.character!.portraitDataUrl).toBeUndefined();
  });

  it("reveals photos for disconnected teachers even when another teacher is connected to X", async () => {
    const maybePostMilestone = vi.fn(async () => "tweet-should-not-post");
    const runtime = {
      getService: (type: string) => {
        if (type !== "x-social") return null;
        return {
          listConnected: () => [{ teacherId: "ruby" }],
          getStatus: (teacherId: string) => ({ connected: teacherId === "ruby" }),
          maybePostMilestone,
        };
      },
    };
    const { ruby } = await makeServices();
    Object.defineProperty(ruby, "runtime", { value: runtime });

    const state = attachTestCharacter(ruby, "test:photo-disconnected-teacher");
    state.sessionId = "test:photo-disconnected-teacher";
    state.character!.name = "Noor";
    state.character!.dailyClasses = {
      "sally-science": completedClassRecord("9", "sally-science", dailyKey(), "A", 300),
    };
    state.character!.pendingPhotos = [{
      photoId: "photo:sally-disconnected",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/noor-sally.png",
      teacherFacultyId: "sally-science",
      earnedAt: Date.now(),
    }];

    const result = await ruby.maybePostDailyPhoto();

    expect(result).toMatchObject({
      photoId: "photo:sally-disconnected",
      teacherFacultyId: "sally-science",
      posted: false,
      revealed: true,
      fallback: true,
    });
    expect(maybePostMilestone).not.toHaveBeenCalled();
    expect(state.character!.pendingPhotos).toEqual([]);
    expect(state.character!.portraitDataUrl).toBe("/api/apps/ruby-high/assets/portrait/noor-sally.png");
  });

  it("does not send social-consent-off pending photos to connected X teachers", async () => {
    const maybePostMilestone = vi.fn(async () => "tweet-private");
    const runtime = {
      getService: (type: string) => {
        if (type !== "x-social") return null;
        return {
          listConnected: () => [{ teacherId: "ruby" }],
          getStatus: () => ({ connected: true }),
          maybePostMilestone,
        };
      },
    };
    const { ruby } = await makeServices();
    Object.defineProperty(ruby, "runtime", { value: runtime });

    const privateState = attachTestCharacter(ruby, "test:photo-private-x");
    privateState.sessionId = "test:photo-private-x";
    privateState.character!.name = "Ari";
    privateState.character!.socialConsent = false;
    privateState.character!.dailyClasses = {
      ruby: completedClassRecord("9", "ruby", dailyKey(), "A", 300),
    };
    privateState.character!.pendingPhotos = [{
      photoId: "photo:private-x",
      kind: "portrait",
      imageUrl: "/api/apps/ruby-high/assets/portrait/ari.png",
      teacherFacultyId: "ruby",
      earnedAt: Date.now(),
    }];

    ruby.maybePostDailyPhoto();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(maybePostMilestone).not.toHaveBeenCalled();
    expect(privateState.character!.pendingPhotos).toHaveLength(1);
    expect(privateState.character!.portraitDataUrl).toBeUndefined();
  });

  it("persists session state across a 'restart'", async () => {
    const { ruby } = await makeServices();
    const sid = "test:5";
    ruby.pickAndPose(sid, { faculty: "sally-science" });
    const correct = ruby.getOrCreate(sid).current!.correctChoice!;
    ruby.submitAnswer(sid, correct);
    await ruby.flush();

    const facultyB = await FacultyService.start({} as never);
    const rubyB = new RubyHighService({} as never, new StateStore(storePath));
    await rubyB["hydrate"]();
    rubyB.setFacultyService(facultyB);
    activeRuby = rubyB;

    const restored = rubyB.getOrCreate(sid);
    expect(restored.score.correct).toBe(1);
    expect(restored.score.total).toBe(1);
    expect(restored.wallet.meritStars).toBe(restored.score.points);
    expect(restored.wallet.hallPasses).toBe(0);
    expect(restored.askedQuestionIds.length).toBe(1);
    expect(restored.faculty).toBe("sally-science");
    await rubyB.flush();
  });

  it("clears a persisted activePackId when the imported pack body is gone", async () => {
    const { ruby } = await makeServices();
    const sid = "test:stranded-pack";
    const state = ruby.getOrCreate(sid);
    state.activePackId = "anki:missing";
    state.faculty = "missing-teacher";
    await ruby.flush();

    const facultyB = await FacultyService.start({} as never);
    const rubyB = new RubyHighService({} as never, new StateStore(storePath));
    await rubyB["hydrate"]();
    rubyB.setFacultyService(facultyB);
    activeRuby = rubyB;

    const restored = rubyB.getOrCreate(sid);
    expect(restored.activePackId).toBeNull();
    expect(restored.faculty).toBe("ruby");
  });

  it("treats a selected preset teacher as a course template, not the built-in bank", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-teacher-template";
    const pack = fakeAnkiPackWithSally();
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);

    let state = ruby.setFaculty(sid, "sally-science");
    expect(state.faculty).toBe("vocab-test-course");

    state = ruby.pickAndPose(sid, { faculty: "sally-science" });
    expect(state.current?.id).toBe("vocab-q1");
    expect(state.current?.faculty).toBe("vocab-test-course");
    expect(state.current?.subject).toBe("vocab");

    const bank = ruby.questionBankStatus(sid, "sally-science");
    expect(bank.facultyId).toBe("vocab-test-course");
    expect(bank.mode).toBe("srs");
    expect(bank.total).toBe(1);
  });

  it("routes daily bonus to a generated imported course when no built-in teacher template matches", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-generated-daily";
    const pack = fakeGeneratedAnkiPack();
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);

    const day = new Date("2026-05-04T18:00:00Z");
    expect(ruby.dailyStatus(sid, day).facultyId).toBe("generated-vocab-course");

    const posed = ruby.playBonus(sid, day);
    expect(posed.faculty).toBe("generated-vocab-course");
    expect(posed.current?.id).toBe("generated-vocab-q1");
  });

  it("draws bank questions at the current year level or lower", async () => {
    const { ruby } = await makeServices();
    const sid = "test:level-gate";
    const pack = fakeLeveledPack();
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    ruby.selectGrade(sid, "10");

    const state = ruby.getOrCreate(sid);
    state.askedQuestionIds = ["level-medium"];
    const picked = ruby.pickAndPose(sid, { faculty: "level-test-course" });
    expect(["level-easy", "level-medium"]).toContain(picked.current?.id);
    ruby.submitAnswer(sid, picked.current!.correctChoice!);

    const review = ruby.pickAndPose(sid, { faculty: "level-test-course" });
    expect(["level-easy", "level-medium"]).toContain(review.current?.id);
    const status = ruby.questionBankStatus(sid, "level-test-course");
    expect(status.total).toBe(2);
    expect(status.remainingByDifficulty.hard).toBeUndefined();
  });

  it("unlocks hard bank questions for Senior year", async () => {
    const { ruby } = await makeServices();
    const sid = "test:level-gate-senior";
    const pack = fakeLeveledPack("pack:level-test-senior");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    ruby.selectGrade(sid, "12");

    const state = ruby.getOrCreate(sid);
    state.askedQuestionIds = ["level-easy", "level-medium"];
    state.cardMemory = {
      "level-test-course::level-easy": {
        courseId: "level-test-course",
        questionId: "level-easy",
        phase: "mastered",
        dueAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
        stability: 14,
        difficulty: 0.1,
        consecutiveCorrect: 3,
        correctCount: 3,
        wrongCount: 0,
        delayedCorrectCount: 1,
        lapses: 0,
      },
      "level-test-course::level-medium": {
        courseId: "level-test-course",
        questionId: "level-medium",
        phase: "mastered",
        dueAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
        stability: 14,
        difficulty: 0.1,
        consecutiveCorrect: 3,
        correctCount: 3,
        wrongCount: 0,
        delayedCorrectCount: 1,
        lapses: 0,
      },
    };
    const picked = ruby.pickAndPose(sid, { faculty: "level-test-course" });
    expect(picked.current?.id).toBe("level-hard");
  });

  it("uses due-card review for imported Anki packs instead of one-use exhaustion", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-srs-due";
    const pack = fakeAnkiPackWithSally("anki:vocab-srs-due", "vocab-due-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);

    let state = ruby.getOrCreate(sid);
    state.askedQuestionIds = ["vocab-due-q1"];

    let bank = ruby.questionBankStatus(sid, "sally-science");
    expect(bank.mode).toBe("srs");
    expect(bank.remaining).toBe(1);
    expect(bank.readyCount).toBe(1);

    state = ruby.pickAndPose(sid, { faculty: "sally-science", subject: "science" });
    expect(state.current?.id).toBe("vocab-due-q1");
    ruby.submitAnswer(sid, "B");

    bank = ruby.questionBankStatus(sid, "sally-science");
    expect(bank.remaining).toBe(0);
    expect(bank.shakyCount).toBe(1);

    const memory = ruby.getOrCreate(sid).cardMemory!;
    const key = Object.keys(memory)[0]!;
    memory[key]!.dueAt = Date.now() - 1;
    bank = ruby.questionBankStatus(sid, "sally-science");
    expect(bank.remaining).toBe(1);
    expect(ruby.pickAndPose(sid, { faculty: "sally-science" }).current?.id).toBe("vocab-due-q1");
  });

  it("withholds an imported deck course grade before the three-class streak", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-srs-grade";
    const pack = fakeAnkiPackWithSally("anki:vocab-srs-grade", "vocab-grade-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);
    ruby.selectGrade(sid, "12");

    for (let i = 0; i < 3; i++) {
      const state = ruby.pickAndPose(sid, { faculty: "sally-science" });
      ruby.submitAnswer(sid, state.current!.correctChoice!);
      const memory = ruby.getOrCreate(sid).cardMemory!;
      const key = Object.keys(memory)[0]!;
      memory[key]!.dueAt = Date.now() - 1;
    }

    const bank = ruby.questionBankStatus(sid, "sally-science");
    expect(bank.grade).toBeUndefined();
    expect(bank.courseGrade).toBeUndefined();
    expect(bank.completedClasses).toBe(1);
    expect(bank.requiredClasses).toBe(3);
    expect(bank.masteredCount).toBe(1);
    expect(bank.remaining).toBe(1);
  });

  it("reports a course grade only after three C-or-better classes in a row", async () => {
    const { ruby } = await makeServices();
    const sid = "test:course-grade-streak";
    const state = attachTestCharacter(ruby, sid);
    ruby.selectGrade(sid, "12");
    const facultyId = "sally-science";
    state.character!.dailyClasses = {
      "12:sally-science:2026-05-01": completedClassRecord("12", facultyId, "2026-05-01", "A", 270),
      "12:sally-science:2026-05-02": completedClassRecord("12", facultyId, "2026-05-02", "B", 240),
    };

    let bank = ruby.questionBankStatus(sid, facultyId);
    expect(bank.grade).toBeUndefined();
    expect(bank.courseGrade).toBeUndefined();
    expect(bank.completedClasses).toBe(2);
    expect(bank.requiredClasses).toBe(3);

    state.character!.dailyClasses["12:sally-science:2026-05-03"] =
      completedClassRecord("12", facultyId, "2026-05-03", "F", 0);
    bank = ruby.questionBankStatus(sid, facultyId);
    expect(bank.grade).toBeUndefined();
    expect(bank.courseGrade).toBeUndefined();
    expect(bank.completedClasses).toBe(0);

    state.character!.dailyClasses["12:sally-science:2026-05-04"] =
      completedClassRecord("12", facultyId, "2026-05-04", "A", 270);
    state.character!.dailyClasses["12:sally-science:2026-05-05"] =
      completedClassRecord("12", facultyId, "2026-05-05", "B", 240);
    state.character!.dailyClasses["12:sally-science:2026-05-06"] =
      completedClassRecord("12", facultyId, "2026-05-06", "C", 210);
    bank = ruby.questionBankStatus(sid, facultyId);
    expect(bank.grade).toBe("B");
    expect(bank.courseGrade).toBe("B");
    expect(bank.completedClasses).toBe(3);
    expect(bank.requiredClasses).toBe(3);
    expect(bank.averageScore).toBe(80);
  });

  it("lets Sophomore choose one elective room and keeps extra rooms as practice", async () => {
    const { ruby } = await makeServices();
    const sid = "test:sophomore-elective-choice";
    attachTestCharacter(ruby, sid);
    ruby.selectGrade(sid, "10");

    expect(ruby.graduationGate(sid)).toMatchObject({
      grade: "10",
      requiredDays: 1,
      requiredRooms: 2,
      requiredFacultyIds: ["ruby"],
      openElectiveSlots: 1,
    });

    let state = ruby.pickAndPose(sid, { faculty: "sally-science" });
    expect(state.activeRound?.classSession?.mode).toBe("class");
    expect(state.character?.graduationClassrooms?.["10"]).toEqual(["ruby", "sally-science"]);
    expect(ruby.graduationGate(sid)).toMatchObject({
      requiredFacultyIds: ["ruby", "sally-science"],
      openElectiveSlots: 0,
    });

    ruby.submitAnswer(sid, state.current!.correctChoice!);
    ruby.clearBoard(sid);
    state = ruby.pickAndPose(sid, { faculty: "professor-edward" });
    expect(state.activeRound?.classSession?.mode).toBe("practice");
    expect(state.character?.dailyClasses?.[`10:professor-edward:${dailyKey()}`]).toBeUndefined();
    expect(ruby.courseProgress(sid, "professor-edward")).toMatchObject({
      requiredClasses: 0,
      today: { mode: "practice", status: "available", questionCount: 0 },
    });
  });

  it("keeps successful class mastery credit normal while carrying a one-day streak", async () => {
    const { ruby } = await makeServices();
    const sid = "test:streak-score-multiplier";
    const pack = fakeAnkiPackWithSally("anki:vocab-streak-score", "vocab-streak-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid, 1);

    const realNow = Date.now;
    try {
      Date.now = () => new Date("2026-05-05T18:00:00Z").getTime();
      for (let i = 0; i < 3; i++) {
        const posed = ruby.pickAndPose(sid, { faculty: "vocab-test-course" });
        ruby.submitAnswer(sid, posed.current!.correctChoice!);
        ruby.getOrCreate(sid).cardMemory!["vocab-test-course::vocab-streak-q1"]!.dueAt = Date.now() - 1;
      }
    } finally {
      Date.now = realNow;
    }

    const after = ruby.getOrCreate(sid);
    const memory = after.cardMemory!["vocab-test-course::vocab-streak-q1"]!;
    expect(after.score).toMatchObject({ correct: 3, total: 3, points: 300, possible: 300 });
    expect(after.character!.streak).toEqual({ grade: "9", count: 2, lastDate: "2026-05-05" });
    expect(after.lastReveal?.scoreMultiplier).toBe(1);
    expect(after.lastReveal?.classProgress?.completed).toBe(true);
    expect(memory.correctCount).toBe(3);
    expect(memory.consecutiveCorrect).toBe(3);
    expect(memory.lastScoreMultiplier).toBe(1);
  });

  it("awards multiplied visible score for practice without advancing the daily class", async () => {
    const { ruby } = await makeServices();
    const sid = "test:practice-score-multiplier";
    const pack = fakeAnkiPackWithSally("anki:vocab-practice-score", "vocab-practice-score-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid, 3);

    const realNow = Date.now;
    try {
      Date.now = () => new Date("2026-05-05T18:00:00Z").getTime();
      const posed = ruby.pickAndPose(sid, { faculty: "vocab-test-course", mode: "practice" });
      ruby.submitAnswer(sid, posed.current!.correctChoice!);
    } finally {
      Date.now = realNow;
    }

    const after = ruby.getOrCreate(sid);
    expect(after.lastReveal?.classProgress?.mode).toBe("practice");
    expect(after.lastReveal?.scoreMultiplier).toBe(3);
    expect(after.lastReveal?.scoreAward).toMatchObject({ base: 100, multiplier: 3, points: 300, possible: 300 });
    expect(after.score).toMatchObject({ correct: 1, total: 1, points: 300, possible: 300 });
    expect(after.character!.dailyClasses ?? {}).toEqual({});
    expect(after.character!.streak).toEqual({ grade: "9", count: 3, lastDate: "2026-05-04" });
  });

  it("lets explicit practice review a completed class even when no card is due", async () => {
    const { ruby } = await makeServices();
    const sid = "test:post-class-practice-force";
    const pack = fakeLeveledPack("pack:post-class-practice-force");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);
    ruby.selectGrade(sid, "12");

    const answeredIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const posed = ruby.pickAndPose(sid, { faculty: "level-test-course" });
      answeredIds.push(posed.current!.id);
      ruby.submitAnswer(sid, posed.current!.correctChoice!);
      ruby.clearBoard(sid);
    }

    expect(ruby.courseProgress(sid, "level-test-course").today.status).toBe("complete");
    expect(ruby.questionBankStatus(sid, "level-test-course").canPick).toBe(false);

    const practice = ruby.pickAndPose(sid, { faculty: "level-test-course", mode: "practice" });
    expect(practice.current).not.toBeNull();
    expect(answeredIds).toContain(practice.current!.id);
    expect(practice.activeRound?.classSession?.mode).toBe("practice");
  });

  it("reports today's correct answer count in course progress", async () => {
    const { ruby } = await makeServices();
    const sid = "test:today-correct-count";
    const pack = fakeLeveledPack("pack:today-correct-count");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);
    ruby.selectGrade(sid, "12");
    ruby.getOrCreate(sid).character!.stats = { head: -99, heart: -99, hustle: -99, honor: -99 };

    for (let i = 0; i < 3; i += 1) {
      const posed = ruby.pickAndPose(sid, { faculty: "level-test-course" });
      const correct = posed.current!.correctChoice!;
      const wrong = correct === "A" ? "B" : "A";
      ruby.submitAnswer(sid, i === 2 ? wrong : correct);
      ruby.clearBoard(sid);
    }

    const progress = ruby.courseProgress(sid, "level-test-course");
    expect(progress.today).toMatchObject({
      status: "complete",
      questionCount: 3,
      correctCount: 2,
      totalQuestions: 3,
      letterGrade: "C-",
      score: 67,
    });
  });

  it("uses rolls only for the class grade suffix", async () => {
    const { ruby } = await makeServices();
    const sid = "test:roll-suffix-correctness-grade";
    const pack = fakeLeveledPack("pack:roll-suffix-correctness-grade");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);
    ruby.selectGrade(sid, "12");
    ruby.getOrCreate(sid).character!.stats = { head: 99, heart: 99, hustle: 99, honor: 99 };
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    let missedAnswerText = "";
    let correctAnswerText = "";

    for (let i = 0; i < 3; i += 1) {
      const posed = ruby.pickAndPose(sid, { faculty: "level-test-course" });
      const correct = posed.current!.correctChoice!;
      const wrong = correct === "A" ? "B" : "A";
      if (i === 2) {
        missedAnswerText = posed.current!.options![wrong]!;
        correctAnswerText = posed.current!.options![correct]!;
      }
      ruby.submitAnswer(sid, i === 2 ? wrong : correct);
      ruby.clearBoard(sid);
    }

    const progress = ruby.courseProgress(sid, "level-test-course");
    expect(progress.today).toMatchObject({
      correctCount: 2,
      totalQuestions: 3,
      letterGrade: "C+",
      score: 67,
      result: {
        version: 1,
        wasCorrect: false,
        forfeit: false,
        answerText: missedAnswerText,
        correctAnswerText,
        teacherObservation: expect.stringContaining(`review “${correctAnswerText}”`),
        consequenceLabel: "Passing class recorded",
      },
    });
  });

  it("applies 2x class mastery credit when carrying a two-day streak", async () => {
    const { ruby } = await makeServices();
    const sid = "test:streak-score-two-day";
    const pack = fakeAnkiPackWithSally("anki:vocab-streak-two-day", "vocab-streak-two-day-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid, 2);

    const realNow = Date.now;
    try {
      Date.now = () => new Date("2026-05-05T18:00:00Z").getTime();
      for (let i = 0; i < 3; i++) {
        const posed = ruby.pickAndPose(sid, { faculty: "vocab-test-course" });
        ruby.submitAnswer(sid, posed.current!.correctChoice!);
        ruby.getOrCreate(sid).cardMemory!["vocab-test-course::vocab-streak-two-day-q1"]!.dueAt = Date.now() - 1;
      }
    } finally {
      Date.now = realNow;
    }

    const after = ruby.getOrCreate(sid);
    const memory = after.cardMemory!["vocab-test-course::vocab-streak-two-day-q1"]!;
    expect(after.character!.streak).toEqual({ grade: "9", count: 3, lastDate: "2026-05-05" });
    expect(after.lastReveal?.scoreMultiplier).toBe(2);
    expect(after.lastReveal?.classProgress?.completed).toBe(true);
    expect(memory.correctCount).toBe(6);
    expect(memory.consecutiveCorrect).toBe(6);
    expect(memory.lastScoreMultiplier).toBe(2);
  });

  it("applies 3x class mastery credit when carrying a three-day streak", async () => {
    const { ruby } = await makeServices();
    const sid = "test:streak-score-three-day";
    const pack = fakeAnkiPackWithSally("anki:vocab-streak-three-day", "vocab-streak-three-day-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid, 3);

    const realNow = Date.now;
    try {
      Date.now = () => new Date("2026-05-05T18:00:00Z").getTime();
      for (let i = 0; i < 3; i++) {
        const posed = ruby.pickAndPose(sid, { faculty: "vocab-test-course" });
        ruby.submitAnswer(sid, posed.current!.correctChoice!);
        ruby.getOrCreate(sid).cardMemory!["vocab-test-course::vocab-streak-three-day-q1"]!.dueAt = Date.now() - 1;
      }
    } finally {
      Date.now = realNow;
    }

    const after = ruby.getOrCreate(sid);
    const memory = after.cardMemory!["vocab-test-course::vocab-streak-three-day-q1"]!;
    expect(after.character!.streak).toEqual({ grade: "9", count: 4, lastDate: "2026-05-05" });
    expect(after.lastReveal?.scoreMultiplier).toBe(3);
    expect(after.lastReveal?.classProgress?.completed).toBe(true);
    expect(memory.correctCount).toBe(9);
    expect(memory.consecutiveCorrect).toBe(9);
    expect(memory.lastScoreMultiplier).toBe(3);
  });

  it("caps the daily-class counter with a 5x Daily Class Bonus", async () => {
    const { ruby } = await makeServices();
    const sid = "test:streak-score-cap";
    const pack = fakeAnkiPackWithSally("anki:vocab-streak-cap", "vocab-streak-cap-q1");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid, 5);

    const realNow = Date.now;
    try {
      Date.now = () => new Date("2026-05-05T18:00:00Z").getTime();
      for (let i = 0; i < 3; i++) {
        const posed = ruby.pickAndPose(sid, { faculty: "vocab-test-course" });
        ruby.submitAnswer(sid, posed.current!.correctChoice!);
        ruby.getOrCreate(sid).cardMemory!["vocab-test-course::vocab-streak-cap-q1"]!.dueAt = Date.now() - 1;
      }
    } finally {
      Date.now = realNow;
    }

    const after = ruby.getOrCreate(sid);
    const memory = after.cardMemory!["vocab-test-course::vocab-streak-cap-q1"]!;
    expect(after.character!.streak).toEqual({ grade: "9", count: 5, lastDate: "2026-05-05" });
    expect(after.lastReveal?.scoreMultiplier).toBe(5);
    expect(after.lastReveal?.classProgress?.completed).toBe(true);
    expect(memory.correctCount).toBe(15);
    expect(memory.consecutiveCorrect).toBe(15);
    expect(memory.lastScoreMultiplier).toBe(5);
  });

  it("uses the same in-progress course-grade model for Ruby High packs", async () => {
    const { ruby } = await makeServices();
    const sid = "test:ruby-bank-mastery-grade";
    const pack = fakeLeveledPack("pack:ruby-bank-mastery-grade");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);
    ruby.selectGrade(sid, "12");

    for (let i = 0; i < 3; i++) {
      const state = ruby.pickAndPose(sid, { faculty: "level-test-course" });
      const questionId = state.current?.id;
      expect(questionId).toMatch(/^level-/);
      ruby.submitAnswer(sid, state.current!.correctChoice!);
      const memory = ruby.getOrCreate(sid).cardMemory!;
      memory[`level-test-course::${questionId}`]!.dueAt = Date.now() - 1;
    }

    const bank = ruby.questionBankStatus(sid, "level-test-course");
    expect(bank.mode).toBe("bank");
    expect(bank.grade).toBeUndefined();
    expect(bank.completedClasses).toBe(1);
    expect(bank.requiredClasses).toBe(3);
  });

  it("poses imported source cards as typed-answer questions and grades exact text", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-source-typed-answer";
    const pack = fakeAnkiSourcePack();
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);

    let state = ruby.pickAndPose(sid, { faculty: "vocab-source-course" });
    expect(state.current).toMatchObject({
      id: "anki-vocab-card-1",
      type: "typed-answer",
      prompt: "What does ephemeral mean?",
      expectedAnswer: "short-lived",
      canGenerateMc: true,
    });
    expect(state.current?.options).toBeUndefined();
    expect(state.activeRound?.type).toBe("typed-answer");
    expect(state.activeRound?.npcs).toEqual([]);

    state = ruby.submitTextAnswer(sid, "short-lived");
    expect(state.lastReveal).toMatchObject({
      questionId: "anki-vocab-card-1",
      wasCorrect: true,
      answerText: "short-lived",
      expectedAnswer: "short-lived",
      answerJudge: { mode: "exact", score: 1 },
    });
    expect(state.history.at(-1)).toMatchObject({
      questionId: "anki-vocab-card-1",
      answerText: "short-lived",
      expectedAnswer: "short-lived",
      wasCorrect: true,
    });
  });

  it("rotates the durable answer history while preserving score totals", async () => {
    const { ruby } = await makeServices();
    const sid = "test:answer-history-cap";
    const state = ruby.getOrCreate(sid);
    const append = (ruby as unknown as {
      appendAnswerHistory: (state: QuizState, record: AnswerRecord) => void;
    }).appendAnswerHistory.bind(ruby);

    for (let i = 0; i < 525; i++) {
      append(state, {
        questionId: `q-${i % 500}`,
        picked: "A",
        correct: "A",
        wasCorrect: true,
        at: i,
      });
      state.score.correct += 1;
      state.score.total += 1;
    }

    expect(state.history).toHaveLength(500);
    expect(state.history[0]?.questionId).toBe("q-25");
    expect(state.history.at(-1)?.questionId).toBe("q-24");
    expect(state.score).toMatchObject({ correct: 525, total: 525 });
    expect(state.answerStats).toEqual({ totalAnswers: 525, repeatedAnswers: 25 });
    expect(ruby.analyticsSnapshot().balance.repeatRate).toEqual({
      totalAnswers: 525,
      repeatedAnswers: 25,
      rate: 25 / 525,
    });
  });

  it("does not seat classmates who have drifted out of the player's grade", async () => {
    const { ruby } = await makeServices();
    const sid = "test:cohort-drift-seating";
    const state = attachTestCharacter(ruby, sid);
    state.npcCohort = [
      {
        id: "lyra",
        grade: "10",
        streak: { grade: "10", count: 0 },
        completedGrades: ["9"],
        graduated: false,
      },
      {
        id: "mika",
        grade: "12",
        streak: { grade: "12", count: 4 },
        completedGrades: ["9", "10", "11", "12"],
        graduated: true,
      },
    ];

    const posed = ruby.pickAndPose(sid, { faculty: "ruby" });

    expect(posed.activeRound?.npcs.map((n) => n.studentId)).toEqual([]);
  });

  it("generates imported-card MC distractors only when explicitly requested", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-source-jit-mc";
    const pack = fakeAnkiSourcePack("anki:vocab-source-jit");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(["ancient", "loud", "careful"]) } }],
      }), { status: 200 }),
    );

    let state = ruby.pickAndPose(sid, { faculty: "vocab-source-course" });
    expect(state.current?.type).toBe("typed-answer");
    expect(fetchMock).not.toHaveBeenCalled();

    state = await ruby.generateCurrentMcQuestion(sid, "sk-test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.current).toMatchObject({
      id: "anki-vocab-card-1",
      type: "multiple-choice",
      sourceCardId: "anki-vocab-card-1",
      canGenerateMc: false,
      faculty: "vocab-source-course",
    });
    expect(state.current?.options).toBeTruthy();
    expect(state.current?.correct).toBeTruthy();
    expect(pack.faculty[0]!.questions).toHaveLength(1);
    expect(pack.faculty[0]!.questions[0]).toMatchObject({
      id: "anki-vocab-card-1",
      type: "multiple-choice",
      sourceCardId: "anki-vocab-card-1",
    });
  });

  it("does not overwrite the board if MC generation finishes after the source card changed", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-source-jit-mc-stale";
    const pack = fakeAnkiSourcePack("anki:vocab-source-jit-stale");
    registerPack(pack, sid);
    ruby.setActivePackForSession(sid, pack.id);
    attachTestCharacter(ruby, sid);
    ruby.pickAndPose(sid, { faculty: "vocab-source-course" });

    let release: ((value: Response) => void) | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => { release = resolve; }),
    );

    const generating = ruby.generateCurrentMcQuestion(sid, "sk-test");
    expect(release).toBeTypeOf("function");
    ruby.submitTextAnswer(sid, "short-lived");
    release!(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(["ancient", "loud", "careful"]) } }],
    }), { status: 200 }));

    await expect(generating).rejects.toThrow(/source card changed/i);
    const after = ruby.getOrCreate(sid);
    expect(after.current).toMatchObject({
      id: "anki-vocab-card-1",
      type: "typed-answer",
      canGenerateMc: true,
    });
    expect(after.activeRound?.resolved).toBe(true);
    expect(after.lastReveal?.answerText).toBe("short-lived");
  });

  it("keeps custom questions in the imported course when a teacher template id appears in tool args", async () => {
    const { ruby } = await makeServices();
    const sid = "test:anki-custom-question-template";
    const pack = fakeAnkiPackWithSally();
    pack.id = "anki:vocab-custom-template";
    registerPack(pack, sid);
    let state = ruby.getOrCreate(sid);
    state.subject = "general-knowledge";
    state = ruby.setActivePackForSession(sid, pack.id);
    expect(state.subject).toBeNull();

    state = ruby.pose(sid, {
      prompt: "What does lucid mean?",
      options: { A: "clear", B: "sticky", C: "ancient", D: "noisy" },
      correct: "A",
      subject: "science",
      faculty: "sally-science",
    });

    expect(state.activePackId).toBe(pack.id);
    expect(state.faculty).toBe("vocab-test-course");
    expect(state.current?.faculty).toBe("vocab-test-course");
    expect(state.current?.subject).toBe("vocab");
  });

  it("promotes teacher-authored Ruby High questions into the global bank", async () => {
    const { ruby, faculty } = await makeServices();
    const sid = "test:global-custom-bank";
    const before = faculty.bank("ruby")!.questions.length;

    const state = ruby.pose(sid, {
      prompt: "Which classroom rule keeps Ruby High agents from pretending old context is new?",
      options: {
        A: "Use fresh room events",
        B: "Ignore the board",
        C: "Delete the teacher",
        D: "Shuffle the class list",
      },
      correct: "A",
      explanation: "Room events are rebuilt per turn instead of accumulating as stale instructions.",
      subject: "agent-culture",
      faculty: "ruby",
      persistToBank: true,
    });

    expect(state.current?.id).toMatch(/^q_/);
    expect(faculty.bank("ruby")!.questions.length).toBe(before + 1);
    expect(faculty.bank("ruby")!.questions.at(-1)).toMatchObject({
      id: state.current?.id,
      prompt: state.current?.prompt,
      faculty: "ruby",
      subject: "agent-culture",
    });

    await ruby.flush();
    resetActivePack();
    const facultyB = await FacultyService.start({} as never);
    const rubyB = new RubyHighService({} as never, new StateStore(storePath));
    await rubyB["hydrate"]();
    rubyB.setFacultyService(facultyB);
    activeRuby = rubyB;

    expect(facultyB.bank("ruby")!.questions.some((q) => q.id === state.current?.id)).toBe(true);
  });

  it("closes a core daily class with a graded take after two evidence cards", async () => {
    const { ruby, faculty } = await makeServices();
    const sid = "test:ruby-social-deck";
    ruby.selectGrade(sid, "10");
    const state = ruby.getOrCreate(sid);
    state.character = {
      name: "Test",
      playbookId: "heart",
      stats: { head: 99, heart: 99, hustle: 99, honor: 99 },
      arcAnswer: "—",
      personality: "—",
      yearbook: [],
      createdAt: Date.now(),
    };

    const roles: string[] = [];
    let takeSession: QuizState["activeRound"] = null;
    for (let i = 0; i < 10; i++) {
      const posed = ruby.pickAndPose(sid, { faculty: "ruby" });
      roles.push(posed.activeRound?.cardRole ?? "missing");
      if (posed.activeRound?.type === "opinion") {
        takeSession = structuredClone(posed.activeRound);
        expect(posed.current?.opinionPurpose).toBe("daily-take");
        ruby.recordOpinion(sid, "player", "I trust specific evidence and check claims that skip the source.");
        ruby.recordGrades(sid, [{ responder: "player", score: 8, comment: "Specific and grounded." }], "player");
      } else {
        ruby.submitAnswer(sid, posed.current!.correctChoice!);
      }
      if (i < 9) ruby.clearBoard(sid);
    }

    expect(roles).toEqual(["class", "class", "social", "practice", "practice", "practice", "practice", "practice", "practice", "practice"]);
    expect(takeSession).toMatchObject({
      type: "opinion",
      cardRole: "social",
      classSession: { mode: "class", index: 3, total: 3 },
    });
    const record = ruby.getOrCreate(sid).character!.dailyClasses![`10:ruby:${dailyKey()}`]!;
    expect(record).toMatchObject({
      status: "complete",
      questionCount: 3,
      result: {
        version: 1,
        wasCorrect: true,
        forfeit: false,
        answerText: "I trust specific evidence and check claims that skip the source.",
        teacherObservation: expect.stringContaining("Specific and grounded."),
        consequenceLabel: "Passing class recorded",
        completedClasses: 1,
        requiredClasses: 1,
      },
    });
    expect(record.practiceCount ?? 0).toBe(0);
    expect(record.socialCount ?? 0).toBe(1);
    expect(ruby.getOrCreate(sid).character!.essayCompleted).not.toBe(true);
    expect(ruby.analyticsSnapshot().events.classRitual).toMatchObject({
      dailyClassStarted: 1,
      evidenceCardCompleted: 2,
      takeCardSubmitted: 1,
      classResultCompleted: 1,
    });
    expect(ruby.courseProgress(sid, "ruby").today.result).toEqual(record.result);

    await ruby.flushSession(sid);
    await ruby.stop();
    activeRuby = null;
    const restored = new RubyHighService({} as never, new StateStore(storePath));
    await restored["hydrate"]();
    restored.setFacultyService(faculty);
    activeRuby = restored;
    expect(restored.courseProgress(sid, "ruby").today.result).toEqual(record.result);
  });

  it("runs Roko's basilisk class as delayed branches followed by one graded update", async () => {
    const { ruby } = await makeServices();
    const sid = "test:roko-case-class";
    ruby.selectGrade(sid, "10");
    const state = ruby.getOrCreate(sid);
    state.character = {
      name: "Test",
      playbookId: "heart",
      stats: { head: 99, heart: 99, hustle: 99, honor: 99 },
      arcAnswer: "—",
      personality: "—",
      yearbook: [],
      createdAt: Date.now(),
    };

    const investigate = ruby.pickAndPose(sid, { faculty: "roko" });
    expect(investigate.current).toMatchObject({
      type: "story-choice",
      faculty: "roko",
      caseStudy: { episodeId: "basilisk-archive", stage: "investigate" },
    });
    expect(investigate.current?.correctChoice).toBeUndefined();
    const episodeId = investigate.current!.caseStudy!.episodeId;
    const firstChoice = investigate.current!.options!.A;
    const investigationReveal = ruby.submitAnswer(sid, "A");
    expect(investigationReveal.lastReveal).toMatchObject({
      questionType: "story-choice",
      picked: "A",
      caseChoice: { choiceLabel: firstChoice },
    });
    expect(investigationReveal.caseStudyProgress).toMatchObject({
      episodeId,
      choices: [{ choiceLabel: firstChoice, stage: "investigate" }],
    });
    expect(investigationReveal.score.total).toBe(0);
    ruby.clearBoard(sid);

    const decide = ruby.pickAndPose(sid, { faculty: "roko" });
    expect(decide.current).toMatchObject({
      type: "story-choice",
      caseStudy: {
        episodeId,
        stage: "decide",
        priorChoices: [{ choiceLabel: firstChoice, delayedConsequence: expect.any(String) }],
      },
    });
    const secondChoice = decide.current!.options!.B;
    const decisionReveal = ruby.submitAnswer(sid, "B");
    expect(decisionReveal.lastReveal).toMatchObject({
      questionType: "story-choice",
      caseChoice: { choiceLabel: secondChoice, stage: "decide" },
    });
    expect(decisionReveal.lastReveal?.caseConsequence).toBeUndefined();
    expect(decisionReveal.caseStudyProgress?.choices).toHaveLength(2);
    ruby.clearBoard(sid);

    const explain = ruby.pickAndPose(sid, { faculty: "roko" });
    expect(explain.current).toMatchObject({
      type: "opinion",
      opinionPurpose: "daily-take",
      prompt: expect.stringContaining(firstChoice),
      caseStudy: {
        episodeId,
        stage: "explain",
        priorChoices: [
          { choiceLabel: firstChoice, delayedConsequence: expect.any(String) },
          { choiceLabel: secondChoice, delayedConsequence: expect.any(String) },
        ],
      },
      caseOutcome: { episodeId, choices: expect.any(Array) },
    });
    ruby.recordOpinion(sid, "player", "My first move assumed limited review would contain the story. The leak and missing causal incentive should update me: I would publish a sourced, revisable rebuttal for affected readers, while keeping vivid details out of broad alerts.");
    ruby.recordGrades(sid, [{ responder: "player", score: 8, comment: "You separated the argument from the communication effect and updated from later evidence." }], "player");

    const record = ruby.getOrCreate(sid).character!.dailyClasses![`10:roko:${dailyKey()}`]!;
    expect(record).toMatchObject({
      status: "complete",
      questionCount: 3,
      result: {
        episodeId,
        relationshipLabel: "Roko remembers",
        relationshipDetail: expect.any(String),
        memoryTitle: expect.any(String),
        memoryDetail: expect.any(String),
        followUp: expect.any(String),
        pathSummary: expect.stringContaining(firstChoice),
      },
    });

    ruby.clearBoard(sid);
    const review = ruby.pickAndPose(sid, { faculty: "roko" });
    expect(review.activeRound?.cardRole).toBe("practice");
    expect(review.current?.caseStudy).toBeUndefined();
  });

  it.each([
    ["sally-science", /evidence|prediction|variable/i],
    ["professor-edward", /interpretation|perspective|tension/i],
  ])("uses a subject-specific daily take for %s", async (facultyId, promptPattern) => {
    const { ruby } = await makeServices();
    const sid = `test:core-take:${facultyId}`;
    ruby.selectGrade(sid, "11");
    const state = ruby.getOrCreate(sid);
    state.character = {
      name: "Test",
      playbookId: "heart",
      stats: { head: 99, heart: 99, hustle: 99, honor: 99 },
      arcAnswer: "—",
      personality: "—",
      yearbook: [],
      createdAt: Date.now(),
    };

    for (let i = 0; i < 2; i++) {
      const posed = ruby.pickAndPose(sid, { faculty: facultyId });
      expect(posed.activeRound?.cardRole).toBe("class");
      ruby.submitAnswer(sid, posed.current!.correctChoice!);
      ruby.clearBoard(sid);
    }

    const take = ruby.pickAndPose(sid, { faculty: facultyId });
    expect(take.current).toMatchObject({
      type: "opinion",
      opinionPurpose: "daily-take",
      faculty: facultyId,
    });
    expect(take.current?.subject).toBeTruthy();
    expect(take.current?.prompt).toMatch(promptPattern);
    expect(take.activeRound).toMatchObject({
      cardRole: "social",
      classSession: { mode: "class", index: 3, total: 3 },
    });
  });

  it("persists an essay report when an opinion round is graded", async () => {
    const { ruby } = await makeServices();
    const sid = "test:essay-report";
    attachTestCharacter(ruby, sid);

    ruby.poseOpinion(sid, {
      faculty: "ruby",
      subject: "agent-culture",
      questionId: "essay-report-q1",
      prompt: "What makes an AI answer worth trusting?",
      rubric: "Names a concrete source signal and a verification step.",
    });
    ruby.recordOpinion(sid, "player", "I trust answers that cite concrete evidence and I verify claims against the source.");
    ruby.recordOpinion(sid, "lyra", "I check the source first and compare it with what the answer claims.");

    const after = ruby.recordGrades(sid, [
      { responder: "player", score: 8.5, comment: "Grounded and specific." },
      { responder: "lyra", score: 9, comment: "Sharper verification step." },
    ], "lyra");

    expect(after.essayReports).toHaveLength(1);
    expect(after.essayReports[0]).toMatchObject({
      questionId: "essay-report-q1",
      faculty: "ruby",
      grade: "9",
      subject: "agent-culture",
      prompt: "What makes an AI answer worth trusting?",
      score: 8.5,
      passed: true,
      comment: "Grounded and specific.",
      bestResponder: "lyra",
      bestResponderScore: 9,
      bestResponderComment: "Sharper verification step.",
      classSession: {
        mode: "practice",
        cardRole: "social",
        facultyId: "ruby",
        grade: "9",
      },
    });
    expect(after.character?.essayCompleted).not.toBe(true);
  });

  it("only a character's assigned grade essay satisfies the essay gate", async () => {
    const { ruby } = await makeServices();
    const sid = "test:grade-essay-gate";
    const state = attachTestCharacter(ruby, sid);
    state.character!.essayPrompt = "What did you learn from a mistake?";
    state.character!.essayCompleted = false;

    expect(() => ruby.poseOpinion(sid, {
      faculty: "ruby",
      prompt: state.character!.essayPrompt!,
      purpose: "grade-essay",
    })).toThrow(/unlocks after the class requirements/i);

    state.character!.streak = { grade: "9", count: 1, lastDate: "2026-05-04" };
    state.character!.dailyClasses = {
      "9:ruby:2026-05-04": completedClassRecord("9", "ruby", "2026-05-04", "B", 240),
    };
    expect(ruby.graduationGate(sid)).toMatchObject({
      stage: "essay",
      classRequirementsMet: true,
      essayReady: true,
      ceremonyReady: false,
    });

    ruby.poseOpinion(sid, {
      faculty: "ruby",
      questionId: "grade-essay-q1",
      prompt: state.character!.essayPrompt,
      rubric: "Names a concrete mistake and a specific lesson.",
    });
    expect(ruby.getOrCreate(sid).current?.opinionPurpose).toBe("grade-essay");
    ruby.recordOpinion(sid, "player", "I trusted an unsupported claim, then learned to check the source first.");
    const after = ruby.recordGrades(sid, [
      { responder: "player", score: 8, comment: "Concrete and specific." },
    ], "player");

    expect(after.character?.essayCompleted).toBe(true);
  });

  it("schedules the unlocked grade essay and advances to ceremony after it is graded", async () => {
    const { ruby } = await makeServices();
    const sid = "test:deterministic-grade-essay";
    const state = attachTestCharacter(ruby, sid);
    ruby.selectGrade(sid, "10");
    state.character!.essayPrompt = "How should a community respond when its rules cause harm?";
    state.character!.essayCompleted = false;
    state.character!.streak = { grade: "10", count: 1, lastDate: "2026-05-04" };
    state.character!.graduationClassrooms = { "10": ["ruby", "professor-edward"] };
    state.character!.dailyClasses = {
      "10:ruby:2026-05-04": completedClassRecord("10", "ruby", "2026-05-04", "B", 240),
      "10:professor-edward:2026-05-04": completedClassRecord("10", "professor-edward", "2026-05-04", "C", 210),
    };

    expect(ruby.graduationGate(sid)).toMatchObject({
      grade: "10",
      stage: "essay",
      classRequirementsMet: true,
      essayRequired: true,
      essayCompleted: false,
      essayReady: true,
      ceremonyReady: false,
      ready: false,
    });
    expect(state.character!.pendingGraduation).toBeFalsy();

    const posed = ruby.pickAndPose(sid, { faculty: "sally-science" });
    expect(posed.current).toMatchObject({
      type: "opinion",
      opinionPurpose: "grade-essay",
      prompt: state.character!.essayPrompt,
      faculty: "sally-science",
    });
    expect(posed.activeRound).toMatchObject({
      cardRole: "social",
      classSession: { mode: "practice", facultyId: "sally-science" },
    });

    ruby.recordOpinion(sid, "player", "The community should name the harm, change the rule, and repair what it caused.");
    const completed = ruby.recordGrades(sid, [
      { responder: "player", score: 8, comment: "Clear position and concrete repair." },
    ], "player");

    expect(ruby.graduationGate(sid)).toMatchObject({
      stage: "ceremony",
      essayCompleted: true,
      essayReady: false,
      ceremonyReady: true,
      ready: true,
    });
    expect(completed.character?.pendingGraduation).toMatchObject({ grade: "10" });
  });

  it("forceAdvanceRound resolves an idle-triggered open round as a forfeit", async () => {
    const { ruby } = await makeServices();
    const sid = "test:force-advance-forfeit";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    const before = ruby.getOrCreate(sid);
    expect(before.activeRound).not.toBeNull();
    expect(before.activeRound?.resolved).toBeFalsy();

    ruby.forceAdvanceRound(sid);
    const after = ruby.getOrCreate(sid);
    expect(after.activeRound?.resolved).toBe(true);
    expect(after.lastReveal?.forfeit).toBe(true);
  });

  it("forceAdvanceRound is idempotent: calling twice on an already-resolved round is a no-op", async () => {
    const { ruby } = await makeServices();
    const sid = "test:force-advance-idempotent";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    ruby.forceAdvanceRound(sid);
    const afterFirst = ruby.getOrCreate(sid);
    const firstReveal = afterFirst.lastReveal;

    ruby.forceAdvanceRound(sid);
    const afterSecond = ruby.getOrCreate(sid);
    expect(afterSecond.lastReveal).toStrictEqual(firstReveal);
  });

  it("forceAdvanceRound on a no-round session does nothing", async () => {
    const { ruby } = await makeServices();
    const sid = "test:force-advance-no-round";
    const before = ruby.getOrCreate(sid);
    expect(before.activeRound).toBeNull();
    expect(() => ruby.forceAdvanceRound(sid)).not.toThrow();
    const after = ruby.getOrCreate(sid);
    expect(after.lastReveal).toBeNull();
  });

  it("forceAdvanceRound marks forfeit=false when the player answered before the advance", async () => {
    const { ruby } = await makeServices();
    const sid = "test:force-advance-answered";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    const state = ruby.getOrCreate(sid);
    // Simulate player answering — set answeredAt without resolving the round
    state.activeRound!.player.answeredAt = Date.now();
    state.activeRound!.player.picked = state.current!.correctChoice as "A" | "B" | "C" | "D";
    ruby.forceAdvanceRound(sid);
    const after = ruby.getOrCreate(sid);
    expect(after.activeRound?.resolved).toBe(true);
    expect(after.lastReveal?.forfeit).toBeFalsy();
  });

  it("resetSession wipes everything for that sessionId", async () => {
    const { ruby } = await makeServices();
    const sid = "test:6";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    ruby.submitAnswer(sid, ruby.getOrCreate(sid).current!.correctChoice!);
    expect(ruby.getOrCreate(sid).score.correct).toBe(1);

    ruby.resetSession(sid);
    const fresh = ruby.getOrCreate(sid);
    expect(fresh.score).toMatchObject({ correct: 0, total: 0, points: 0, possible: 0 });
    expect(fresh.wallet).toMatchObject({ meritStars: 0, hallPasses: 0 });
    expect(fresh.askedQuestionIds).toEqual([]);
    expect(fresh.history).toEqual([]);
  });

  it("setFaculty switches to each room's own board", async () => {
    const { ruby } = await makeServices();
    const sid = "test:swap-room";
    // Start in Sally's room, draw a question.
    ruby.setFaculty(sid, "sally-science");
    ruby.pickAndPose(sid, { faculty: "sally-science" });
    let state = ruby.getOrCreate(sid);
    const sallyQuestion = state.current?.id;
    expect(state.current).not.toBeNull();
    expect(state.activeRound).not.toBeNull();
    // Walk into Edward's room — Sally's question must not follow.
    state = ruby.setFaculty(sid, "professor-edward");
    expect(state.faculty).toBe("professor-edward");
    expect(state.current).toBeNull();
    expect(state.lastReveal).toBeNull();
    expect(state.activeRound).toBeNull();
    expect(state.status).toBe("idle");
    // Returning to Sally restores Sally's board.
    state = ruby.setFaculty(sid, "sally-science");
    expect(state.faculty).toBe("sally-science");
    expect(state.current?.id).toBe(sallyQuestion);
    expect(state.activeRound?.questionId).toBe(sallyQuestion);
    expect(state.status).toBe("awaiting-answer");
  });

  it("setFaculty preserves the board when re-selecting the same faculty (no-op)", async () => {
    const { ruby } = await makeServices();
    const sid = "test:reselect";
    ruby.pickAndPose(sid, { faculty: "ruby" });
    const before = ruby.getOrCreate(sid).current?.id;
    expect(before).toBeDefined();
    const state = ruby.setFaculty(sid, "ruby");
    expect(state.current?.id).toBe(before);
    expect(state.activeRound).not.toBeNull();
  });

  it("setFaculty hides the classroom board in the lounge and restores it when returning", async () => {
    const { ruby } = await makeServices();
    const sid = "test:to-lounge";
    ruby.pickAndPose(sid, { faculty: "sally-science" });
    const sallyQuestion = ruby.getOrCreate(sid).current?.id;
    let state = ruby.setFaculty(sid, "lounge");
    expect(state.faculty).toBe("lounge");
    expect(state.current).toBeNull();
    expect(state.activeRound).toBeNull();
    state = ruby.setFaculty(sid, "sally-science");
    expect(state.current?.id).toBe(sallyQuestion);
    expect(state.activeRound?.questionId).toBe(sallyQuestion);
  });

  it("clearBoard deletes the active room board instead of letting it resurrect on return", async () => {
    const { ruby } = await makeServices();
    const sid = "test:clear-room-board";
    ruby.pickAndPose(sid, { faculty: "sally-science" });
    ruby.setFaculty(sid, "professor-edward");
    expect(ruby.setFaculty(sid, "sally-science").current).not.toBeNull();
    ruby.forceResolveRound(sid);
    ruby.clearBoard(sid);
    ruby.setFaculty(sid, "professor-edward");
    const state = ruby.setFaculty(sid, "sally-science");
    expect(state.current).toBeNull();
    expect(state.activeRound).toBeNull();
  });

  it("normalizes legacy state files: missing pendingRoll loads as null, not undefined", async () => {
    // Hand-write a state.json the way pre-v0.5.1 saves looked: no
    // pendingRoll field at all. The migration in normalizeLoaded must coerce
    // it to null so downstream `if (!state.pendingRoll)` checks behave
    // consistently and the type contract holds.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(storePath, JSON.stringify({
      sessions: [{
        sessionId: "legacy:1",
        faculty: "ruby",
        subject: null,
        current: null,
        history: [],
        score: { correct: 0, total: 0 },
        lastReveal: null,
        status: "idle",
        askedQuestionIds: [],
        currentGrade: null,
        completedGrades: [],
        hasSeenIntro: false,
        character: null,
        npcRosters: {},
        activeRound: null,
        // pendingRoll intentionally omitted — this is the bug we fixed.
        updatedAt: Date.now(),
      }],
    }));
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);
    const loaded = ruby.getOrCreate("legacy:1");
    expect(loaded.pendingRoll).toBeNull();
    expect(loaded.pendingRoll).not.toBeUndefined();
    activeRuby = ruby; // ensure flush in afterEach
  });

  it("normalizes oversized legacy answer histories on load", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(storePath, JSON.stringify({
      sessions: [{
        sessionId: "legacy:history-cap",
        faculty: "ruby",
        subject: null,
        current: null,
        history: Array.from({ length: 525 }, (_, i) => ({
          questionId: `legacy-q-${i % 500}`,
          picked: "A",
          correct: "A",
          wasCorrect: true,
          at: i,
        })),
        score: { correct: 525, total: 525 },
        lastReveal: null,
        status: "idle",
        askedQuestionIds: [],
        currentGrade: null,
        completedGrades: [],
        hasSeenIntro: false,
        character: null,
        npcRosters: {},
        activeRound: null,
        updatedAt: Date.now(),
      }],
    }));
    const faculty = await FacultyService.start({} as never);
    const ruby = new RubyHighService({} as never, new StateStore(storePath));
    await ruby["hydrate"]();
    ruby.setFacultyService(faculty);

    const loaded = ruby.getOrCreate("legacy:history-cap");
    expect(loaded.history).toHaveLength(500);
    expect(loaded.history[0]?.questionId).toBe("legacy-q-25");
    expect(loaded.answerStats).toEqual({ totalAnswers: 525, repeatedAnswers: 25 });
    expect(loaded.score).toMatchObject({ correct: 525, total: 525 });
    expect(ruby.analyticsSnapshot().balance.repeatRate).toEqual({
      totalAnswers: 525,
      repeatedAnswers: 25,
      rate: 25 / 525,
    });
    activeRuby = ruby;
  });

  it("quick-rolls one deterministic student directly into First Bell and is retry-safe", async () => {
    const { ruby } = await makeServices();
    const sid = "viewer:quick-roll:one";

    const first = ruby.quickRollIntoFirstBell(sid);
    expect(first.character).toMatchObject({
      name: expect.any(String),
      playbookId: expect.any(String),
      stats: expect.any(Object),
      arcAnswer: expect.any(String),
      personality: expect.any(String),
    });
    expect(first.current).toBeTruthy();
    expect(first.activeRound).toMatchObject({
      cardRole: "class",
      classSession: { mode: "class", index: 1, total: 3 },
    });
    const firstCharacter = structuredClone(first.character);
    const firstQuestionId = first.current?.id;

    const retry = ruby.quickRollIntoFirstBell(sid);
    expect(retry.character).toEqual(firstCharacter);
    expect(retry.current?.id).toBe(firstQuestionId);
    expect(ruby.analyticsSnapshot().events.funnel.firstCharacterCreated).toBe(1);
  });

  it("separates raw and visitor-backed human activation cohorts with ordered deduped steps", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 7, 9, 12));
    const { ruby } = await makeServices();
    const human = "viewer:activation:human";
    const smoke = "viewer:activation:smoke";
    const beforeOnboardingInstrumentation = "viewer:activation:pre-onboarding";

    ruby.recordMetricEvent("app_open", {
      sessionId: beforeOnboardingInstrumentation,
      visitorHash: "visitor-before-onboarding",
      clientSurface: "viewer",
      source: "viewer",
      occurredAt: Date.UTC(2026, 7, 9, 5, 20),
    });

    ruby.recordAppOpen(human, {
      clientSurface: "viewer",
      visitorHash: "visitor-human",
    });
    ruby.recordMetricEvent("funnel_step", { sessionId: human, step: "onboarding_creation_opened", source: "viewer" });
    ruby.recordMetricEvent("funnel_step", { sessionId: human, step: "onboarding_candidate_ready", source: "viewer" });
    ruby.recordMetricEvent("funnel_step", { sessionId: human, step: "onboarding_enrollment_started", source: "viewer" });
    ruby.recordMetricEvent("funnel_step", { sessionId: human, step: "first_character_created", source: "gameplay" });
    ruby.recordMetricEvent("daily_class_started", { sessionId: human, step: "evidence_1", source: "gameplay" });
    ruby.recordMetricEvent("funnel_step", { sessionId: human, step: "first_question_answered", source: "gameplay" });
    ruby.recordMetricEvent("evidence_card_completed", { sessionId: human, step: "evidence_1", source: "gameplay" });
    ruby.recordMetricEvent("evidence_card_completed", { sessionId: human, step: "evidence_2", source: "gameplay" });
    ruby.recordMetricEvent("take_card_presented", { sessionId: human, step: "take", source: "gameplay" });
    ruby.recordMetricEvent("take_card_started", { sessionId: human, step: "take", source: "viewer" });
    ruby.recordMetricEvent("take_card_submitted", { sessionId: human, step: "take", source: "gameplay" });
    ruby.recordMetricEvent("class_result_completed", { sessionId: human, step: "class_result", source: "gameplay" });
    ruby.recordMetricEvent("class_result_viewed", { sessionId: human, step: "class_result", source: "viewer" });
    ruby.recordMetricEvent("class_result_viewed", { sessionId: human, step: "class_result", source: "viewer" });

    ruby.recordAppOpen(smoke, { clientSurface: "smoke" });
    ruby.markSyntheticSession(smoke);
    ruby.recordMetricEvent("funnel_step", { sessionId: smoke, step: "first_character_created", source: "smoke" });

    const analytics = ruby.analyticsSnapshot(Date.now());
    const events = analytics.events;
    expect(events.activationFunnel.raw).toMatchObject({ sampleSize: 2, eligibleSessions: 2 });
    expect(events.activationFunnel.humanViewer).toMatchObject({ sampleSize: 2, eligibleSessions: 2 });
    expect(Object.fromEntries(events.activationFunnel.humanViewer.steps.map((step) => [step.key, step.uniqueSessions]))).toMatchObject({
      app_open: 2,
      character_created: 1,
      daily_class_started: 1,
      first_answer: 1,
      evidence_1_completed: 1,
      evidence_2_completed: 1,
      take_presented: 1,
      take_started: 1,
      take_submitted: 1,
      result_completed: 1,
      result_viewed: 1,
    });
    expect(events.onboardingFunnel.instrumentationStart).toBe("2026-08-09T05:23:59.000Z");
    expect(events.onboardingFunnel.humanViewer).toMatchObject({ sampleSize: 1, eligibleSessions: 1 });
    expect(Object.fromEntries(events.onboardingFunnel.humanViewer.steps.map((step) => [step.key, step.uniqueSessions]))).toEqual({
      app_open: 1,
      creation_opened: 1,
      candidate_ready: 1,
      enrollment_started: 1,
      character_created: 1,
      daily_class_started: 1,
    });
    expect(events.byClientSurface.viewer).toBeGreaterThan(0);
    expect(events.byClientSurface.smoke).toBe(0);
    expect(events.excludedSynthetic).toBe(2);
    expect(analytics.excludedSynthetic).toMatchObject({ sessions: 1, metricEvents: 2 });
    expect(analytics.sessions).toBe(0);
  });

  it("keeps first-touch acquisition across refresh and session rotation without double-counting the visitor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const firstTouchAt = Date.UTC(2026, 7, 13, 1);
    vi.setSystemTime(firstTouchAt);
    const { ruby } = await makeServices();
    const visitorHash = "visitor-acquisition-174";
    const firstSession = "viewer:acquisition:first";
    const rotatedSession = "viewer:acquisition:rotated";

    ruby.recordAppOpen(firstSession, {
      clientSurface: "viewer",
      visitorHash,
      attribution: {
        source: "x",
        campaignId: "issue-174-v1",
        landingVariant: "quick-roll-v1",
        entrypoint: "viewer",
      },
    });
    for (const [name, step] of [
      ["funnel_step", "first_character_created"],
      ["daily_class_started", "evidence_1"],
      ["funnel_step", "first_question_answered"],
      ["evidence_card_completed", "evidence_1"],
      ["evidence_card_completed", "evidence_2"],
      ["take_card_presented", "take"],
      ["take_card_started", "take"],
      ["take_card_submitted", "take"],
      ["class_result_completed", "class_result"],
      ["class_result_viewed", "class_result"],
    ] as const) {
      ruby.recordMetricEvent(name, { sessionId: firstSession, step, source: "gameplay" });
    }

    vi.setSystemTime(firstTouchAt + 60 * 60 * 1000);
    ruby.recordAppOpen(firstSession, {
      clientSurface: "viewer",
      visitorHash,
      attribution: { source: "direct" },
    });
    vi.setSystemTime(firstTouchAt + 25 * 60 * 60 * 1000);
    ruby.recordAppOpen(rotatedSession, {
      clientSurface: "viewer",
      visitorHash,
      attribution: { source: "unknown" },
    });
    ruby.recordSessionResume(rotatedSession, { visitorHash });

    ruby.recordAppOpen("viewer:acquisition:internal", {
      clientSurface: "viewer",
      visitorHash: "visitor-internal-qa",
      attribution: { source: "internal", entrypoint: "internal-qa" },
    });
    ruby.recordAppOpen("viewer:acquisition:smoke", {
      clientSurface: "smoke",
      visitorHash: "visitor-smoke",
      attribution: {
        source: "x",
        campaignId: "issue-174-v1",
        landingVariant: "quick-roll-v1",
      },
    });

    const acquisition = ruby.analyticsSnapshot(firstTouchAt + 26 * 60 * 60 * 1000).events.acquisition;
    const experiment = acquisition.canonicalExperiment174.funnel;
    expect(acquisition.totalEligibleVisitors).toBe(1);
    expect(experiment).toMatchObject({
      sampleSize: 1,
      eligibleVisitors: 1,
      d1Return: { eligibleVisitors: 1, returnedVisitors: 1, rate: 1 },
    });
    expect(Object.fromEntries(experiment.steps.map((step) => [step.key, step.numerator]))).toEqual({
      app_open: 1,
      character_created: 1,
      daily_class_started: 1,
      first_answer: 1,
      evidence_1_completed: 1,
      evidence_2_completed: 1,
      take_presented: 1,
      take_started: 1,
      take_submitted: 1,
      result_completed: 1,
      result_viewed: 1,
    });
    expect(acquisition.bySource.find((row) => row.source === "x")?.sampleSize).toBe(1);
    expect(acquisition.bySource.find((row) => row.source === "direct")?.sampleSize).toBe(0);
    expect(acquisition.cohorts).toHaveLength(1);
    expect(acquisition.cohorts[0]).toMatchObject({
      source: "x",
      campaignId: "issue-174-v1",
      landingVariant: "quick-roll-v1",
      entrypoint: "viewer",
      releaseMarker: "dev",
    });
  });

  it("does not call free Hall Pass grants payers", async () => {
    const { ruby } = await makeServices();
    ruby.recordMetricEvent("commerce", {
      sessionId: "viewer:free-credit",
      source: "system",
      hallPassesDelta: 5,
      amountCents: 0,
    });
    ruby.recordMetricEvent("commerce", {
      sessionId: "viewer:paid",
      source: "stripe",
      hallPassesDelta: 20,
      amountCents: 499,
    });

    expect(ruby.analyticsSnapshot().events.commerce).toMatchObject({
      creditedSessions: 2,
      payingSessions: 1,
      amountCents: 499,
    });
  });

  it("joins conversion steps through one visitor identity instead of mixing session counts", async () => {
    const { ruby } = await makeServices();
    const visitorHash = "visitor-conversion-one";
    ruby.recordAppOpen("viewer:conversion:first", { visitorHash, clientSurface: "viewer" });
    ruby.recordAppOpen("viewer:conversion:rotated", { visitorHash, clientSurface: "viewer" });
    ruby.recordMetricEvent("funnel_step", {
      sessionId: "viewer:conversion:first",
      step: "first_character_created",
      source: "gameplay",
    });
    ruby.recordMetricEvent("funnel_step", {
      sessionId: "viewer:conversion:rotated",
      step: "first_character_created",
      source: "gameplay",
    });
    ruby.recordMetricEvent("commerce", {
      sessionId: "viewer:conversion:rotated",
      source: "stripe",
      amountCents: 499,
    });
    ruby.recordMetricEvent("commerce", {
      sessionId: "viewer:conversion:unattributed",
      source: "stripe",
      amountCents: 499,
    });

    expect(ruby.analyticsSnapshot().events.conversionFunnel).toEqual({
      totalVisitors: 1,
      charactersCreated: 1,
      payers: 1,
      visitorToCharacterRate: 1,
      characterToPayerRate: 1,
      visitorToPayerRate: 1,
    });
  });

  it("prunes the in-memory metric cache on the durable store retention window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.UTC(2026, 7, 20, 12);
    vi.setSystemTime(startedAt);
    const store = new SqliteStateStore({ path: ":memory:", ttlSeconds: 60 });
    const ruby = new RubyHighService({} as never, store);
    await ruby["hydrate"]();
    activeRuby = ruby;
    await ruby.recordMetricEventDurably("app_open", {
      sessionId: "viewer:retention",
      visitorHash: "visitor-retention",
      clientSurface: "viewer",
    });
    expect(ruby.analyticsSnapshot().events.total).toBe(1);

    vi.setSystemTime(startedAt + 60_001);
    expect(ruby.analyticsSnapshot().events.total).toBe(0);
    expect(await store.loadMetricEvents()).toHaveLength(0);

    await ruby.stop();
    activeRuby = null;
    store.close();
  });
});
