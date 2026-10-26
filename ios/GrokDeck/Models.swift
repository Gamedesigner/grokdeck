import Foundation
import CryptoKit
import Security

struct DeckAgent: Identifiable, Codable, Hashable, Sendable {
  let id: String
  let name: String
  let description: String
  let section: String
  let hasUnread: Bool
  let awaitingResponse: Bool
  let lastActivityAt: Double
  let preview: String
  let messageCount: Int
  let cachedAt: Double
}
struct DeckMessage: Identifiable, Codable, Sendable {
  let id: String
  let role: String
  let author: String?
  let content: String
  let timestamp: Double
  let type: String
  let streaming: Bool
}
struct CacheSource: Codable, Sendable {
  let kind: String
  let available: Bool
  let checkedAt: Double
  let version: String?
  let cacheUpdatedAt: Double
  let warning: String?
}
struct AgentResponse: Codable, Sendable {
  let apiVersion: Int
  let agents: [DeckAgent]
  let source: CacheSource
  let warnings: [String]
}
struct DiscussionResponse: Codable, Sendable {
  let apiVersion: Int
  let agentId: String
  let name: String
  let cachedAt: Double
  let messages: [DeckMessage]
  let source: CacheSource
}
struct BridgeHealth: Codable, Sendable {
  let apiVersion: Int
  let readOnly: Bool
  let live: Bool?
  var canSend: Bool { apiVersion == 1 && live == true && !readOnly }
}
struct BridgeSendReceipt: Codable, Sendable {
  let apiVersion: Int
  let clientNonce: String
  let accepted: Bool?
  let status: String
  var state: PromptState {
    if status == "accepted" && accepted == true { return .accepted }
    if status == "rejected" && accepted == false { return .rejected }
    return .unknown
  }
}
enum PromptState: Sendable { case sending, accepted, unknown, rejected }
struct PendingPrompt: Sendable {
  let clientNonce: String
  let prompt: String
  var state: PromptState
  var replyToId: String? = nil
  var blocksNewSend: Bool { state == .sending || state == .unknown }
}
struct MessageReply: Identifiable, Sendable {
  let id: String
  let author: String
  let excerpt: String
  init(message: DeckMessage, agentName: String) {
    id = message.id
    author = message.author ?? (message.role == "user" ? "You" : message.role == "assistant" ? agentName : "Activity")
    excerpt = String(message.content.split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(180))
  }
  init(id: String, author: String, excerpt: String) {
    self.id = id; self.author = author; self.excerpt = excerpt
  }
  func sharedDraft(_ text: String) -> String { "Replying to \(author):\n> \(excerpt)\n\n\(text)" }
}
struct SendPromptBody: Encodable, Sendable {
  let prompt: String
  let clientNonce: String
  var replyToId: String? = nil
}
struct EmptyBridgeBody: Encodable, Sendable {}
struct InterruptResponse: Decodable, Sendable { let apiVersion: Int }
struct AvatarPayload: Decodable, Sendable {
  let apiVersion: Int
  let mimeType: String
  let dataBase64: String
  func imageData() -> Data? {
    guard apiVersion == 1, ["image/png", "image/jpeg", "image/webp"].contains(mimeType),
      dataBase64.utf8.count <= 3 * 1024 * 1024,
      let data = Data(base64Encoded: dataBase64), !data.isEmpty, data.count <= 2 * 1024 * 1024
    else { return nil }
    let bytes = [UInt8](data.prefix(12))
    switch mimeType {
    case "image/png": guard bytes.starts(with: [137, 80, 78, 71, 13, 10, 26, 10]) else { return nil }
    case "image/jpeg": guard bytes.starts(with: [255, 216, 255]) else { return nil }
    case "image/webp":
      guard bytes.count >= 12, Array(bytes[0..<4]) == [82, 73, 70, 70], Array(bytes[8..<12]) == [87, 69, 66, 80] else { return nil }
    default: return nil
    }
    return data
  }
}
enum ComputerState: String, Codable, Sendable { case absent, hibernated, running, unknown }
struct ComputerWindow: Codable, Identifiable, Sendable {
  let index: Int
  let label: String
  var id: Int { index }
}
struct DeckComputer: Codable, Identifiable, Sendable {
  let agentId: String
  let name: String
  let state: ComputerState
  let windows: [ComputerWindow]
  let checkedAt: Double
  let error: String?
  var id: String { agentId }
}
struct ComputersResponse: Codable, Sendable {
  let apiVersion: Int
  let checkedAt: Double
  let computers: [DeckComputer]
  let complete: Bool
}
enum BridgeError: LocalizedError {
  case invalidEndpoint, missingPairing, unauthorized, unavailable, unsupported, invalidResponse
  case http(Int)
  case invalidCertificatePin, untrustedBridge
  case readOnly
  var errorDescription: String? {
    switch self {
    case .invalidEndpoint:
      "Use a loopback HTTP address for the simulator, or a trusted HTTPS bridge address. Do not include a path, username, or pairing key in the URL."
    case .missingPairing: "Connect to your GrokDeck bridge in Settings first."
    case .unauthorized: "The pairing key was rejected. Check the key in Settings."
    case .unavailable:
      "The Mac bridge is unreachable. Check that it is running. Previously loaded data may be out of date."
    case .unsupported:
      "This bridge uses a different API version. Update GrokDeck before connecting."
    case .invalidResponse: "The bridge response could not be read."
    case .http(let code):
      "The bridge returned HTTP \(code). Check the host’s Grok Bot cache and try again."
    case .invalidCertificatePin:
      "Enter the Mac bridge’s complete 64-character certificate SHA-256 fingerprint. A fingerprint requires HTTPS."
    case .untrustedBridge:
      "The Mac bridge’s certificate could not be verified. Check its address and SHA-256 fingerprint in Settings."
    case .readOnly:
      "Live messaging is unavailable. Reconnect to a Mac bridge with live access enabled."
    }
  }
}
enum BridgeAddress {
  static func validate(_ input: String) throws -> URL {
    guard
      let components = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
      let scheme = components.scheme?.lowercased(), let host = components.host?.lowercased(),
      !host.isEmpty,
      components.user == nil, components.password == nil, components.query == nil,
      components.fragment == nil,
      components.path.isEmpty || components.path == "/", let url = components.url
    else { throw BridgeError.invalidEndpoint }
    let loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)
    guard scheme == "https" || (scheme == "http" && loopback) else {
      throw BridgeError.invalidEndpoint
    }
    return url
  }
  static func conversation(id: String) -> URL? {
    guard id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil else {
      return nil
    }
    var url = URLComponents()
    url.scheme = "grokbot"
    url.host = "app"
    url.path = "/v1/agent"
    url.queryItems = [URLQueryItem(name: "id", value: id)]
    return url.url
  }
}
enum BridgeCertificate {
  static func normalizedPin(_ input: String, endpoint: URL) throws -> String? {
    let pin = input.trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: ":", with: "").lowercased()
    if pin.isEmpty { return nil }
    guard endpoint.scheme?.lowercased() == "https", pin.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
      throw BridgeError.invalidCertificatePin
    }
    return pin
  }
  static func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}
