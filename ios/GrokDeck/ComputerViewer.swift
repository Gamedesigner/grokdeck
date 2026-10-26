import SwiftUI
import WebKit
import Combine

private struct ViewerOpened: Decodable, Sendable { let apiVersion: Int; let id: String }
private struct ViewerExchange: Codable, Sendable { let sequence: Int; let data: String }
private struct ViewerReply: Decodable, Sendable { let apiVersion: Int; let sequence: Int; let data: String; let closed: Bool }
private struct ViewerClosed: Decodable, Sendable { let apiVersion: Int }
private struct ViewerWindow: Encodable, Sendable { let window: Int?; func encode(to encoder: Encoder) throws { var c = encoder.container(keyedBy: Key.self); if let window { try c.encode(window, forKey: .window) } else { try c.encodeNil(forKey: .window) } }; enum Key: String, CodingKey { case window } }

@MainActor final class ComputerViewerModel: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate {
  @Published var status = "Connecting to computer…"
  @Published var connected = false
  @Published var failed = false
  @Published var control = false
  private let client: BridgeClient
  private let agentID: String
  private let windowIndex: Int?
  private var sessionID: String?
  private var pending = Data()
  private var task: Task<Void, Never>?
  private var stopped = false
  private var started = false
  private var startupTimeout: Task<Void, Never>?
  private(set) var webView: WKWebView!
  init(client: BridgeClient, agentID: String, window: Int?) {
    self.client = client; self.agentID = agentID; self.windowIndex = window
    super.init()
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.userContentController.add(self, name: "viewer")
    webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = self
    webView.isOpaque = false
    webView.scrollView.isScrollEnabled = false
    guard let url = Bundle.main.url(forResource: "viewer", withExtension: "html", subdirectory: "Viewer") else { fail(); return }
    webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    startupTimeout = Task { [weak self] in
      try? await Task.sleep(for: .seconds(20))
      guard !Task.isCancelled, let self, !self.started, !self.stopped else { return }
      self.fail()
    }
  }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard !stopped, message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true,
      let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
    switch kind {
    case "ready": start()
    case "send":
      guard let value = body["data"] as? String, value.count <= 128 * 1024, let bytes = Data(base64Encoded: value), pending.count + bytes.count <= 96 * 1024 else { fail(); return }
      pending.append(bytes)
    case "connected": connected = true; setControl(true)
    case "disconnected", "failed": fail()
    case "close": break
    default: break
    }
  }
  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail() }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail() }
  private func start() {
    guard !started else { return }; started = true; startupTimeout?.cancel()
    task = Task {
      do {
        let opened = try await client.post("v1/agents/\(agentID)/viewer", body: ViewerWindow(window: windowIndex), as: ViewerOpened.self)
        guard opened.apiVersion == 1, opened.id.range(of: "^[A-Za-z0-9_-]{32}$", options: .regularExpression) != nil else { throw BridgeError.invalidResponse }
        sessionID = opened.id
        guard !Task.isCancelled else { stop(); return }
        _ = try await webView.evaluateJavaScript("deckStart()")
        var sequence = 0
        let deadline = Date().addingTimeInterval(20)
        while !Task.isCancelled {
          if !connected && Date() > deadline { throw BridgeError.unavailable }
          let outgoing = pending; pending.removeAll(keepingCapacity: true)
          let reply = try await client.post("v1/viewers/\(opened.id)/exchange", body: ViewerExchange(sequence: sequence, data: outgoing.base64EncodedString()), as: ViewerReply.self)
          guard reply.apiVersion == 1, reply.sequence == sequence, reply.data.count <= 3 * 1024 * 1024,
            Data(base64Encoded: reply.data) != nil else { throw BridgeError.invalidResponse }
          if !reply.data.isEmpty {
            _ = try await webView.callAsyncJavaScript("window.deckReceive(data)", arguments: ["data": reply.data], in: nil, contentWorld: .page)
          }
          if reply.closed { throw BridgeError.unavailable }
          sequence += 1
          try await Task.sleep(for: .milliseconds(80))
        }
      } catch { if !stopped { fail() } }
    }
  }
  func setControl(_ value: Bool) {
    control = value && connected
    status = control ? "Control on · taps and keys go to this computer" : "Viewing live · controls off"
    webView.evaluateJavaScript("deckControl(\(control ? "true" : "false"))", completionHandler: nil)
  }
  func sendText(_ value: String) {
    guard control, value.utf8.count <= 4096 else { return }
    Task { _ = try? await webView.callAsyncJavaScript("window.deckText(text)", arguments: ["text": value], in: nil, contentWorld: .page) }
  }
  func sendKey(_ value: Int) { guard control else { return }; webView.evaluateJavaScript("deckKey(\(value))", completionHandler: nil) }
  private func fail() { failed = true; connected = false; status = "Couldn’t connect to this computer. Try opening it in Grok Bot."; stop() }
  func stop() {
    startupTimeout?.cancel(); startupTimeout = nil
    stopped = true; connected = false; control = false; task?.cancel(); task = nil
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "viewer")
    webView?.evaluateJavaScript("window.deckStop?.()", completionHandler: nil)
    if let id = sessionID { sessionID = nil; let client = client; Task { _ = try? await client.post("v1/viewers/\(id)/close", body: [String: String](), as: ViewerClosed.self) } }
  }
}

