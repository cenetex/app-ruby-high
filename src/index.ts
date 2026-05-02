import type { IAgentRuntime, Plugin } from "@elizaos/core";
import { RubyHighService } from "./services/ruby-high-service.js";
import { FacultyService } from "./services/faculty-service.js";
import { AuthService } from "./services/auth-service.js";
import { ChatService } from "./services/chat-service.js";
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

export const rubyHighPlugin: Plugin = {
  name: "@cenetex/app-ruby-high",
  description:
    "Ruby High — educational eliza app. Ruby hosts the school; specialist faculty teach their domains. v0.3: faculty packs + persistence + OpenRouter PKCE login + per-teacher chat with tool-driven blackboard control.",
  services: [FacultyService, BoundRubyHighService, AuthService, BoundChatService],
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
    runtimePlugin: "@cenetex/app-ruby-high",
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

export default rubyHighPlugin;

export { RubyHighService } from "./services/ruby-high-service.js";
export { FacultyService } from "./services/faculty-service.js";
export { StateStore } from "./services/state-store.js";
export { AuthService } from "./services/auth-service.js";
export { ChatService } from "./services/chat-service.js";
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
