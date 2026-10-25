export interface Message {
  id: string;
  role: string;
  author?: string | null;
  content: string;
  timestamp: number;
  type: string;
  streaming: boolean;
}
export interface Agent {
  id: string;
  name: string;
  description: string;
  color: string;
  section: string;
  sectionId: string;
  pinned: boolean;
  hasUnread: boolean;
  unreadCount: number;
  awaitingResponse: boolean;
  lastActivityAt: number;
  preview: string;
  messages: Message[];
  cachedAt: number;
}
export interface Snapshot {
  agents: Agent[];
  sections: { id: string; name: string; agentIds: string[] }[];
  source: {
    kind: string;
    path: string;
    available: boolean;
    checkedAt: number;
    version: string | null;
    cacheUpdatedAt: number;
    warning: string | null;
  };
  warnings: string[];
}
export interface ReleaseStatus {
  status: "available" | "current" | "unavailable";
  currentVersion: string | null;
  version: string | null;
  checkedAt: number;
  message: string;
}
export interface Preferences {
  checkReleases: boolean;
  theme: "dark" | "light" | "system";
  accent: "violet" | "mint" | "amber" | "blue";
  density: "comfortable" | "compact";
  fontSize: number;
  pins: string[];
  recents: string[];
  notes: Record<string, string>;
  seen: Record<string, number>;
  drafts: Record<string, string>;
}
export interface Bridge {
  checkReleases?(force?: boolean): Promise<ReleaseStatus>;
  snapshot(): Promise<Snapshot>;
  preferences(): Promise<Preferences>;
  savePreferences(patch: Partial<Preferences>): Promise<Preferences>;
  chooseSource(): Promise<Snapshot | null>;
  resetSource(): Promise<Snapshot>;
  openAgent(id: string): Promise<boolean>;
  copy(text: string): Promise<boolean>;
  exportConversation(id: string): Promise<boolean>;
  info(): Promise<{
    version: string;
    platform: string;
    arch: string;
    supportedSourceVersion: string;
  }>;
}
declare global {
  interface Window {
    grokdeck?: Bridge;
  }
}