struct BridgeClient: Sendable {
  let baseURL: URL
  let token: String
  var certificatePin: String? = nil
  func get<T: Decodable & Sendable>(_ path: String, as type: T.Type) async throws -> T {
    try await perform(makeRequest(path, method: "GET"), as: type)
  }
  func post<Body: Encodable & Sendable, T: Decodable & Sendable>(
    _ path: String, body: Body, as type: T.Type
  ) async throws -> T {
    try await perform(makeRequest(path, method: "POST", body: JSONEncoder().encode(body)), as: type)
  }
  func makeRequest(_ path: String, method: String, body: Data? = nil) -> URLRequest {
    var request = URLRequest(url: baseURL.appendingPathComponent(path))
    request.timeoutInterval = method == "POST" ? 30 : 12
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.httpMethod = method
    request.httpBody = body
    if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    return request
  }
  private func perform<T: Decodable & Sendable>(_ request: URLRequest, as type: T.Type) async throws -> T {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    let session = URLSession(
      configuration: configuration,
      delegate: NoRedirect(host: baseURL.host ?? "", certificatePin: certificatePin), delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    let data: Data
    let response: URLResponse
    do { (data, response) = try await session.data(for: request) } catch {
      let code = (error as NSError).code
      if certificatePin != nil && [NSURLErrorCancelled, NSURLErrorSecureConnectionFailed,
        NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateUntrusted,
        NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid].contains(code) {
        throw BridgeError.untrustedBridge
      }
      throw BridgeError.unavailable
    }
    guard let http = response as? HTTPURLResponse else { throw BridgeError.invalidResponse }
    if http.statusCode == 401 { throw BridgeError.unauthorized }
    guard (200...299).contains(http.statusCode) else { throw BridgeError.http(http.statusCode) }
    guard data.count <= 8 * 1024 * 1024 else { throw BridgeError.invalidResponse }
    do { return try JSONDecoder().decode(type, from: data) } catch {
      throw BridgeError.invalidResponse
    }
  }
}
final class NoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
  let host: String
  let certificatePin: String?
  init(host: String = "", certificatePin: String? = nil) {
    self.host = host
    self.certificatePin = certificatePin
  }
  func urlSession(
    _ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard let certificatePin else { completionHandler(.performDefaultHandling, nil); return }
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
      challenge.protectionSpace.host == host,
      let trust = challenge.protectionSpace.serverTrust,
      let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first,
      BridgeCertificate.digest(SecCertificateCopyData(leaf) as Data) == certificatePin
    else { completionHandler(.cancelAuthenticationChallenge, nil); return }
    // Trust is scoped to this exact pinned leaf. TLS signature, hostname/SAN and validity
    // are still checked; no CA is installed or general certificate validation disabled.
    guard SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, host as CFString)) == errSecSuccess,
      SecTrustSetAnchorCertificates(trust, [leaf] as CFArray) == errSecSuccess,
      SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
      SecTrustEvaluateWithError(trust, nil)
    else { completionHandler(.cancelAuthenticationChallenge, nil); return }
    completionHandler(.useCredential, URLCredential(trust: trust))
  }
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) { completionHandler(nil) }
}

