import type { IAgentRuntime, RubyHighAppModule } from "./runtime.js";
import { XSocialService } from "./services/x-social-service.js";
import { TelegramService } from "./services/telegram-service.js";
import { RubyHighService } from "./services/ruby-high-service.js";
import { FacultyService } from "./services/faculty-service.js";
import { AuthService } from "./services/auth-service.js";
import { ChatService } from "./services/chat-service.js";
import { AgentAccessService } from "./services/agent-access-service.js";
import { poseQuestionAction } from "./actions/pose-question.js";
import { pickQuestionAction } from "./actions/pick-question.js";
import { gradeAnswerAction } from "./actions/grade-answer.js";
import { clearBoardAction } from "./actions/clear-board.js";
import { handoffFacultyAction } from "./actions/handoff-faculty.js";
import {
  collectLaunchDiagnostics,
  handleAppRoutes,
  refreshRunSession,
  resolveLaunchSession,
  type RouteContext,
} from "./routes.js";

/**
 * Wrap RubyHighService.start so that, once both services are registered, the
 * RubyHighService can call into the FacultyService for PICK_QUESTION. The
 * microtask defer breaks the chicken-and-egg of "both services boot in the
 * same tick and don't see each other yet."
 */
class BoundRubyHighService extends RubyHighService {
  static override async start(runtime: IAgentRuntime): Promise<RubyHighService> {
    const svc = await RubyHighService.start(runtime);
    queueMicrotask(() => {
      const fac = runtime.getService<FacultyService>(FacultyService.serviceType);
      if (fac) svc.setFacultyService(fac);
    });
    return svc;
  }
}

class BoundChatService extends ChatService {
  static override async start(runtime: IAgentRuntime): Promise<ChatService> {
    const svc = await ChatService.start(runtime);
    queueMicrotask(() => {
      const ruby = runtime.getService<RubyHighService>(RubyHighService.serviceType);
      if (ruby) svc.setRubyHighService(ruby);
    });
    return svc;
  }
}

export const rubyHighApp: RubyHighAppModule = {
  name: "@cenetex/app-ruby-high",
  description:
    "Ruby High educational app. Ruby hosts the school; specialist faculty teach their domains with persistence, AI key login, and per-teacher chat with tool-driven blackboard control.",
  services: [
    FacultyService,
    BoundRubyHighService,
    AuthService,
    BoundChatService,
    AgentAccessService,
    XSocialService,
    TelegramService,
  ],
  actions: [
    poseQuestionAction,
    pickQuestionAction,
    gradeAnswerAction,
    clearBoardAction,
    handoffFacultyAction,
  ],
  app: {
    displayName: "Ruby High",
    category: "education",
    launchType: "connect",
    launchUrl: null,
    capabilities: ["education", "quiz", "multiple-choice", "chat", "spectate-and-steer"],
    viewer: {
      url: "/api/apps/ruby-high/viewer",
      sandbox: "allow-scripts allow-same-origin allow-popups allow-forms",
    },
    session: {
      mode: "spectate-and-steer",
      features: ["commands", "telemetry", "suggestions"],
    },
  },
  appBridge: {
    handleAppRoutes: (ctx: unknown) => handleAppRoutes(ctx as RouteContext),
    resolveLaunchSession,
    refreshRunSession,
    collectLaunchDiagnostics,
  },
};

export default rubyHighApp;

export { RubyHighService } from "./services/ruby-high-service.js";
export { FacultyService } from "./services/faculty-service.js";
export {
  StateStore,
  type AuthSessionRecord,
  type AuthStoreSnapshot,
  type AuthUserRecord,
  type StateStoreLike,
  type StoredTeacherRecord,
} from "./services/state-store.js";
export { DynamoStateStore, type DynamoStateStoreOptions } from "./services/dynamo-state-store.js";
export { createStateStore, type CreateStateStoreOptions } from "./services/state-store-factory.js";
export { AuthService } from "./services/auth-service.js";
export { ChatService } from "./services/chat-service.js";
export {
  TeacherPersonaMemory,
  TEACHER_PERSONA_MEMORY_STATE_ID,
  TEACHER_PERSONA_MIN_NEW_MEMORIES,
  TEACHER_PERSONA_REFLECTION_INTERVAL_MS,
  type RememberTeacherTurnInput,
  type TeacherMemoryRecord,
  type TeacherPersonaDraft,
  type TeacherPersonaOverlay,
  type TeacherPersonaProfileSnapshot,
  type TeacherPersonaReflector,
} from "./services/teacher-persona-memory.js";
export {
  AgentAccessService,
  AGENT_ACCESS_STATE_ID,
  AGENT_SCOPES,
  AGENT_VIEWER_COOKIE,
  type AgentAutonomyConfig,
  type AgentCredential,
  type AgentDeviceAuthorization,
  type AgentScope,
} from "./services/agent-access-service.js";
export { XSocialService } from "./services/x-social-service.js";
export { TelegramService } from "./services/telegram-service.js";
export { TEACHERS, teacherById, listTeachers } from "./characters/teachers.js";
export { poseQuestionAction } from "./actions/pose-question.js";
export { pickQuestionAction } from "./actions/pick-question.js";
export { gradeAnswerAction } from "./actions/grade-answer.js";
export { clearBoardAction } from "./actions/clear-board.js";
export { handoffFacultyAction } from "./actions/handoff-faculty.js";
export {
  collectLaunchDiagnostics,
  handleAppRoutes,
  refreshRunSession,
  resolveLaunchSession,
} from "./routes.js";
export { handleChatRoutes, noteGradedAnswer } from "./chat-routes.js";
export { renderViewerHtml, VIEWER_FRAME_ANCESTORS_DIRECTIVE } from "./viewer.js";
export * from "./types.js";
