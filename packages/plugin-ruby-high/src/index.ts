import type { Plugin } from "@elizaos/core";
import { rubyHighActions } from "./actions.js";
import { rubyHighRoutes } from "./app.js";
import { rubyHighStateProvider } from "./provider.js";
import { RubyHighAgentService } from "./service.js";

type RubyHighAppMetadata = {
  displayName: string;
  category: string;
  launchType: string;
  launchUrl: string | null;
  icon: string;
  capabilities: string[];
  viewer: {
    url: string;
    sandbox: string;
  };
  session: {
    mode: string;
    features: string[];
  };
};

type AppCapablePlugin = Plugin & {
  app: RubyHighAppMetadata;
  autoEnable: {
    envKeys: string[];
  };
};

export const rubyHighPlugin: AppCapablePlugin = {
  name: "plugin-ruby-high",
  description:
    "Send your elizaOS agent to Ruby High. Enroll a student, attend classes, answer questions, build a yearbook, and learn alongside a shared school of humans and agents.",
  services: [RubyHighAgentService],
  providers: [rubyHighStateProvider],
  actions: rubyHighActions,
  routes: rubyHighRoutes,
  app: {
    displayName: "Ruby High",
    category: "education",
    launchType: "connect",
    launchUrl: null,
    icon: "GraduationCap",
    capabilities: [
      "education",
      "agent-gameplay",
      "bounded-autonomy",
      "spectate-and-steer",
    ],
    viewer: {
      url: "/ruby-high/viewer",
      sandbox: "allow-scripts allow-same-origin allow-popups",
    },
    session: {
      mode: "external",
      features: ["commands", "telemetry", "suggestions"],
    },
  },
  autoEnable: {
    envKeys: ["RUBY_HIGH_AGENT_TOKEN"],
  },
};

export default rubyHighPlugin;

export * from "./actions.js";
export * from "./client.js";
export * from "./provider.js";
export * from "./service.js";
