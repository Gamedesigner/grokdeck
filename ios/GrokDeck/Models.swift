import Foundation

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
enum BridgeError: LocalizedError {
  case invalidEndpoint, missingPairing, unauthorized, unavailable, unsupported, invalidResponse
  case http(Int)
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
struct BridgeClient: Sendable {
  let baseURL: URL
  let token: String
  func get<T: Decodable & Sendable>(_ path: String, as type: T.Type) async throws -> T {
    var request = URLRequest(url: baseURL.appendingPathComponent(path))
    request.timeoutInterval = 12
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    let session = URLSession(
      configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    let data: Data
    let response: URLResponse
    do { (data, response) = try await session.data(for: request) } catch {
      throw BridgeError.unavailable
    }
    guard let http = response as? HTTPURLResponse else { throw BridgeError.invalidResponse }
    if http.statusCode == 401 { throw BridgeError.unauthorized }
    guard http.statusCode == 200 else { throw BridgeError.http(http.statusCode) }
    guard data.count <= 8 * 1024 * 1024 else { throw BridgeError.invalidResponse }
    do { return try JSONDecoder().decode(type, from: data) } catch {
      throw BridgeError.invalidResponse
    }
  }
}
final class NoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
