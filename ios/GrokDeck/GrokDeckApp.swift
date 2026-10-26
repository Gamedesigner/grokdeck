import SwiftUI

@main struct GrokDeckApp: App {
  @StateObject private var store = DeckStore()
  @AppStorage("appearance") private var appearance = "system"
  var body: some Scene {
    WindowGroup {
      DeckHome().environmentObject(store)
        .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
        .tint(.purple)
    }
  }
}
struct DeckHome: View {
  @EnvironmentObject private var store: DeckStore
  @Environment(\.scenePhase) private var scenePhase
  @State private var search = ""
  @State private var showingSearch = false
  @State private var settings = false
  @State private var showingComputers = false
  @State private var attentionOnly = false
  @State private var path: [DeckAgent] = []
  private var filtered: [DeckAgent] {
    store.agents.filter { agent in
      (!attentionOnly || agent.hasUnread || agent.awaitingResponse)
        && (search.isEmpty
          || "\(agent.name) \(agent.section) \(agent.preview)".localizedCaseInsensitiveContains(
            search))
    }
  }
  var body: some View {
    NavigationStack(path: $path) {
      Group {
        if !store.isPaired {
          ContentUnavailableView {
            Label("Your deck, within reach", systemImage: "square.stack.3d.up")
          } description: {
            Text(
              "Connect to your Mac’s GrokDeck bridge to browse agents and cached discussions. Your iPhone cannot read Grok Bot’s private app data directly."
            )
          } actions: {
            Button("Connect your Mac") { settings = true }.buttonStyle(.borderedProminent)
          }
        } else {
          List {
            Section {
              VStack(alignment: .leading, spacing: 9) {
                Text(store.exampleMode ? (store.isLive ? "EXAMPLE LIVE DATA" : "EXAMPLE DATA") : (store.isLive ? "LIVE CONNECTION" : "READ-ONLY DESKTOP CACHE")).font(
                  .caption2.weight(.semibold)
                ).foregroundStyle(.purple)
                HStack {
                  summary("Agents", value: store.agents.count, icon: "person.2")
                  Spacer()
                  if !store.isLive { summary(
                    "Discussions", value: store.agents.filter { $0.messageCount > 0 }.count,
                    icon: "text.bubble") }
                }
                Text(store.isLive ? "Connected through your Mac. Open a conversation for reply updates." : "Cached states are not live execution status.").font(.caption).foregroundStyle(
                  .secondary)
                if let source = store.source, source.cacheUpdatedAt > 0 {
                  Text(
                    "\(store.isLive ? "Updated" : "Host cache"): \(Date(timeIntervalSince1970: source.cacheUpdatedAt / 1000).formatted(date: .abbreviated, time: .shortened))"
                  ).font(.caption2).foregroundStyle(.secondary)
                }
              }.padding(.vertical, 5)
            }
            if let error = store.error {
              Section {
                Label(error, systemImage: "exclamationmark.triangle").font(.callout)
                  .foregroundStyle(.orange)
              }
            }
            if let warning = store.source?.warning {
              Section { Text(warning).font(.caption).foregroundStyle(.orange) }
            }
            Section {
              Toggle("Needs attention", isOn: $attentionOnly)
            } footer: {
              Text(store.isLive ? "Unread or awaiting a response in the live roster." : "Unread or awaiting a response in the host’s cached roster.")
            }
            Section(search.isEmpty ? "Your agents" : "Search results") {
              ForEach(filtered) { agent in
                NavigationLink(value: agent) { AgentRow(agent: agent, live: store.isLive) }.accessibilityIdentifier(
                  "agent-\(agent.id)")
              }
              if filtered.isEmpty {
                Text(store.isLive ? "No matching agents." : "No matching agents in the cached roster.").foregroundStyle(.secondary)
              }
            }
          }.refreshable { await store.refresh() }
        }
      }
      .navigationTitle("GrokDeck")
      .safeAreaInset(edge: .top) {
        if showingSearch {
          DeckSearchField(text: $search, prompt: "Search agents or latest results", identifier: "agent-search-field") {
            showingSearch = false; search = ""
          }
        }
      }
      .toolbar {
        if path.isEmpty {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Computers", systemImage: "desktopcomputer") { showingComputers = true }
            .labelStyle(.iconOnly).disabled(!store.isPaired)
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button("Search agents", systemImage: "magnifyingglass") { showingSearch.toggle(); if !showingSearch { search = "" } }
            .labelStyle(.iconOnly).disabled(!store.isPaired)
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            settings = true
          } label: {
            Image(systemName: "slider.horizontal.3")
          }.accessibilityLabel("Settings")
        }
        }
        if store.loading { ToolbarItem(placement: .topBarLeading) { ProgressView() } }
      }
      .navigationDestination(for: DeckAgent.self) { agent in DiscussionView(agent: agent) }
      .sheet(isPresented: $settings) { ConnectionView() }
      .sheet(isPresented: $showingComputers) {
        NavigationStack {
          ComputersView { id in
            showingComputers = false
            if let agent = store.agents.first(where: { $0.id == id }) { path.append(agent) }
          }
        }.environmentObject(store)
      }
      .onChange(of: store.isPaired) { _, paired in if !paired { path.removeAll() } }
      .onChange(of: path.count) { _, count in if count > 0 { showingSearch = false; search = "" } }
      .onChange(of: store.agents) { _, agents in
        if path.contains(where: { item in !agents.contains(where: { $0.id == item.id }) }) {
          path.removeAll()
        }
      }
      .task {
        await store.refresh()
        while !Task.isCancelled {
          do { try await Task.sleep(for: .seconds(15)) } catch { return }
          if scenePhase == .active { await store.refresh() }
        }
      }
      .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await store.refresh() } }
      }
    }
  }
  private func summary(_ title: String, value: Int, icon: String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      Label(title, systemImage: icon).font(.caption).foregroundStyle(.secondary)
      Text("\(value)").font(.title.weight(.medium))
    }
  }
}
struct DeckSearchField: View {
  @Binding var text: String
  let prompt: String
  let identifier: String
  let close: () -> Void
  @FocusState private var focused: Bool
  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
      TextField(prompt, text: $text).textFieldStyle(.plain).focused($focused)
        .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search)
        .accessibilityIdentifier(identifier)
      Button("Close search", systemImage: "xmark.circle.fill") { focused = false; close() }
        .labelStyle(.iconOnly).foregroundStyle(.secondary)
    }.padding(.horizontal).padding(.vertical, 10).background(.bar)
      .onAppear { focused = true }
  }
}
struct AgentRow: View {
  let agent: DeckAgent
  var live = false
  @EnvironmentObject private var store: DeckStore
  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Group {
      if let data = store.avatars[agent.id], let image = UIImage(data: data) {
        Image(uiImage: image).resizable().scaledToFill().frame(width: 38, height: 38)
          .clipShape(RoundedRectangle(cornerRadius: 11)).accessibilityHidden(true)
      } else { Text(
        agent.name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined()
      )
      .font(.caption.weight(.semibold)).foregroundStyle(.purple).frame(width: 38, height: 38)
      .background(.purple.opacity(0.12), in: RoundedRectangle(cornerRadius: 11))
      }
      }
      VStack(alignment: .leading, spacing: 5) {
        HStack {
          Text(agent.name).font(.headline)
          if agent.hasUnread {
            Circle().fill(.blue).frame(width: 6, height: 6).accessibilityLabel(live ? "Unread" : "Cached unread")
          }
        }
        Text(agent.preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
        Text(live ? agent.section : "\(agent.section) · \(agent.messageCount) cached entries").font(.caption2)
          .foregroundStyle(.tertiary)
        if agent.awaitingResponse {
          Text(live ? "Response requested" : "Response requested · cached").font(.caption).foregroundStyle(.orange)
        }
      }
    }.padding(.vertical, 5)
      .task(id: "\(agent.id)-\(store.isLive)") { await store.loadAvatar(agent.id) }
  }
}
struct ConnectionView: View {
  @EnvironmentObject private var store: DeckStore
  @Environment(\.dismiss) private var dismiss
  @AppStorage("appearance") private var appearance = "system"
  @State private var address = ""
  @State private var token = ""
  @State private var fingerprint = ""
  @State private var phoneSetup = ""
  var body: some View {
    NavigationStack {
      Form {
        Section {
          PasteButton(payloadType: String.self) { values in
            if let value = values.first { phoneSetup = value }
          }.accessibilityIdentifier("paste-phone-setup")
          SecureField("Paste phone setup", text: $phoneSetup)
            .textInputAutocapitalization(.never).autocorrectionDisabled().privacySensitive()
            .accessibilityIdentifier("phone-setup")
          Button(store.loading ? "Connecting…" : "Use phone setup") {
            Task { if await store.connectSetup(phoneSetup) { phoneSetup = ""; dismiss() } }
          }.disabled(store.loading || phoneSetup.isEmpty)
        } header: { Text("Quick pairing") } footer: {
          Text("On your computer, open GrokDeck Settings, start the phone connection, and copy phone setup. Paste it here within five minutes. Use the same trusted network on both devices.")
        }
        Section {
          TextField("Bridge address", text: $address).textInputAutocapitalization(.never)
            .autocorrectionDisabled().keyboardType(.URL).accessibilityIdentifier("bridge-address")
          SecureField("Pairing key", text: $token).textInputAutocapitalization(.never)
            .autocorrectionDisabled().privacySensitive().accessibilityIdentifier("pairing-key")
          TextField("Certificate SHA-256 (private LAN)", text: $fingerprint)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .accessibilityIdentifier("certificate-fingerprint")
          Button(store.loading ? "Connecting…" : "Connect") {
            Task {
              if await store.connect(
                address: address, token: token.trimmingCharacters(in: .whitespacesAndNewlines),
                certificateFingerprint: fingerprint)
              {
                token = ""
                dismiss()
              }
            }
          }.disabled(store.loading || token.isEmpty)
        } header: {
          Text("Manual connection")
        } footer: {
          Text(
              "For private Wi-Fi, enter the HTTPS address and certificate SHA-256 shown by your Mac’s LAN bridge. Leave the fingerprint empty only for a normally trusted HTTPS server or simulator loopback. Pairing keys stay in this device’s Keychain."
          )
        }
        if let error = store.error { Section { Text(error).foregroundStyle(.orange) } }
        Section("Appearance") {
          Picker("Theme", selection: $appearance) {
            Text("System").tag("system")
            Text("Dark").tag("dark")
            Text("Light").tag("light")
          }
        }
        Section {
          Link(destination: URL(string: "https://ronmillar.com")!) {
            HStack {
              Text("GrokDeck by Ron Millar 2026")
              Spacer()
              Image(systemName: "arrow.up.right").font(.caption2)
            }.font(.footnote).foregroundStyle(.secondary)
          }.accessibilityIdentifier("designer-credit")
        }
        Section("Connection limits") {
          Text(
            "A live Mac bridge enables messaging and recent reply updates. A cache-only bridge supports browsing and draft sharing. Approvals still happen in Grok Bot."
          )
          Text(
            "Conversation links are experimental on iOS. Sharing a draft lets you choose Grok Bot and the destination chat yourself."
          )
        }
        if store.isPaired {
          Section {
            Button("Forget pairing on this device", role: .destructive) {
              store.disconnect()
              dismiss()
            }
          }
        }
      }.navigationTitle("Settings").navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") {
              token = ""
              phoneSetup = ""
              dismiss()
            }.accessibilityIdentifier("close-settings")
          }
        }
        .onAppear { address = store.endpoint; fingerprint = store.certificateFingerprint }
    }
  }
}
struct DiscussionView: View {
  let agent: DeckAgent
  @EnvironmentObject private var store: DeckStore
  @Environment(\.scenePhase) private var scenePhase
  @State private var messages: [DeckMessage] = []
  @State private var error: String?
  @State private var loading = false
  @State private var query = ""
  @State private var showingSearch = false
  @State private var draft = ""
  @State private var showingDraft = false
  @State private var handoffMessage: String?
  @State private var stopping = false
  @State private var stopMessage: String?
  @State private var didScrollToLatest = false
  @State private var jumpToLatest = 0
  @State private var selectedReply: MessageReply?
  @FocusState private var composerFocused: Bool
  private let quickEmoji = ["🙂", "👍", "❤️", "🎉", "🤔", "👀"]
  private var pending: PendingPrompt? { store.pendingPrompts[agent.id] }
  private var filtered: [DeckMessage] {
    messages.filter { query.isEmpty || $0.content.localizedCaseInsensitiveContains(query) }
  }
  var body: some View {
    ScrollViewReader { scroll in
    List {
      Section {
        Label(
          store.exampleMode ? (store.isLive ? "Example live discussion" : "Example discussion") : (store.isLive ? "Live discussion through your Mac" : "Cached discussion from your Mac"),
          systemImage: store.isLive ? "network" : "clock"
        ).font(.caption).foregroundStyle(.secondary)
        Text(store.isLive ? "Replies update while this conversation is open. Approvals happen in Grok Bot." : "Sending and approvals happen in Grok Bot.").font(.caption2).foregroundStyle(
          .secondary)
      }
      if let error {
        Section {
          Text(error).foregroundStyle(.orange)
          Button("Try again") { Task { await load() } }
        }
      }
      if loading && messages.isEmpty { ProgressView("Loading discussion…") }
      if let stopMessage { Section { Text(stopMessage).font(.caption).foregroundStyle(.secondary) } }
      ForEach(filtered) { message in messageRow(message) }
      if !loading && messages.isEmpty && error == nil {
        ContentUnavailableView(
          store.isLive ? "No recent messages" : "No discussion cached", systemImage: "text.bubble",
          description: Text(store.isLive ? "Send a message to start this conversation." : "Open this conversation in Grok Bot on your Mac, then refresh."))
      }
      Color.clear.frame(height: 1).listRowSeparator(.hidden).id("discussion-bottom")
    }
    .onChange(of: messages.last?.id) { _, latest in
      guard latest != nil, !didScrollToLatest else { return }
      didScrollToLatest = true
      Task { @MainActor in
        await Task.yield()
        scroll.scrollTo("discussion-bottom", anchor: .bottom)
      }
    }
    .onChange(of: jumpToLatest) { _, _ in scroll.scrollTo("discussion-bottom", anchor: .bottom) }
    }
    .navigationTitle(agent.name).navigationBarTitleDisplayMode(.inline)
    .safeAreaInset(edge: .top) {
      if showingSearch {
        DeckSearchField(text: $query, prompt: "Find in this discussion", identifier: "discussion-search-field") {
          showingSearch = false; query = ""
        }
      }
    }
    .refreshable { await load() }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Search discussion", systemImage: "magnifyingglass") { showingSearch.toggle(); if !showingSearch { query = "" } }
          .labelStyle(.iconOnly)
      }
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Button("Open in Grok Bot", systemImage: "arrow.up.right.square") { openGrokBot() }
          Button("Draft and share", systemImage: "square.and.arrow.up") { showingDraft = true }
          Button("Jump to latest", systemImage: "arrow.down.to.line") { jumpToLatest += 1 }
          if store.liveEnabled {
            Button("Stop current run", systemImage: "stop.circle") { Task { await stop() } }
              .disabled(stopping)
          }
        } label: {
          Image(systemName: "ellipsis.circle")
        }.accessibilityLabel("Discussion actions")
      }
    }
    .safeAreaInset(edge: .bottom) {
      if store.isLive {
        liveComposer
      } else { VStack(alignment: .leading, spacing: 8) {
        replyStrip
        if selectedReply != nil { Text("This cached reply is a draft. Share it in Grok Bot to send.").font(.caption).foregroundStyle(.secondary) }
        Button {
        showingDraft = true
      } label: {
        Label("Draft a follow-up", systemImage: "square.and.pencil").frame(maxWidth: .infinity)
      }.buttonStyle(.borderedProminent)
      }.padding().background(.bar) }
    }
    .sheet(isPresented: $showingDraft) {
      NavigationStack {
        Form {
          if let selectedReply {
            Section("Replying to \(selectedReply.author)") { Text(selectedReply.excerpt).font(.callout).foregroundStyle(.secondary) }
          }
          Section("For \(agent.name)") {
            TextEditor(text: $draft).frame(minHeight: 180).accessibilityIdentifier(
              "follow-up-draft")
          }
          Section {
            ShareLink(item: selectedReply?.sharedDraft(draft) ?? draft) { Label("Share draft", systemImage: "square.and.arrow.up") }
              .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
          Section {
            Text(
              "Choose Grok Bot in the share sheet, pick the conversation, then review and send there. This app does not send automatically."
            ).font(.caption).foregroundStyle(.secondary)
          }
        }.navigationTitle("Follow-up draft").navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { showingDraft = false } }
          }
      }
    }
    .alert(
      "Grok Bot handoff",
      isPresented: Binding(get: { handoffMessage != nil }, set: { if !$0 { handoffMessage = nil } })
    ) {
      Button("OK") { handoffMessage = nil }
    } message: {
      Text(handoffMessage ?? "")
    }
    .task(id: agent.id) {
      didScrollToLatest = false
      if let pending, pending.blocksNewSend, draft.isEmpty { draft = pending.prompt }
      await load()
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(2)) } catch { return }
        if scenePhase == .active && store.isLive { await load() }
      }
    }
  }
  private var liveComposer: some View {
    VStack(alignment: .leading, spacing: 8) {
      replyStrip
      if let pending {
        switch pending.state {
        case .sending: Label("Sending…", systemImage: "arrow.up.circle").font(.caption)
        case .accepted: Text("Message accepted. Watching for reply updates.").font(.caption).foregroundStyle(.secondary)
        case .rejected: Text("Message rejected. Review your draft before trying again.").font(.caption).foregroundStyle(.orange)
        case .unknown:
          Text("Send not confirmed. Check status before sending again.").font(.caption).foregroundStyle(.orange)
          Button("Check send status") { Task {
            await store.acceptance(agent)
            clearAcceptedDraft()
            await load()
          } }.disabled(store.busyAgents.contains(agent.id))
        }
      }
      if !store.liveEnabled { Text("Live messaging is disconnected. Reconnect your Mac before sending.").font(.caption).foregroundStyle(.orange) }
      HStack(spacing: 0) {
        ForEach(Array(quickEmoji.enumerated()), id: \.offset) { index, emoji in
          Button { draft += emoji; composerFocused = true } label: {
            Text(emoji).font(.title3).frame(maxWidth: .infinity, minHeight: 36)
          }.buttonStyle(.plain).accessibilityLabel("Insert \(emoji)")
            .accessibilityIdentifier("quick-emoji-\(index)")
            .disabled(pending?.blocksNewSend == true)
        }
      }.accessibilityElement(children: .contain).accessibilityLabel("Quick emoji replies")
      HStack(alignment: .bottom) {
        TextField("Message \(agent.name)", text: $draft, axis: .vertical)
          .lineLimit(1...4).textFieldStyle(.roundedBorder).accessibilityIdentifier("message-composer")
          .focused($composerFocused)
          .disabled(pending?.blocksNewSend == true)
        Button("Send", systemImage: "arrow.up") { Task {
          await store.send(agent, prompt: draft, replyToId: selectedReply?.id)
          clearAcceptedDraft()
          await load()
        } }.labelStyle(.iconOnly).accessibilityLabel("Send message")
          .buttonStyle(.borderedProminent)
          .disabled(!store.liveEnabled || pending?.blocksNewSend == true || store.busyAgents.contains(agent.id)
            || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.utf8.count > 64 * 1024)
      }
    }.padding().background(.bar)
  }
  private func clearAcceptedDraft() {
    if let pending, pending.state == .accepted,
      draft.trimmingCharacters(in: .whitespacesAndNewlines) == pending.prompt {
      draft = ""
      if pending.replyToId == selectedReply?.id { selectedReply = nil }
    }
  }
  private func load() async {
    guard !loading else { return }
    loading = true
    defer { loading = false }
    do {
      let response = try await store.discussion(agent)
      guard !Task.isCancelled else { return }
      messages = response.messages
      if let pending, pending.blocksNewSend, let replyId = pending.replyToId, selectedReply == nil {
        selectedReply = messages.first(where: { $0.id == replyId }).map { MessageReply(message: $0, agentName: agent.name) }
          ?? MessageReply(id: replyId, author: "Selected message", excerpt: "This message remains attached to the unconfirmed send.")
      }
      error = nil
    } catch { self.error = error.localizedDescription }
  }
  @ViewBuilder private var replyStrip: some View {
    if let selectedReply {
      HStack(alignment: .top, spacing: 10) {
        Image(systemName: "arrowshape.turn.up.left").foregroundStyle(.purple)
        VStack(alignment: .leading, spacing: 3) {
          Text("Replying to \(selectedReply.author)").font(.caption.weight(.semibold))
          Text(selectedReply.excerpt).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }
        Spacer(minLength: 0)
        Button("Cancel reply", systemImage: "xmark.circle.fill") { self.selectedReply = nil }
          .labelStyle(.iconOnly).foregroundStyle(.secondary)
          .accessibilityIdentifier("cancel-reply")
          .disabled(pending?.blocksNewSend == true)
      }.padding(10).background(.purple.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain).accessibilityIdentifier("reply-context")
    }
  }
  private func messageRow(_ message: DeckMessage) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(message.author ?? (message.role == "user" ? "You" : message.role == "assistant" ? agent.name : "Activity"))
          .font(.caption.weight(.semibold)).foregroundStyle(message.role == "user" ? .secondary : .primary)
        Spacer()
        if message.timestamp > 0 {
          Text(Date(timeIntervalSince1970: message.timestamp / 1000), style: .time)
            .font(.caption2).foregroundStyle(.tertiary)
        }
        Button("Reply", systemImage: "arrowshape.turn.up.left") { selectReply(message) }
          .font(.caption2).buttonStyle(.borderless)
          .accessibilityIdentifier("reply-to-\(message.id)")
          .disabled(pending?.blocksNewSend == true)
      }
      Text(message.content).font(.body).textSelection(.enabled)
      if message.streaming {
        Text(store.isLive ? "Reply is updating…" : "Was streaming when cached. Open Grok Bot for current state.")
          .font(.caption2).foregroundStyle(.orange)
      }
    }.padding(.vertical, 6).contextMenu {
      Button("Reply", systemImage: "arrowshape.turn.up.left") { selectReply(message) }
        .disabled(pending?.blocksNewSend == true)
    }
  }
  private func selectReply(_ message: DeckMessage) {
    guard pending?.blocksNewSend != true else { return }
    selectedReply = MessageReply(message: message, agentName: agent.name)
    showingSearch = false; query = ""
    if store.isLive { composerFocused = true }
  }
  private func stop() async {
    guard !stopping else { return }
    stopping = true
    defer { stopping = false }
    do { try await store.interrupt(agent); stopMessage = "Stop requested. Watching for updated run state." }
    catch { stopMessage = "Stop could not be confirmed. Check Grok Bot before trying again." }
  }
  private func openGrokBot() {
    guard !store.exampleMode, let url = BridgeAddress.conversation(id: agent.id),
      UIApplication.shared.canOpenURL(url)
    else {
      handoffMessage =
        "Grok Bot is not available for this link on this device. You can still prepare a draft and use the share sheet."
      return
    }
    UIApplication.shared.open(url) { success in
      Task { @MainActor in
        if !success {
          handoffMessage = "The system could not open Grok Bot. Use the share sheet instead."
        }
      }
    }
  }
}