struct PhoneSetup: Decodable, Sendable {
  let grokdeck: Int
  let endpoint: String
  let pin: String
  let code: String
  static func parse(_ input: String) throws -> PhoneSetup {
    guard input.utf8.count <= 2048,
      let setup = try? JSONDecoder().decode(PhoneSetup.self, from: Data(input.utf8)),
      setup.grokdeck == 1,
      setup.code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil
    else { throw BridgeError.invalidResponse }
    let url = try BridgeAddress.validate(setup.endpoint)
    let parts = (url.host ?? "").split(separator: ".", omittingEmptySubsequences: false)
    let numbers = parts.compactMap { Int($0) }
    guard url.scheme == "https", let port = url.port, (1...65535).contains(port),
      parts.count == 4, numbers.count == 4,
      zip(parts,numbers).allSatisfy({ String($0.1) == $0.0 && (0...255).contains($0.1) }),
      numbers[0] == 10 || (numbers[0] == 172 && (16...31).contains(numbers[1])) || (numbers[0] == 192 && numbers[1] == 168),
      try BridgeCertificate.normalizedPin(setup.pin, endpoint: url) != nil
    else { throw BridgeError.invalidEndpoint }
    return setup
  }
}
struct EnrollmentResponse: Decodable, Sendable { let apiVersion: Int; let token: String }
