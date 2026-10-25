import type { Snapshot } from "./types";
export function demoSnapshot(): Snapshot {
  const now = Date.now();
  const names = [
    "Research desk",
    "Studio assistant",
    "Build partner",
    "Daily planner",
    "Reading room",
    "Design companion",
  ];
  const agents = names.map((name, i) => ({
    id: `demo-${i}`,
    name,
    description: [
      "Explore ideas and connect the dots",
      "A second pair of ears for your next project",
      "Keep the build moving",
    ][i % 3],
    color: ["#ab9aff", "#85d4bd", "#e6be7e"][i % 3],
    section: i < 3 ? "Projects" : "Everyday",
    sectionId: i < 3 ? "projects" : "everyday",
    pinned: i < 2,
    hasUnread: i < 3,
    unreadCount: i < 3 ? 1 : 0,
    awaitingResponse: i === 0,
    lastActivityAt: now - (i + 1) * 360000,
    preview: [
      "Three approaches are ready to compare. Which direction would you like to explore?",
      "The latest session notes are ready to review.",
      "The build finished. Here is what changed.",
    ][i % 3],
    messages: [
      {
        id: `u-${i}`,
        role: "user",
        content: "Help me pick up where we left off.",
        timestamp: now - 86400000,
        type: "text",
        streaming: false,
      },
      {
        id: `a-${i}`,
        role: "assistant",
        content:
          "## A little context goes a long way\n\nThis is **example data**, here to let you explore GrokDeck before connecting your local Grok Bot cache.\n\n- Your recent conversations stay close at hand.\n- Search can look inside cached discussions.\n- Pins and private notes help you keep your place.\n\nChoose **Settings → Grok Bot data folder** to connect real discussions.",
        timestamp: now - (i + 1) * 360000,
        type: "text",
        streaming: false,
      },
    ],
    cachedAt: now,
  }));
  return {
    agents,
    sections: [
      {
        id: "projects",
        name: "Projects",
        agentIds: agents.slice(0, 3).map((a) => a.id),
      },
      {
        id: "everyday",
        name: "Everyday",
        agentIds: agents.slice(3).map((a) => a.id),
      },
    ],
    source: {
      kind: "demo",
      path: "Example data",
      available: true,
      checkedAt: now,
      version: null,
      cacheUpdatedAt: now,
      warning: null,
    },
    warnings: [],
  };
}
