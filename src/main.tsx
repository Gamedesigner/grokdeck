import React, { useEffect, useMemo, useRef, useState } from "react";
import {ComputerViewer} from './ComputerViewer';
import {AgentEditor} from './AgentEditor';
import {OverviewGroups} from './OverviewGroups';
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  Command,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Layers3,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Moon,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Reply,
  Smile,
  Settings2,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Agent,
  Message,
  Preferences,
  Snapshot,
  ReleaseStatus,
  AppUpdateStatus,
  PhoneHostStatus,
  ComputersResponse,
} from "./types";
import { demoSnapshot } from "./demo";
import "./styles.css";

const defaults: Preferences = {
  checkReleases: true,
  theme: "dark",
  accent: "violet",
  density: "comfortable",
  fontSize: 14,
  pins: [],
  recents: [],
  notes: {},
  seen: {},
  drafts: {},
};
const empty: Snapshot = {
  agents: [],
  sections: [],
  source: {
    kind: "local-cache",
    path: "",
    available: false,
    checkedAt: 0,
    version: null,
    cacheUpdatedAt: 0,
    warning: null,
  },
  warnings: [],
};
const bridge = window.grokdeck;
function age(ms: number) {
  if (!ms) return "No timestamp";
  const n = Math.max(0, Date.now() - ms);
  return n < 60000
    ? "just now"
    : n < 3600000
      ? `${Math.floor(n / 60000)}m ago`
      : n < 86400000
        ? `${Math.floor(n / 3600000)}h ago`
        : `${Math.floor(n / 86400000)}d ago`;
}
function date(ms: number) {
  return ms
    ? new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Time unavailable";
}
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
}
const avatarRequests = new Map<string,Promise<string|null>>();
function Avatar({ agent, small = false, live = false }: { agent: Agent; small?: boolean; live?:boolean }) {
  const [image,setImage]=useState<string|null>(null);
  const element=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    setImage(null);
    if(!live||!bridge?.getAvatar)return;
    let active=true;
    const load=()=>{
      let pending=avatarRequests.get(agent.id);
      if(!pending){pending=bridge.getAvatar!(agent.id).catch(()=>null);avatarRequests.set(agent.id,pending);}
      pending.then(value=>{if(active)setImage(value);});
    };
    if(!element.current||typeof IntersectionObserver==='undefined'){load();return()=>{active=false;};}
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();load();}},{rootMargin:'100px'});
    observer.observe(element.current);return()=>{active=false;observer.disconnect();};
  },[agent,live]);
  return (
    <span
      ref={element}
      className={`avatar ${small ? "small" : ""}`}
      style={{ "--agent-color": agent.color } as React.CSSProperties}
    >
      {image ? <img src={image} alt={`${agent.name} avatar`} onError={()=>setImage(null)}/> : initials(agent.name)}
    </span>
  );
}
function App() {
  const [syncedOrganization,setSyncedOrganization]=useState<import('./types').Organization|null>(null);
  const [organizationBusy,setOrganizationBusy]=useState(false);
  const organizationBusyRef=useRef(false);
  const [organizationError,setOrganizationError]=useState('');
  const [agentSort,setAgentSort]=useState('recent');
  const [agentFilter,setAgentFilter]=useState('all');
  const [groupFilter,setGroupFilter]=useState('all');
  const [viewer,setViewer]=useState<{id:string;name:string;windowIndex?:number|null}|null>(null);
  const [editingAgent,setEditingAgent]=useState<string|null>(null);
  const [startingComputer,setStartingComputer]=useState<string|null>(null);
  const [data, setData] = useState<Snapshot>(empty),
    [prefs, setPrefs] = useState<Preferences>(defaults),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [view, setView] = useState("overview"),
    [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [chatQuery, setChatQuery] = useState(""),
    [settings, setSettings] = useState(false),
    [palette, setPalette] = useState(false),
    [toast, setToast] = useState(""),
    [notesOpen, setNotesOpen] = useState(false),
    [messageLimit, setMessageLimit] = useState(80),
    [demo, setDemo] = useState(false),
    [info, setInfo] = useState({
      version: "0.1.0",
      platform: "browser",
      arch: "",
      supportedSourceVersion: "0.75.0",
    });
  const [phone,setPhone]=useState<PhoneHostStatus|null>(null);
  const [phoneAddress,setPhoneAddress]=useState('');
  const [phoneBusy,setPhoneBusy]=useState(false);
  const [phoneMessage,setPhoneMessage]=useState('');
  useEffect(()=>{if(settings&&bridge?.phoneHosts)void bridge.phoneHosts().then(setPhone).catch(()=>setPhoneMessage('Phone connection unavailable.'));},[settings]);
  const [activityFilter, setActivityFilter] = useState(false);
  const [agentSearchOpen, setAgentSearchOpen] = useState(false);
  const [discussionSearchOpen, setDiscussionSearchOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [replyTargets, setReplyTargets] = useState<Record<string,{id:string;content:string}>>({});
  const composer = useRef<HTMLTextAreaElement>(null);
  const live = data.source.kind === 'live-gateway' && !demo;
  const [liveConnecting, setLiveConnecting] = useState(false);
  const [computers,setComputers]=useState<ComputersResponse|null>(null);
  const [computersLoading,setComputersLoading]=useState(false);
  const [computersError,setComputersError]=useState('');
  const [activeComputersOnly,setActiveComputersOnly]=useState(true);
  const computersRequest=useRef(0);
  const refreshComputers=async()=>{
    if(!live||!bridge?.computers)return;
    const generation=++computersRequest.current;
    setComputersLoading(true);setComputersError('');
    try{const next=await bridge.computers();if(generation===computersRequest.current)setComputers(next);}
    catch{if(generation===computersRequest.current)setComputersError('Computer status could not be read. Try refreshing.');}
    finally{if(generation===computersRequest.current)setComputersLoading(false);}
  };
  useEffect(()=>{if(view==='computers'&&live&&computers===null&&!computersLoading&&!computersError)void refreshComputers();},[view,live,computers,computersLoading,computersError]);
  const [pendingSends, setPendingSends] = useState<Record<string,{nonce:string;prompt:string;status:string;replyToId?:string}>>({});
  const followLatest = useRef(true);
  const connectLive = async () => {
    if(!bridge?.connectLive)return;
    setLiveConnecting(true);
    try {setData(await bridge.connectLive());avatarRequests.clear();computersRequest.current++;setComputers(null);setComputersError('');setComputersLoading(false);setDemo(false);setError('');}
    catch {setError('Could not connect live. Open Grok Bot, check that you’re signed in, and allow secure-storage access if prompted.');}
    finally {setLiveConnecting(false);}
  };

  const [releaseStatus, setReleaseStatus] = useState<ReleaseStatus | null>(
    null,
  );
  const [releaseChecking, setReleaseChecking] = useState(false);
  const checkReleases = async (force = false) => {
    if (!bridge?.checkReleases) return;
    setReleaseChecking(true);
    try {
      setReleaseStatus(await bridge.checkReleases(force));
    } catch {
      setReleaseStatus({
        status: "unavailable",
        currentVersion: null,
        version: null,
        checkedAt: Date.now(),
        message: "Could not check the official update service.",
      });
    } finally {
      setReleaseChecking(false);
    }
  };
  useEffect(() => {
    if (loading || demo || !prefs.checkReleases || !bridge?.checkReleases)
      return;
    void checkReleases();
    const timer = setInterval(() => void checkReleases(), 6 * 3600000);
    return () => clearInterval(timer);
  }, [loading, demo, prefs.checkReleases]);

  const [appUpdate,setAppUpdate]=useState<AppUpdateStatus|null>(null);
  const checkAppUpdates=async(force=false)=>{
    if(!bridge?.checkAppUpdates)return;
    try{setAppUpdate(await bridge.checkAppUpdates(force));}catch{setToast('GrokDeck update check failed. Try again.');}
  };
  useEffect(()=>{
    if(loading||demo||!prefs.checkReleases)return;
    void checkAppUpdates();
    const timer=setInterval(()=>void checkAppUpdates(),6*3600000);
    return ()=>clearInterval(timer);
  },[loading,demo,prefs.checkReleases]);
  useEffect(()=>{
    if(appUpdate?.status!=='downloading'||!bridge?.appUpdateStatus)return;
    const timer=setInterval(()=>void bridge.appUpdateStatus!().then(setAppUpdate).catch(()=>{}),1000);
    return ()=>clearInterval(timer);
  },[appUpdate?.status]);

  const transcript = useRef<HTMLDivElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    prefsRef = useRef(prefs),
    saves = useRef(Promise.resolve());
  const announce = (text: string) => setToast(text);
  const fail = (e: unknown) => {
    console.error(e);
    setError(
      "Could not complete that action. Check the source folder and try again.",
    );
  };
  const save = (patch: Partial<Preferences>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    if (bridge)
      saves.current = saves.current
        .then(() => bridge.savePreferences(patch))
        .then(() => {})
        .catch(fail);
    else
      try {
        localStorage.setItem("grokdeck-preferences", JSON.stringify(next));
      } catch {
        /* Browser preview only. */
      }
  };
  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      if (bridge && !demo) setData(await bridge.snapshot());
      else if (demo) setData(demoSnapshot());
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (bridge) {
          const [s, p, i] = await Promise.all([
            bridge.snapshot(),
            bridge.preferences(),
            bridge.info(),
          ]);
          if (active) {
            setData(s);
            setPrefs({ ...defaults, ...p });
            prefsRef.current = { ...defaults, ...p };
            setInfo(i);
            if (bridge.connectLive) {
              setLiveConnecting(true);
              try { const connected = await bridge.connectLive(); if (active) { setData(connected); setError(''); } }
              catch { if (active) setError('Live connection unavailable. Showing saved data while we retry. Open Grok Bot and sign in on this computer.'); }
              finally { if (active) setLiveConnecting(false); }
            }
          }
        } else {
          const p = JSON.parse(
            localStorage.getItem("grokdeck-preferences") || "null",
          );
          if (p) {
            setPrefs({ ...defaults, ...p });
            prefsRef.current = { ...defaults, ...p };
          }
        }
      } catch (e) {
        if (active) fail(e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!bridge || demo) return;
    let active = true;
    const timer = setInterval(() => {
      (bridge.connectLive ? bridge.connectLive() : bridge.snapshot())
        .then((s) => {
          if (active) { setData(s); setError(''); }
        })
        .catch(() => {
          if (active)
            setError(
              "Live connection interrupted. Retrying automatically; previously loaded discussions remain visible.",
            );
        });
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [demo]);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.dataset.accent = prefs.accent;
    document.documentElement.dataset.density = prefs.density;
    document.documentElement.style.fontSize = `${prefs.fontSize}px`;
  }, [prefs.theme, prefs.accent, prefs.density, prefs.fontSize]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === "Escape") {
        setPalette(false);
        setSettings(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (palette) searchInput.current?.focus();
  }, [palette]);
  useEffect(()=>{
    if(!live||!bridge?.organization){setSyncedOrganization(null);return;}
    let active=true;
    const refresh=async()=>{if(organizationBusyRef.current)return;try{const result=await bridge.organization!();if(active&&!organizationBusyRef.current){setSyncedOrganization(result.organization);setOrganizationError('');}}catch{if(active&&!organizationBusyRef.current)setOrganizationError('Group sync unavailable. Open Grok Bot or reconnect live before editing groups.');}};
    void refresh();const timer=setInterval(refresh,15000);return()=>{active=false;clearInterval(timer);};
  },[live]);
  const changeOrganization=async(next:import('./types').Organization)=>{
    if(!syncedOrganization||!bridge?.updateOrganization||organizationBusyRef.current)return;
    organizationBusyRef.current=true;setOrganizationBusy(true);setOrganizationError('');
    try{const result=await bridge.updateOrganization(next,syncedOrganization);setSyncedOrganization(result.organization);}
    catch{setOrganizationError('Group changes could not be fully confirmed. Reloading from Grok Bot; check the result before trying again.');try{setSyncedOrganization((await bridge.organization!()).organization);}catch{setSyncedOrganization(null);}}
    finally{organizationBusyRef.current=false;setOrganizationBusy(false);}
  };
  const sections=syncedOrganization?.sections??data.sections;
  const organization=syncedOrganization??{sections,pins:[...new Set([...prefs.pins,...data.agents.filter(a=>a.pinned).map(a=>a.id)])]};
  const agents = useMemo(
    () => data.agents.map(a=>{const group=sections.find(s=>s.agentIds.includes(a.id));return {...a,section:group?.name||'Ungrouped',sectionId:group?.id||'__unassigned__'};}).sort((a,b)=>b.lastActivityAt-a.lastActivityAt),
    [data.agents,sections],
  );
  const agent = agents.find((a) => a.id === selected);
  useEffect(() => {
    if(!live || !selected || !bridge?.liveMessages)return;
    let active=true, busy=false;
    const read = async () => {
      if(busy || document.visibilityState !== 'visible' || !document.hasFocus())return;
      busy=true;
      try {
        const response=await bridge.liveMessages!(selected);
        if(active) {
          setData(current => ({...current,agents:current.agents.map(a=>a.id===selected?{...a,messages:response.messages,cachedAt:Date.now()}:a)}));
          if(followLatest.current)requestAnimationFrame(()=>{if(transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight;});
        }
      } catch {if(active)setError('Live discussion refresh failed. Previously loaded messages remain visible.');}
      finally {busy=false;}
    };
    void read();
    const timer=setInterval(()=>void read(),2000);
    return ()=>{active=false;clearInterval(timer);};
  },[live,selected]);
  const submitLive = async (a:Agent) => {
    if(!bridge?.send || pendingSends[a.id])return;
    const prompt=prefsRef.current.drafts[a.id]||'';
    if(!prompt.trim())return;
    const nonce=crypto.randomUUID(), replyToId=replyTargets[a.id]?.id;
    setPendingSends(current=>({...current,[a.id]:{nonce,prompt,replyToId,status:'sending'}}));
    let status='unknown';
    try {status=(await bridge.send(a.id,prompt,nonce,replyToId)).status;}catch {/* Dispatch may have succeeded. Never retry automatically. */}
    if(status==='accepted'||status==='rejected') {
      setPendingSends(current=>{const next={...current};delete next[a.id];return next;});
      if(status==='accepted') {save({drafts:{...prefsRef.current.drafts,[a.id]:''}});setReplyTargets(current=>{const next={...current};delete next[a.id];return next;});announce('Message accepted by Grok Bot.');followLatest.current=true;}
      else setError('The message was rejected. Review the draft before sending again.');
    } else setPendingSends(current=>({...current,[a.id]:{nonce,prompt,replyToId,status}}));
  };
  const checkAcceptance = async (a:Agent) => {
    const pending=pendingSends[a.id];if(!pending||!bridge?.acceptance)return;
    try {
      const receipt=await bridge.acceptance(a.id,pending.nonce);
      if(receipt.status==='accepted'||receipt.status==='rejected') {
        setPendingSends(current=>{const next={...current};delete next[a.id];return next;});
        if(receipt.status==='accepted'){save({drafts:{...prefsRef.current.drafts,[a.id]:''}});setReplyTargets(current=>{const next={...current};delete next[a.id];return next;});announce('Message accepted by Grok Bot.');}
        else setError('The message was rejected. Review the draft before sending again.');
      } else setPendingSends(current=>({...current,[a.id]:{...pending,status:receipt.status}}));
    }catch {setError('Acceptance is still unknown. Check the discussion in Grok Bot before composing another message.');}
  };
  const pinned = (a: Agent) => organization.pins.includes(a.id);
  const unread = (a: Agent) =>
    a.hasUnread && (prefs.seen[a.id] || 0) < a.lastActivityAt;
  const attention = agents.filter((a) => a.awaitingResponse || unread(a));
  const cachedCount = agents.filter((a) => a.messages.length).length;
  const messageCount = agents.reduce((n, a) => n + a.messages.length, 0);
  const openAgent = (a: Agent) => {
    setSelected(a.id);
    setChatQuery("");
    setDiscussionSearchOpen(false);
    setEmojiOpen(false);
    setMessageLimit(80);
    save({
      recents: [
        a.id,
        ...prefsRef.current.recents.filter((id) => id !== a.id),
      ].slice(0, 12),
    });
    setPalette(false);
  };
  const togglePin = (a:Agent) => {if(!syncedOrganization){announce('Connect live to sync pins with Grok Bot.');return;}void changeOrganization({...organization,pins:pinned(a)?organization.pins.filter(id=>id!==a.id):[...organization.pins,a.id]});};
  const match = (a: Agent) =>
    !query ||
    `${a.name} ${a.description} ${a.section} ${a.preview}`
      .toLowerCase()
      .includes(query.toLowerCase()) ||
    a.messages.some((m) =>
      m.content.toLowerCase().includes(query.toLowerCase()),
    );
  const filtered = agents
    .filter(match)
    .filter(a=>view!=='all'||((groupFilter==='all'||a.sectionId===groupFilter)&&(agentFilter==='all'||agentFilter==='pinned'&&pinned(a)||agentFilter==='unread'&&unread(a)||agentFilter==='waiting'&&a.awaitingResponse)))
    .filter((a) =>
      view === "attention"
        ? a.awaitingResponse || unread(a)
        : view === "pinned"
          ? pinned(a)
          : view === "history"
            ? a.messages.length > 0
            : view.startsWith("section:")
              ? a.sectionId === view.slice(8)
              : true,
    ).sort((a,b)=>view==='all'?(agentSort==='name'?a.name.localeCompare(b.name):agentSort==='oldest'?a.lastActivityAt-b.lastActivityAt:agentSort==='group'?a.section.localeCompare(b.section)||a.name.localeCompare(b.name):b.lastActivityAt-a.lastActivityAt):0);
  const title =
    view === "computers" ? "Computers" : view === "overview"
      ? "Your deck"
      : view === "attention"
        ? "Needs attention"
        : view === "pinned"
          ? "Pinned agents"
          : view === "history"
            ? "Discussion library"
            : view.startsWith("section:")
              ? sections.find((s) => s.id === view.slice(8))?.name ||
                "Section"
              : "All agents";
  const recent = prefs.recents
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is Agent => !!a);
  const handoff = async (a: Agent) => {
    if (demo) {
      announce("Example agent. Connect Grok Bot to open real discussions.");
      return;
    }
    if (!bridge) {
      announce("Open the desktop app to connect to Grok Bot.");
      return;
    }
    try {
      await bridge.openAgent(a.id);
      announce("Opened in Grok Bot.");
    } catch {
      setError(
        "Could not open Grok Bot. Check that it is installed on this computer.",
      );
    }
  };
  const chooseSource = async () => {
    if (!bridge) {
      announce("Folder access is available in the desktop app.");
      return;
    }
    try {
      const s = await bridge.chooseSource();
      if (s) {
        setData(s);
        setDemo(false);
        setSelected(null);
        setError("");
      }
    } catch (e) {
      fail(e);
    }
  };
  useEffect(() => {
    followLatest.current = true;
    if (transcript.current)
      transcript.current.scrollTop = chatQuery
        ? 0
        : transcript.current.scrollHeight;
  }, [selected, chatQuery]);
  const visibleMessages = (agent?.messages || []).filter(
    (m) =>
      (!activityFilter || ["user", "assistant", "agent"].includes(m.role)) &&
      (!chatQuery || m.content.toLowerCase().includes(chatQuery.toLowerCase())),
  );
  const nav = (
    id: string,
    label: string,
    icon: React.ReactNode,
    count?: number,
  ) => (
    <button
      className={`nav-item ${view === id ? "active" : ""}`}
      onClick={() => {
        setView(id);
        setQuery("");
        setSelected(null);
      }}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className="nav-count">{count}</span>
      )}
    </button>
  );
  return (
    <div className="app-shell">
      {viewer&&bridge&&<ComputerViewer bridge={bridge} {...viewer} onClose={()=>setViewer(null)}/>}
      {editingAgent&&bridge&&<AgentEditor bridge={bridge} id={editingAgent} onClose={()=>setEditingAgent(null)} onSaved={()=>{avatarRequests.delete(editingAgent);void connectLive();}}/>}
      <aside className="sidebar">
        <div className="window-space" />
        <div className="brand">
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          <div>
            GrokDeck<span>MAKE ROOM FOR GOOD WORK</span>
          </div>
        </div>
        <button
          className="quick-search"
          onClick={() => {
            setQuery("");
            setPalette(true);
          }}
        >
          <Search size={16} />
          <span>Find anything</span>
          <kbd>{info.platform === "darwin" ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav("overview", "Overview", <Layers3 size={17} />)}
          {nav(
            "attention",
            "Needs attention",
            <Bell size={17} />,
            attention.length,
          )}
          {nav("all", "All agents", <MessageSquare size={17} />, agents.length)}
          {nav("computers", "Computers", <Monitor size={17} />)}
          {nav("pinned", "Pinned", <Pin size={17} />)}
          {nav("history", "Discussion library", <BookOpen size={17} />)}
        </nav>
        <div className="nav-label section-heading">
          SECTIONS<span>{sections.length}</span>
        </div>
        <nav className="section-nav" aria-label="Agent sections">
          {sections.map((s) => (
            <React.Fragment key={s.id}>
              {nav(
                `section:${s.id}`,
                s.name,
                <span className="section-dot" />,
                agents.filter((a) => a.sectionId === s.id).length,
              )}
            </React.Fragment>
          ))}
          {!sections.length && (
            <p className="sidebar-hint">
              Your Grok Bot sections
              <br />
              will appear here.
            </p>
          )}
        </nav>
        {recent.length > 0 && (
          <div className="recent-block">
            <div className="nav-label">RECENT DISCUSSIONS</div>
            {recent.slice(0, 4).map((a) => (
              <button
                key={a.id}
                className="recent-item"
                onClick={() => openAgent(a)}
              >
                <Avatar agent={a} small live={live} />
                <span>{a.name}</span>
                {unread(a) && <i className="unread-dot" />}
              </button>
            ))}
          </div>
        )}
        <div className="sidebar-footer">
          <div className="source-indicator">
            <span
              className={`connection-dot ${data.source.available ? "connected" : ""}`}
            />
            <div>
              {demo
                ? "Example workspace"
                : live ? "Live gateway connected" : data.source.available
                  ? "Local cache connected"
                  : "Connect your workspace"}
              <small>
                {demo
                  ? "Preview · no real activity"
                  : live ? "Discussion updates every 2s" : data.source.available
                    ? "Read-only · refreshes every 15s"
                    : "Grok Bot data stays on this device"}
              </small>
            </div>
          </div>
          <button className="settings-button" onClick={() => setSettings(true)}>
            <Settings2 size={17} />
            Settings & appearance
            <ChevronRight size={15} />
          </button>
          <a className="designer-credit" href="https://ronmillar.com" target="_blank" rel="noopener noreferrer"
            onClick={event=>{if(bridge?.openDesigner){event.preventDefault();void bridge.openDesigner().catch(()=>setToast('Could not open ronmillar.com.'));}}}>
            GrokDeck by Ron Millar 2026 <ArrowUpRight size={11} aria-hidden="true" />
          </a>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
                    <button className="icon-button" aria-label="Search agents" title="Search agents" aria-expanded={agentSearchOpen} aria-controls="agent-search-field" onClick={()=>{setAgentSearchOpen(open=>!open);setQuery('');}}><Search size={17}/></button>
                    {agentSearchOpen && <div className="filter-input" id="agent-search-field">
                      <input autoFocus aria-label="Search agents and discussions" placeholder="Search names or discussions…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){setAgentSearchOpen(false);setQuery('');}}}/>
                      <button className="icon-button" aria-label="Close agent search" onClick={()=>{setAgentSearchOpen(false);setQuery('');}}><X size={13}/></button>
                    </div>}
            {demo && <span className="demo-badge">EXAMPLE DATA</span>}
            <span className="cache-badge">
              <Clock3 size={13} />
              {live ? 'Live gateway' : 'Cached view'}
            </span>
            {bridge?.connectLive && !demo && !live && <button className="button small-button" disabled={liveConnecting} onClick={()=>void connectLive()}>{liveConnecting?'Connecting…':'Retry connection'}</button>}
            <button
              className="icon-button"
              aria-label="Refresh cache"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
            <button
              className="icon-button"
              aria-label="Open settings"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={17} />
            </button>
          </div>
        </header>
        {appUpdate&&['available','downloaded'].includes(appUpdate.status)&&<div className="alert" role="status">
          <Download size={16}/><span>{appUpdate.message}</span><button className="button" onClick={()=>setSettings(true)}>Review update</button>
        </div>}
        {(error || data.source.warning) && (
          <div className="alert" role="alert">
            <Bell size={16} />
            <span>{error || data.source.warning}</span>
            {error && (
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
        {demo && (
          <div className="preview-banner">
            You’re exploring example data.{" "}
            <button
              onClick={() => {
                setDemo(false);
                setData(empty);
                setSelected(null);
                if (bridge) bridge.snapshot().then(setData).catch(fail);
              }}
            >
              Return to real workspace <ArrowUpRight size={13} />
            </button>
          </div>
        )}
        {releaseStatus?.status === "available" && !demo && (
          <div className="release-banner">
            <ArrowUpRight size={16} />
            <span>
              <strong>
                Grok Bot {releaseStatus.version}{" "}
                {releaseStatus.currentVersion
                  ? "is available"
                  : "is offered by the official feed"}
                .
              </strong>{" "}
              Update in Grok Bot when ready. Compatibility with this version has
              not been verified.
            </span>
            <button className="text-button" onClick={() => setSettings(true)}>
              Details
            </button>
          </div>
        )}
        <div className={`workspace-body ${agent ? "with-detail" : ""}`}>
          <section className={`primary-pane ${agent ? "narrow" : ""}`}>
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {new Date().toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </div>
                <h1>
                  {title}
                  <span className="title-period">.</span>
                </h1>
                <p>
                  {view === "computers" ? "Open, control or start your agents’ computers." : view === "overview"
                    ? "A little less noise. A clearer view of what matters."
                    : view === "history"
                      ? "Pick up a thought. Find the discussion behind it."
                      : view === "attention"
                        ? "Unread results and requests from your last cached roster."
                        : "Your people, projects, and ideas. All within reach."}
                </p>
              </div>
              {view === "overview" && (
                <div className="heading-art" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <Layers3 size={33} />
                </div>
              )}
            </div>
            {view==='computers' ? <section className="computers-view" aria-label="Computers">
              {!live ? <div className="empty-state"><Monitor size={28}/><h2>Connecting to your computers</h2><p>Computer status is read through your local helper.</p><button className="button primary" disabled={liveConnecting||!bridge?.connectLive} onClick={()=>void connectLive()}>Retry connection</button></div> : <>
                <div className="list-heading"><label><input type="checkbox" checked={activeComputersOnly} onChange={e=>setActiveComputersOnly(e.target.checked)}/> Active only</label><button className="button small-button" disabled={computersLoading} onClick={()=>void refreshComputers()}><RefreshCw size={14}/>{computersLoading?'Reading status…':'Refresh computers'}</button></div>
                {computersError&&<p role="alert">{computersError}</p>}
                {computers&&<p className="search-caption">Bots with running computers: {computers.computers.filter(c=>c.state==='running').length} · Bots checked: {computers.computers.length} · Status unavailable: {computers.computers.filter(c=>c.state==='unknown').length} · {computers.complete?'Complete result':'Partial result'} · {date(computers.checkedAt)}</p>}
                {(computers?.computers||[]).filter(c=>!activeComputersOnly||c.state==='running').map(computer=><article className="computer-row" key={computer.agentId}>
                  <Monitor size={21}/><div><strong>{computer.name}</strong><span className="computer-state">{computer.state==='running'?'Running':computer.state==='hibernated'?'Sleeping':computer.state==='absent'?'No computer':'Status unavailable'}</span>{computer.windows.map(window=><p key={window.index}>{window.label||`Window ${window.index+1}`}</p>)}{computer.error&&<p>Status could not be read for this agent.</p>}</div>
                  <button className="button small-button" disabled={!agents.some(a=>a.id===computer.agentId)} onClick={()=>{const target=agents.find(a=>a.id===computer.agentId);if(target){setView('all');openAgent(target);}}}>Open chat <ArrowUpRight size={14}/></button>
                  {computer.state==='running'&&bridge?.openViewer&&<button className="button small-button" onClick={()=>setViewer({id:computer.agentId,name:computer.name})}>View computer</button>}
                  {computer.state==='running'&&computer.windows.map(w=><button className="button small-button" key={w.index} onClick={()=>setViewer({id:computer.agentId,name:computer.name,windowIndex:w.index})}>{w.label||`Window ${w.index+1}`}</button>)}
                  {['absent','hibernated'].includes(computer.state)&&bridge?.startComputer&&<button className="button small-button" disabled={startingComputer!==null} onClick={async()=>{setStartingComputer(computer.agentId);try{await bridge.startComputer!(computer.agentId);await refreshComputers();}catch{setComputersError('Start could not be confirmed. Refresh status or open Grok Bot before trying again.');}finally{setStartingComputer(null);}}}>{startingComputer===computer.agentId?'Starting…':'Start computer'}</button>}
                  <button className="button small-button" onClick={()=>void bridge?.openAgent(computer.agentId)}>Open in Grok Bot</button>
                </article>)}
                {!computersLoading&&computers&&!computers.computers.some(c=>!activeComputersOnly||c.state==='running')&&<div className="empty-state"><h2>{activeComputersOnly?'No running bot computers observed':'No computers returned'}</h2><p>{computers.complete&&!computers.computers.some(c=>c.state==='unknown')?'Turn off Active only to include sleeping computers.':'Some statuses are unavailable. Refresh or turn off Active only to review them.'}</p></div>}
                <p className="search-caption">Status is shown per bot; underlying computers may be shared. Control is enabled when you open a screen. Starting a computer may use your Grok Bot account’s resources.</p>
              </>}
            </section> : loading && !data.agents.length ? (
              <div className="empty-state">
                <LoaderCircle className="spin" />
                <h2>Opening your deck…</h2>
              </div>
            ) : !data.agents.length ? (
              <div className="onboarding">
                <div className="onboarding-icon">
                  <Layers3 size={34} />
                </div>
                <span className="eyebrow">A PLACE FOR YOUR AGENTS</span>
                <h2>
                  Bring your conversations
                  <br />
                  into focus.
                </h2>
                <p>
                  Connect the Grok Bot cache on this computer to explore your
                  agents and past discussions. Your data is read locally and
                  never uploaded by GrokDeck.
                </p>
                <button className="button primary" onClick={chooseSource}>
                  <FolderOpen size={17} />
                  Choose Grok Bot data folder
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setDemo(true);
                    setData(demoSnapshot());
                  }}
                >
                  Explore an example workspace <ArrowUpRight size={14} />
                </button>
                <div className="onboarding-note">
                  Open Grok Bot and sign in first. Only cached history is
                  available; GrokDeck does not sign in to your account.
                </div>
              </div>
            ) : (
              <>
                {view==='overview'&&organizationError&&<p role="alert">{organizationError}</p>}
                {view==='overview'&&<OverviewGroups disabled={!syncedOrganization||organizationBusy}  agents={agents.filter(match)} organization={organization} onChange={organization=>void changeOrganization(organization)} onOpen={openAgent} renderAvatar={a=><Avatar agent={a} small live={live}/>}/>}
                {view!=='overview'&&<>
                {view==='all'&&<div className="agent-filters">
                  <label>Sort<select aria-label="Sort agents" value={agentSort} onChange={e=>setAgentSort(e.target.value)}><option value="recent">Recent activity</option><option value="oldest">Oldest activity</option><option value="name">Name A–Z</option><option value="group">Group</option></select></label>
                  <label>Status<select aria-label="Filter agents" value={agentFilter} onChange={e=>setAgentFilter(e.target.value)}><option value="all">All statuses</option><option value="unread">Unread</option><option value="waiting">Needs reply</option><option value="pinned">Pinned</option></select></label>
                  <label>Group<select aria-label="Filter group" value={groupFilter} onChange={e=>setGroupFilter(e.target.value)}><option value="all">All groups</option>{sections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}<option value="__unassigned__">Ungrouped</option></select></label>
                </div>}
                <div className="list-heading">
                  <h2>
                    {view === "overview"
                      ? "On your radar"
                      : `${filtered.length} ${view === "history" ? "discussions" : "agents"}`}
                  </h2>
                </div>
                {query && (
                  <p className="search-caption">
                    Searching agent names, latest results, and {live ? "loaded" : "cached"} discussion text.
                  </p>
                )}
                <div className="agent-list">
                  {!filtered.length ? (
                    <div className="empty-state">
                      <Search size={25} />
                      <h3>
                        {query ? "No matching discussions" : "Nothing here yet"}
                      </h3>
                      <p>
                        {query
                          ? `Try another name or phrase. Only ${live ? "loaded" : "locally cached"} history is searchable.`
                          : `Explore all agents or refresh your ${live ? "roster" : "cache"}.`}
                      </p>
                    </div>
                  ) : (
                    filtered.map((a) => (
                      <div
                        key={a.id}
                        className={`agent-row ${selected === a.id ? "selected" : ""}`}
                      >
                        <button
                          className="agent-main"
                          onClick={() => openAgent(a)}
                        >
                          <Avatar agent={a} live={live} />
                          <div className="agent-copy">
                            <div>
                              <strong>{a.name}</strong>
                              {unread(a) && <i className="unread-dot" />}
                              <span className="section-tag">{a.section}</span>
                            </div>
                            <p>{a.preview}</p>
                          </div>
                        </button>
                        <div className="agent-row-meta">
                          <span
                            className={`status-pill ${a.awaitingResponse ? "waiting" : unread(a) ? "unread" : ""}`}
                          >
                            {a.awaitingResponse
                              ? "Reply requested"
                              : unread(a)
                                ? "Unread"
                                : live ? "Gateway" : "Cached"}
                          </span>
                          <time title={date(a.lastActivityAt)}>
                            {age(a.lastActivityAt)}
                          </time>
                        </div>
                        <button
                          className={`icon-button pin-button ${pinned(a) ? "is-pinned" : ""}`}
                          aria-label={`${pinned(a) ? "Unpin" : "Pin"} ${a.name}`}
                          onClick={() => togglePin(a)}
                        >
                          <Pin size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                </>}
                <div className="list-footer">
                  <span>
                    {demo
                      ? "Example data"
                      : `${live ? "Gateway roster checked" : "Roster last written"} ${date(data.source.cacheUpdatedAt)}`}
                  </span>
                  <span>{live ? "Discussion updates every 2 seconds" : "Cached states aren’t live activity"}</span>
                </div>
                {data.warnings.length > 0 && (
                  <details className="cache-warnings">
                    <summary>
                      {data.warnings.length} cache compatibility notices
                    </summary>
                    {data.warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </details>
                )}
              </>
            )}
          </section>
          {agent && (
            <aside
              className="detail-pane"
              aria-label={`Discussion with ${agent.name}`}
            >
              <div className="detail-header">
                <button
                  className="icon-button close-detail"
                  aria-label="Close discussion"
                  onClick={() => setSelected(null)}
                >
                  <ArrowLeft size={18} />
                </button>
                <Avatar agent={agent} small live={live} />
                <div>
                  <h2>{agent.name}</h2>
                  <span>
                    {agent.section} · {agent.messages.length} {live ? "loaded entries" : "cached entries"}
                  </span>
                </div>
                <button
                  className={`icon-button ${pinned(agent) ? "is-pinned" : ""}`}
                  aria-label="Pin selected agent"
                  onClick={() => togglePin(agent)}
                >
                  <Pin size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Close discussion"
                  onClick={() => setSelected(null)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="discussion-toolbar">
                {live&&bridge?.openViewer&&<button className="icon-button" aria-label="Open agent computer" title="Open computer" onClick={()=>setViewer({id:agent.id,name:agent.name})}><Monitor size={17}/></button>}
                {live&&bridge?.agentProfile&&<button className="button small-button" onClick={()=>setEditingAgent(agent.id)}>Edit agent</button>}
                <button className="icon-button" aria-label="Search discussion" title="Search discussion" aria-expanded={discussionSearchOpen} aria-controls="discussion-search-field" onClick={()=>{setDiscussionSearchOpen(open=>!open);setChatQuery('');}}><Search size={17}/></button>
                {discussionSearchOpen && <div className="filter-input" id="discussion-search-field">
                  <input autoFocus aria-label="Search this discussion" placeholder="Find in discussion…" value={chatQuery} onChange={e=>setChatQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){setDiscussionSearchOpen(false);setChatQuery('');}}}/>
                  <button className="icon-button" aria-label="Close discussion search" onClick={()=>{setDiscussionSearchOpen(false);setChatQuery('');}}><X size={13}/></button>
                </div>}
                <button className="icon-button" aria-label="Jump to latest" title="Jump to latest" onClick={()=>{followLatest.current=true;if(transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight;}}><ArrowDown size={16}/></button>
                <button
                  className={`icon-button ${notesOpen ? "is-pinned" : ""}`}
                  aria-label="Toggle private notes"
                  title="Private notes"
                  onClick={() => setNotesOpen((v) => !v)}
                >
                  <BookOpen size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Export discussion"
                  title="Export cached discussion"
                  onClick={async () => {
                    if (!bridge || demo) {
                      announce(
                        "Exports are available for real discussions in the desktop app.",
                      );
                      return;
                    }
                    try {
                      if (await bridge.exportConversation(agent.id))
                        announce("Discussion exported.");
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  <Download size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Mark reviewed in GrokDeck"
                  title="Mark reviewed in GrokDeck"
                  onClick={() => {
                    save({ seen: { ...prefs.seen, [agent.id]: Date.now() } });
                    announce(
                      "Marked reviewed in GrokDeck. Grok Bot is unchanged.",
                    );
                  }}
                >
                  <CheckCheck size={16} />
                </button>
              </div>
              {notesOpen && (
                <div className="notes-panel">
                  <label htmlFor="private-notes">
                    YOUR PRIVATE NOTES{" "}
                    <span>Stored in GrokDeck on this device</span>
                  </label>
                  <textarea
                    id="private-notes"
                    placeholder="Keep a thought, a decision, a next step…"
                    value={prefs.notes[agent.id] || ""}
                    onChange={(e) =>
                      save({
                        notes: {
                          ...prefsRef.current.notes,
                          [agent.id]: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              )}
              <div className="transcript-meta">
                <span>
                  <Clock3 size={12} />
                  {live ? 'Live discussion · latest 100 entries' : agent.cachedAt
                    ? `History cached ${date(agent.cachedAt)}`
                    : "No transcript cached"}
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={activityFilter}
                    onChange={(e) => setActivityFilter(e.target.checked)}
                  />
                  Messages only
                </label>
              </div>
              <div className="transcript" ref={transcript} onScroll={e=>{const el=e.currentTarget;followLatest.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}>
                {!visibleMessages.length ? (
                  <div className="empty-state">
                    <MessageSquare size={28} />
                    <h3>
                      {chatQuery
                        ? "No matching entries"
                        : live ? "Loading current discussion…" : "This discussion isn’t cached yet"}
                    </h3>
                    <p>
                      {chatQuery
                        ? "Try another phrase."
                        : live ? "The latest messages are requested from the gateway." : "Open it in Grok Bot, then return and refresh. Cached history may be incomplete."}
                    </p>
                    <button className="button" onClick={() => handoff(agent)}>
                      Open in Grok Bot <ExternalLink size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    {visibleMessages.length > messageLimit && (
                      <button
                        className="load-earlier"
                        onClick={() => setMessageLimit((n) => n + 100)}
                      >
                        Show{" "}
                        {Math.min(100, visibleMessages.length - messageLimit)}{" "}
                        earlier entries <ChevronDown size={14} />
                      </button>
                    )}
                    {visibleMessages
                      .slice(-messageLimit)
                      .map((m, index, all) => {
                        const day = m.timestamp
                          ? new Date(m.timestamp).toLocaleDateString(
                              undefined,
                              {
                                month: "long",
                                day: "numeric",
                                year: "numeric",
                              },
                            )
                          : "Unknown date";
                        const previous = all[index - 1];
                        const newDay =
                          !previous ||
                          new Date(previous.timestamp).toDateString() !==
                            new Date(m.timestamp).toDateString();
                        return (
                          <React.Fragment key={m.id}>
                            {newDay && (
                              <div className="day-divider">
                                <span>{day}</span>
                              </div>
                            )}
                            <MessageCard
                              message={m}
                              agent={agent}
                              copied={announce}
                              live={live}
                              onReply={live ? ()=>{if(pendingSends[agent.id])return;setReplyTargets(current=>({...current,[agent.id]:{id:m.id,content:m.content}}));requestAnimationFrame(()=>composer.current?.focus());} : undefined}
                            />
                          </React.Fragment>
                        );
                      })}
                  </>
                )}
              </div>
              <div className="detail-bottom">
                <div className="draft-label">
                  <span>{live ? "MESSAGE" : "DRAFT A FOLLOW-UP"}</span>
                  <span>Saved on this device</span>
                </div>
                {replyTargets[agent.id] && <div className="reply-context" role="region" aria-label="Reply context">
                  <Reply size={15}/><div><strong>Replying to a message</strong><p>{replyTargets[agent.id].content.slice(0,240)}</p></div>
                  <button className="icon-button" aria-label="Cancel reply" disabled={!!pendingSends[agent.id]} onClick={()=>setReplyTargets(current=>{const next={...current};delete next[agent.id];return next;})}><X size={14}/></button>
                </div>}
                <textarea
                  ref={composer}
                  aria-label="Draft follow-up"
                  disabled={!!pendingSends[agent.id]}
                  placeholder={`A thought for ${agent.name}…`}
                  value={prefs.drafts[agent.id] || ""}
                  onChange={(e) =>
                    save({
                      drafts: {
                        ...prefsRef.current.drafts,
                        [agent.id]: e.target.value,
                      },
                    })
                  }
                />
                {emojiOpen && <div className="emoji-palette" role="group" aria-label="Quick emoji replies">{['🙂','👍','❤️','🎉','🤔','👀'].map(emoji=><button key={emoji} type="button" className="button small-button" aria-label={`Insert ${emoji}`} disabled={!!pendingSends[agent.id]} onClick={()=>{save({drafts:{...prefsRef.current.drafts,[agent.id]:(prefsRef.current.drafts[agent.id]||'')+emoji}});composer.current?.focus();}}>{emoji}</button>)}</div>}
                <div className="draft-actions">
                  <button className="icon-button" aria-label="Emoji" title="Emoji" aria-expanded={emojiOpen} disabled={!!pendingSends[agent.id]} onClick={()=>setEmojiOpen(open=>!open)}><Smile size={17}/></button>
                  <span>{live ? 'Sends through your Mac bridge.' : 'Sending happens in Grok Bot.'}</span>
                  {live && (pendingSends[agent.id] ? <div role="status">
                    <span>{pendingSends[agent.id].status==='sending'?'Sending…':'Delivery is uncertain. Do not resend.'}</span>
                    <button className="button small-button" disabled={pendingSends[agent.id].status==='sending'} onClick={()=>void checkAcceptance(agent)}>Check status</button>
                  </div> : <button className="button primary small-button" disabled={!prefs.drafts[agent.id]?.trim()} onClick={()=>void submitLive(agent)}>Send message</button>)}
                  {live && <button className="button small-button" onClick={async()=>{try{const result=await bridge!.interrupt!(agent.id);announce(result.hadActiveRun?'Stop requested.':'No active run to stop.');}catch{setError('Could not confirm stopping the run. Check Grok Bot.');}}}>Stop run</button>}
                  <button
                    className="button small-button"
                    onClick={async () => {
                      const text = prefs.drafts[agent.id];
                      if (!text) {
                        await handoff(agent);
                        return;
                      }
                      if (demo) {
                        announce("Connect real data to continue in Grok Bot.");
                        return;
                      }
                      try {
                        await bridge?.copy(text);
                        await handoff(agent);
                        announce(
                          "Draft copied. Paste it into Grok Bot when ready.",
                        );
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    Continue in Grok Bot <ArrowUpRight size={15} />
                  </button>
                </div>
              </div>
            </aside>
          )}
        </div>
      </main>
      {settings && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSettings(false);
          }}
        >
          <section
            className="settings-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Settings and appearance"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">MAKE IT YOURS</span>
                <h2>Settings & appearance</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close settings"
                onClick={() => setSettings(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="settings-content">
              <h3>Appearance</h3>
              <label className="setting-label">Theme</label>
              <div className="segmented">
                {(["dark", "light", "system"] as const).map((t) => (
                  <button
                    key={t}
                    className={prefs.theme === t ? "chosen" : ""}
                    onClick={() => save({ theme: t })}
                  >
                    {t === "dark" ? (
                      <Moon size={15} />
                    ) : t === "light" ? (
                      <Sun size={15} />
                    ) : (
                      <Layers3 size={15} />
                    )}{" "}
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <label className="setting-label">Accent color</label>
              <div className="accent-options">
                {(["violet", "mint", "amber", "blue"] as const).map((c) => (
                  <button
                    key={c}
                    className={`accent-choice ${c} ${prefs.accent === c ? "chosen" : ""}`}
                    aria-label={`${c} accent`}
                    onClick={() => save({ accent: c })}
                  >
                    {prefs.accent === c && <Check size={16} />}
                  </button>
                ))}
              </div>
              <div className="settings-columns">
                <label>
                  Density
                  <select
                    aria-label="Density"
                    value={prefs.density}
                    onChange={(e) =>
                      save({
                        density: e.target.value as Preferences["density"],
                      })
                    }
                  >
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </select>
                </label>
                <label>
                  Text size
                  <select
                    aria-label="Text size"
                    value={prefs.fontSize}
                    onChange={(e) => save({ fontSize: Number(e.target.value) })}
                  >
                    {[13, 14, 15, 16, 18].map((n) => (
                      <option key={n} value={n}>
                        {n}px
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <hr />
              <h3>Grok Bot connection</h3>
              <p>
                Cached mode reads local history. Live mode uses your authenticated local bridge;
                sending requires the Send button. Grok Bot session credentials stay in the host bridge.
              </p>
              <div className="source-path">
                {data.source.path || "Default Grok Bot data folder"}
              </div>
              <div className="button-row">
                <button className="button" onClick={chooseSource}>
                  <FolderOpen size={15} />
                  Choose folder
                </button>
                <button
                  className="text-button"
                  onClick={async () => {
                    if (bridge) {
                      try {
                        setData(await bridge.resetSource());
                        setDemo(false);
                        setSelected(null);
                      } catch (e) {
                        fail(e);
                      }
                    }
                  }}
                >
                  Use default
                </button>
              </div>
              <hr />
              <h3>Connect your own Grok Bot account</h3>
              <ol><li>Open Grok Bot on this computer and sign in to your account.</li><li>Open GrokDeck; it connects automatically. Check that your agents appear.</li><li>To use your iPhone, start the phone connection below and copy its one-time setup.</li><li>On iPhone, open GrokDeck Settings → Quick pairing and paste the setup within five minutes.</li></ol>
              <p>Your account stays on this computer. Each person runs their own helper; there is no shared GrokDeck account. Never send your setup code to someone else.</p>
              <h3>Connect your iPhone</h3>
              <p>Use the same trusted network on both devices. Keep GrokDeck open while your phone is connected. Once enabled, this connection resumes when GrokDeck opens.</p>
              {phone?.active ? <>
                <p role="status">Phone connection ready: {phone.endpoint}</p>
                <button className="button" onClick={async()=>{
                  try{const result=await bridge!.copyPhoneSetup!();if(result.copied)setPhoneMessage('Setup copied. Paste it into GrokDeck Settings on your iPhone within five minutes.');}
                  catch{setPhoneMessage('Could not copy setup. Try again.');}
                }}>Copy phone setup</button>
                <button className="button" disabled={phoneBusy} onClick={async()=>{
                  setPhoneBusy(true);try{await bridge!.stopPhone!();setPhone(await bridge!.phoneHosts!());setPhoneMessage('Phone connection stopped.');}catch{setPhoneMessage('Could not stop phone connection.');}finally{setPhoneBusy(false);}
                }}>Stop phone connection</button>
              </> : <>
                <label>Private network address <select aria-label="Phone network address" value={phoneAddress} onChange={e=>setPhoneAddress(e.target.value)}>
                  <option value="">Choose your network</option>
                  {phone?.hosts?.map(row=><option key={row.name+row.address} value={row.address}>{row.name} · {row.address}</option>)}
                </select></label>
                <button className="button" disabled={!phoneAddress||phoneBusy} onClick={async()=>{
                  setPhoneBusy(true);setPhoneMessage('');try{setPhone(await bridge!.startPhone!(phoneAddress));}catch{setPhoneMessage('Could not start phone connection. Check Grok Bot sign-in and the selected network.');}finally{setPhoneBusy(false);}
                }}>{phoneBusy?'Starting…':'Start phone connection'}</button>
              </>}
              {phoneMessage&&<p role="status">{phoneMessage}</p>}
              <h3>GrokDeck updates</h3>
              <p>Check GitHub for new GrokDeck releases. Public downloads do not require a GitHub account. In-app installation requires a signed build; otherwise download the installer manually.</p>
              <div className="release-settings">
                <button className="button" onClick={()=>void checkAppUpdates(true)} disabled={['checking','downloading','installing'].includes(appUpdate?.status||'')}>Check GrokDeck updates</button>
                <button className="button" onClick={()=>void bridge?.openDownloads?.()}>Open downloads</button>
                {appUpdate&&<p role="status">{appUpdate.message}</p>}
                {appUpdate?.status==='available'&&appUpdate.canInstall&&<button className="button" onClick={async()=>{
                  setAppUpdate({...appUpdate,status:'downloading',message:'Downloading GrokDeck…'});
                  try{setAppUpdate(await bridge!.downloadUpdate!());}catch{setToast('Update download failed. Check again.');void checkAppUpdates(true);}
                }}>Download GrokDeck {appUpdate.version}</button>}
                {appUpdate?.status==='downloaded'&&<button className="button" disabled={Object.keys(pendingSends).length>0} onClick={async()=>{
                  try{await saves.current;setAppUpdate(await bridge!.installUpdate!());}catch{setToast('Resolve pending message delivery before restarting.');}
                }}>Restart and install</button>}
              </div>
              <h3>Grok Bot compatibility</h3>
              <div className="version-row">
                <span>GrokDeck</span>
                <strong>
                  {info.version} · {info.platform} {info.arch}
                </strong>
              </div>
              <div className="version-row">
                <span>Detected Grok Bot</span>
                <strong>{data.source.version || "Not detected"}</strong>
              </div>
              <div className="version-row">
                <span>Tested cache format</span>
                <strong>{info.supportedSourceVersion}</strong>
              </div>
              <p>
                Release checks contact Grok Bot’s official update service with
                your platform, version, and a separate random rollout ID. No
                account credentials or conversation text are sent. Availability
                does not establish compatibility. Nothing is downloaded or
                installed.
              </p>
              <div className="release-settings">
                <label>
                  <input
                    type="checkbox"
                    checked={prefs.checkReleases}
                    onChange={(e) => save({ checkReleases: e.target.checked })}
                  />{" "}
                  Check for GrokDeck and Grok Bot releases when the app opens and every six
                  hours
                </label>
                <button
                  className="button"
                  disabled={releaseChecking}
                  onClick={() => void checkReleases(true)}
                >
                  <RefreshCw
                    size={14}
                    className={releaseChecking ? "spin" : ""}
                  />
                  {releaseChecking ? "Checking…" : "Check Grok Bot releases"}
                </button>
                {releaseStatus && (
                  <p role="status">
                    {releaseStatus.message}
                    <br />
                    <small>
                      Checked {date(releaseStatus.checkedAt)} · availability
                      does not establish compatibility.
                    </small>
                  </p>
                )}
              </div>
              <hr />
              <h3>Your data</h3>
              <p>
                Pins, notes, reviewed markers, and drafts are saved separately
                in GrokDeck’s local preferences. Only discussions cached by Grok
                Bot appear here. No cloud sync or telemetry.
              </p>
              <button
                className="text-button"
                onClick={() => {
                  setDemo(true);
                  setData(demoSnapshot());
                  setSelected(null);
                  setSettings(false);
                }}
              >
                Explore example workspace <ArrowUpRight size={14} />
              </button>
            </div>
          </section>
        </div>
      )}
      {palette && (
        <div
          className="modal-backdrop palette-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPalette(false);
          }}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Find agents and discussions"
          >
            <div className="palette-input">
              <Search size={20} />
              <input
                ref={searchInput}
                aria-label="Find anything"
                placeholder="Find an agent, a project, a thought…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const first = agents.find(match);
                    if (first) openAgent(first);
                  }
                }}
              />
              <button
                className="icon-button"
                onClick={() => setPalette(false)}
                aria-label="Close search"
              >
                <X size={17} />
              </button>
            </div>
            <div className="palette-label">
              {query
                ? "MATCHING AGENTS & CACHED DISCUSSIONS"
                : "RECENTLY ACTIVE"}
            </div>
            <div className="palette-results">
              {agents
                .filter(match)
                .slice(0, 40)
                .map((a) => (
                  <button key={a.id} onClick={() => openAgent(a)}>
                    <Avatar agent={a} small live={live} />
                    <div>
                      <strong>{a.name}</strong>
                      <span>
                        {(query &&
                          a.messages
                            .find((m) =>
                              m.content
                                .toLowerCase()
                                .includes(query.toLowerCase()),
                            )
                            ?.content.slice(0, 150)) ||
                          a.preview}
                      </span>
                    </div>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              {!agents.filter(match).length && (
                <div className="empty-state">
                  No matches in your cached discussions.
                </div>
              )}
            </div>
            <div className="palette-footer">
              <span>Search stays on this computer</span>
              <span>Enter to open · Esc to close</span>
            </div>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
function MessageCard({
  message: m,
  agent,
  copied,
  live = false,
  onReply,
}: {
  message: Message;
  agent: Agent;
  copied: (s: string) => void;
  live?: boolean;
  onReply?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = m.content.length > 10000;
  const content =
    isLong && !expanded ? `${m.content.slice(0, 10000)}\n\n…` : m.content;
  return (
    <article className={`message ${m.role}`}>
      <div className="message-heading">
        <span>
          {m.author ||
            (m.role === "user"
              ? "You"
              : m.role === "assistant"
                ? agent.name
                : "Activity")}
        </span>
        <time>
          {m.timestamp
            ? new Date(m.timestamp).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })
            : "—"}
        </time>
        {onReply && <button className="icon-button" aria-label="Reply to message" title="Reply to message" onClick={onReply}><Reply size={13}/></button>}
        <button
          className="icon-button"
          aria-label="Copy message"
          onClick={async () => {
            try {
              if (bridge) await bridge.copy(m.content);
              else await navigator.clipboard.writeText(m.content);
              copied("Message copied.");
            } catch {
              copied("Clipboard unavailable. Select and copy the text.");
            }
          }}
        >
          <Copy size={12} />
        </button>
      </div>
      <div className="markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children, href }) => (
              <span className="rendered-link" title={href}>
                {children}
                {href && <small> ({href})</small>}
              </span>
            ),
            img: ({ alt }) => (
              <span className="attachment-placeholder">
                [Image: {alt || "open in Grok Bot"}]
              </span>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
      {isLong && (
        <button className="text-button" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Show full message"}
        </button>
      )}
      {m.streaming && (
        <small className="streaming-note">
          {live ? "Receiving updates from Grok Bot…" : "Was streaming when cached · open Grok Bot for current state"}
        </small>
      )}
    </article>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
