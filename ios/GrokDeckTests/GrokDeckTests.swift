import XCTest

@testable import GrokDeck

final class GrokDeckTests: XCTestCase {
  func testPrivatePairingEndpointPolicy() throws {
    XCTAssertEqual(try BridgeAddress.validate("http://127.0.0.1:43872").host, "127.0.0.1")
    XCTAssertNoThrow(try BridgeAddress.validate("https://mini.example.ts.net"))
    for address in [
      "http://192.168.1.2:43872", "http://example.com", "file:///tmp/cache",
      "https://user:key@example.com", "https://example.com?token=secret",
      "https://example.com/private",
    ] { XCTAssertThrowsError(try BridgeAddress.validate(address)) }
  }
  func testConversationLinkCannotEscapeObservedRoute() {
    XCTAssertEqual(
      BridgeAddress.conversation(id: "agent-123")?.absoluteString,
      "grokbot://app/v1/agent?id=agent-123")
    for id in ["../private", "id&token=bad", "", "https://example.com"] {
      XCTAssertNil(BridgeAddress.conversation(id: id))
    }
  }
  func testBridgeRosterDecode() throws {
    let json =
      #"{"apiVersion":1,"agents":[{"id":"a","name":"Research","description":"Ideas","section":"Projects","hasUnread":true,"awaitingResponse":false,"lastActivityAt":1000,"preview":"Result","messageCount":1,"cachedAt":1000}],"source":{"kind":"desktop-cache","available":true,"checkedAt":1000,"version":"0.75.0","cacheUpdatedAt":1000,"warning":null},"warnings":[]}"#
    let response = try JSONDecoder().decode(AgentResponse.self, from: Data(json.utf8))
    XCTAssertEqual(response.agents.first?.name, "Research")
    XCTAssertEqual(response.source.kind, "desktop-cache")
  }
  func testForwardedAuthorSurvivesDecode() throws {
    let json =
      #"{"id":"m","role":"agent","author":"Other Agent","content":"A handoff","timestamp":1000,"type":"message","streaming":false}"#
    let message = try JSONDecoder().decode(DeckMessage.self, from: Data(json.utf8))
    XCTAssertEqual(message.author, "Other Agent")
    XCTAssertNotEqual(message.role, "user")
  }
  func testPairingKeychainRoundTrip() throws {
    let previous = PairingStore.read()
    defer { if let previous { try? PairingStore.save(previous) } else { PairingStore.clear() } }
    let testKey = String(repeating: "A", count: 43)
    try PairingStore.save(testKey)
    XCTAssertEqual(PairingStore.read(), testKey)
    PairingStore.clear()
    XCTAssertNil(PairingStore.read())
  }

}
