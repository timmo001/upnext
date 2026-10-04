import { defineConfig } from "blume";
import { cloudflare } from "blume/deploy";
import commandPages from "./commands-sidebar.json" with { type: "json" };

export default defineConfig({
  title: "Up Next",
  description:
    "Twitch live channels, YouTube uploads and a watch-later queue in one feed.",
  logo: {
    image: {
      alt: "Up Next",
      dark: "/logo-dark.svg",
      light: "/logo-light.svg",
    },
    text: "Up Next",
  },
  content: {
    root: "src/content/docs",
  },
  markdown: {
    externalLinks: true,
  },
  github: {
    owner: "timmo001",
    repo: "upnext",
    branch: "main",
    dir: "docs",
  },
  navigation: {
    repo: true,
    sidebar: [
      "/",
      "/install",
      {
        label: "Setup",
        items: ["/setup/twitch", "/setup/youtube", "/omarchy"],
      },
      "/configuration",
      "/running",
      "/libraries",
      "/privacy",
      {
        label: "Commands",
        root: "/commands",
        items: commandPages.filter((page) => page !== "/commands"),
        display: "group",
        collapsed: true,
      },
      {
        label: "Migrations",
        items: ["/from-twitch-notifications"],
      },
    ],
  },
  theme: {
    accent: {
      light: "#6d28d9",
      dark: "#8b5cf6",
    },
  },
  ai: {
    assistant: {
      enabled: false,
    },
  },
  agents: {
    agentReadability: true,
    contentSignals: {
      aiInput: true,
      aiTrain: false,
      search: true,
    },
    llmsTxt: true,
    mcp: {
      enabled: true,
      route: "/mcp",
    },
    webmcp: true,
  },
  deployment: cloudflare({
    site: "https://upnext.timmo.dev",
  }),
  feedback: false,
  lastModified: "git",
  seo: {
    og: {
      enabled: true,
      logo: "src/assets/logo.svg",
      site: "upnext.timmo.dev",
    },
  },
});
