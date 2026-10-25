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
  @State private var settings = false
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
                Text(store.exampleMode ? "EXAMPLE DATA" : "READ-ONLY DESKTOP CACHE").font(
                  .caption2.weight(.semibold)
                ).foregroundStyle(.purple)
                HStack {
                  summary("Agents", value: store.agents.count, icon: "person.2")
                  Spacer()
                  summary(
                    "Discussions", value: store.agents.filter { $0.messageCount > 0 }.count,
                    icon: "text.bubble")
                }
                Text("Cached states are not live execution status.").font(.caption).foregroundStyle(
                  .secondary)
                if let source = store.source, source.cacheUpdatedAt > 0 {
                  Text(
                    "Host cache: \(Date(timeIntervalSince1970: source.cacheUpdatedAt / 1000).formatted(date: .abbreviated, time: .shortened))"
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
              Text("Unread or awaiting a response in the host’s cached roster.")
            }
            Section(search.isEmpty ? "Your agents" : "Search results") {
              ForEach(filtered) { agent in
                NavigationLink(value: agent) { AgentRow(agent: agent) }.accessibilityIdentifier(
                  "agent-\(agent.id)")
              }
              if filtered.isEmpty {
                Text("No matching agents in the cached roster.").foregroundStyle(.secondary)
              }
            }
          }.searchable(text: $search, prompt: "Search agents or latest results")
            .refreshable { await store.refresh() }
        }
      }
      .navigationTitle("GrokDeck")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            settings = true
          } label: {
            Image(systemName: "slider.horizontal.3")
          }.accessibilityLabel("Settings")
        }
        if store.loading { ToolbarItem(placement: .topBarLeading) { ProgressView() } }
      }
      .navigationDestination(for: DeckAgent.self) { agent in DiscussionView(agent: agent) }
      .sheet(isPresented: $settings) { ConnectionView() }
      .onChange(of: store.isPaired) { _, paired in if !paired { path.removeAll() } }
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
struct AgentRow: View {
  let agent: DeckAgent
  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Text(
        agent.name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined()
      )
      .font(.caption.weight(.semibold)).foregroundStyle(.purple).frame(width: 38, height: 38)
      .background(.purple.opacity(0.12), in: RoundedRectangle(cornerRadius: 11))
      VStack(alignment: .leading, spacing: 5) {
        HStack {
          Text(agent.name).font(.headline)
          if agent.hasUnread {
            Circle().fill(.blue).frame(width: 6, height: 6).accessibilityLabel("Cached unread")
          }
        }
        Text(agent.preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
        Text("\(agent.section) · \(agent.messageCount) cached entries").font(.caption2)
          .foregroundStyle(.tertiary)
        if agent.awaitingResponse {
          Text("Response requested · cached").font(.caption).foregroundStyle(.orange)
        }
      }
    }.padding(.vertical, 5)
  }
}
struct ConnectionView: View {
  @EnvironmentObject private var store: DeckStore
  @Environment(\.dismiss) private var dismiss
  @AppStorage("appearance") private var appearance = "system"
  @State private var address = ""
  @State private var token = ""
  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Bridge address", text: $address).textInputAutocapitalization(.never)
            .autocorrectionDisabled().keyboardType(.URL).accessibilityIdentifier("bridge-address")
          SecureField("Pairing key", text: $token).textInputAutocapitalization(.never)
            .autocorrectionDisabled().privacySensitive().accessibilityIdentifier("pairing-key")
          Button(store.loading ? "Connecting…" : "Connect") {
            Task {
              if await store.connect(
                address: address, token: token.trimmingCharacters(in: .whitespacesAndNewlines))
              {
                token = ""
                dismiss()
              }
            }
          }.disabled(store.loading || token.isEmpty)
        } header: {
          Text("Your Mac bridge")
        } footer: {
          Text(
            "The default loopback address works in the simulator only. A physical iPhone needs a reachable private HTTPS bridge. Pairing keys stay in this device’s Keychain. No Grok Bot password is needed."
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
        Section("Connection limits") {
          Text(
            "This prototype reads cached discussions through your Mac. It does not send messages, approve actions, retrieve uncached history, or show live execution status."
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
              dismiss()
            }.accessibilityIdentifier("close-settings")
          }
        }
        .onAppear { address = store.endpoint }
    }
  }
}
struct DiscussionView: View {
  let agent: DeckAgent
  @EnvironmentObject private var store: DeckStore
  @State private var messages: [DeckMessage] = []
  @State private var error: String?
  @State private var loading = false
  @State private var query = ""
  @State private var draft = ""
  @State private var showingDraft = false
  @State private var handoffMessage: String?
  private var filtered: [DeckMessage] {
    messages.filter { query.isEmpty || $0.content.localizedCaseInsensitiveContains(query) }
  }
  var body: some View {
    List {
      Section {
        Label(
          store.exampleMode ? "Example discussion" : "Cached discussion from your Mac",
          systemImage: "clock"
        ).font(.caption).foregroundStyle(.secondary)
        Text("Sending and approvals happen in Grok Bot.").font(.caption2).foregroundStyle(
          .secondary)
      }
      if let error {
        Section {
          Text(error).foregroundStyle(.orange)
          Button("Try again") { Task { await load() } }
        }
      }
      if loading { ProgressView("Loading discussion…") }
      ForEach(filtered) { message in
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            Text(
              message.author
                ?? (message.role == "user"
                  ? "You" : message.role == "assistant" ? agent.name : "Activity")
            ).font(.caption.weight(.semibold)).foregroundStyle(
              message.role == "user" ? .secondary : .primary)
            Spacer()
            if message.timestamp > 0 {
              Text(Date(timeIntervalSince1970: message.timestamp / 1000), style: .time).font(
                .caption2
              ).foregroundStyle(.tertiary)
            }
          }
          Text(message.content).font(.body).textSelection(.enabled)
          if message.streaming {
            Text("Was streaming when cached. Open Grok Bot for current state.").font(.caption2)
              .foregroundStyle(.orange)
          }
        }.padding(.vertical, 6)
      }
      if !loading && messages.isEmpty && error == nil {
        ContentUnavailableView(
          "No discussion cached", systemImage: "text.bubble",
          description: Text("Open this conversation in Grok Bot on your Mac, then refresh."))
      }
    }
    .navigationTitle(agent.name).navigationBarTitleDisplayMode(.inline)
    .searchable(text: $query, prompt: "Find in cached discussion")
    .refreshable { await load() }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Button("Open in Grok Bot", systemImage: "arrow.up.right.square") { openGrokBot() }
          Button("Draft and share", systemImage: "square.and.arrow.up") { showingDraft = true }
        } label: {
          Image(systemName: "ellipsis.circle")
        }.accessibilityLabel("Discussion actions")
      }
    }
    .safeAreaInset(edge: .bottom) {
      Button {
        showingDraft = true
      } label: {
        Label("Draft a follow-up", systemImage: "square.and.pencil").frame(maxWidth: .infinity)
      }.buttonStyle(.borderedProminent).padding().background(.bar)
    }
    .sheet(isPresented: $showingDraft) {
      NavigationStack {
        Form {
          Section("For \(agent.name)") {
            TextEditor(text: $draft).frame(minHeight: 180).accessibilityIdentifier(
              "follow-up-draft")
          }
          Section {
            ShareLink(item: draft) { Label("Share draft", systemImage: "square.and.arrow.up") }
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
    .task(id: agent.id) { await load() }
  }
  private func load() async {
    loading = true
    defer { loading = false }
    do {
      let response = try await store.discussion(agent)
      messages = response.messages
      error = nil
    } catch { self.error = error.localizedDescription }
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