private struct ComputerWebView: UIViewRepresentable {
  let model: ComputerViewerModel
  func makeUIView(context: Context) -> WKWebView { model.webView }
  func updateUIView(_ uiView: WKWebView, context: Context) {}
}
struct ComputerViewer: View {
  let name: String
  let agentID: String
  @StateObject private var model: ComputerViewerModel
  @Environment(\.dismiss) private var dismiss
  @Environment(\.scenePhase) private var scenePhase
  @State private var expanded = true
  @State private var text = ""
  @State private var typing = false
  @State private var handoffFailed = false
  init(client: BridgeClient, agentID: String, name: String, window: Int? = nil) {
    self.name = name; self.agentID = agentID
    _model = StateObject(wrappedValue: ComputerViewerModel(client: client, agentID: agentID, window: window))
  }
  var body: some View {
    VStack(spacing: 0) {
      if !expanded || !model.connected { Text(model.status).font(.caption).padding(10).frame(maxWidth: .infinity).accessibilityIdentifier("viewer-status") }
      ComputerWebView(model: model).accessibilityIdentifier("computer-screen")
      if model.connected && !expanded {
        HStack {
          Toggle("Control", isOn: Binding(get: { model.control }, set: { value in model.setControl(value) })).fixedSize()
          Spacer()
          Button("Keyboard", systemImage: "keyboard") { typing = true }.disabled(!model.control)
        }.padding()
      }
      if !expanded || model.failed { Button("Open in Grok Bot", systemImage: "arrow.up.right.square") { openGrokBot() }.padding() }
    }
    .background(Color.black)
    .ignoresSafeArea(expanded ? .container : [], edges: .all)
    .overlay(alignment: .topTrailing) {
      if expanded {
        HStack(spacing: 16) {
          if model.connected {
            Button { model.setControl(!model.control) } label: { Image(systemName: model.control ? "hand.tap.fill" : "hand.tap") }
              .accessibilityLabel(model.control ? "Turn control off" : "Turn control on")
            Button { typing = true } label: { Image(systemName: "keyboard") }.disabled(!model.control).accessibilityLabel("Computer keyboard")
          }
          Button { expanded = false } label: { Image(systemName: "arrow.down.right.and.arrow.up.left") }.accessibilityLabel("Exit full screen")
          Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("Close computer")
        }.font(.title3).padding(14).background(.ultraThinMaterial, in: Capsule()).padding()
      }
    }
    .navigationTitle(name).navigationBarTitleDisplayMode(.inline)
    .toolbar(expanded ? .hidden : .visible, for: .navigationBar)
    .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Full screen", systemImage: "arrow.up.left.and.arrow.down.right") { expanded = true } }; ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    .onDisappear { model.stop() }
    .onChange(of: scenePhase) { _, phase in if phase == .background { model.stop(); dismiss() } }
    .alert("Grok Bot unavailable", isPresented: $handoffFailed) { Button("OK") {} } message: { Text("Install and sign in to Grok Bot on this iPhone, then open this agent’s computer there.") }
    .sheet(isPresented: $typing) {
      NavigationStack {
        Form {
          TextField("Text to type on computer", text: $text, axis: .vertical).lineLimit(2...6).autocorrectionDisabled().textInputAutocapitalization(.never)
          Button("Type text") { model.sendText(text); text = "" }.disabled(text.isEmpty || text.utf8.count > 4096)
          HStack { Button("Return") { model.sendKey(0xff0d) }; Spacer(); Button("Tab") { model.sendKey(0xff09) }; Spacer(); Button("Escape") { model.sendKey(0xff1b) } }
        }.navigationTitle("Computer keyboard").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { typing = false } } }
      }.presentationDetents([.medium])
    }
  }
  private func openGrokBot() {
    guard let url = BridgeAddress.conversation(id: agentID), UIApplication.shared.canOpenURL(url) else { handoffFailed = true; return }
    UIApplication.shared.open(url) { success in if !success { Task { @MainActor in handoffFailed = true } } }
  }
}
