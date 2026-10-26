import XCTest
import UIKit

@testable import GrokDeck

final class GrokDeckTests: XCTestCase {
  func testQuickPairingRequiresPrivateHTTPSPinnedEndpoint() throws {
    let valid: [String: Any] = ["grokdeck": 1, "endpoint": "https://10.0.0.3:43874", "pin": String(repeating: "a", count: 64), "code": String(repeating: "B", count: 43)]
    func text(_ data: [String: Any]) throws -> String { String(decoding: try JSONSerialization.data(withJSONObject: data), as: UTF8.self) }
    XCTAssertNoThrow(try PhoneSetup.parse(text(valid)))
    for endpoint in ["https://example.com:43874", "http://10.0.0.3:43874", "https://8.8.8.8:43874", "https://10.0.0.3:43874?secret=x", "https://10.0.0.3"] {
      var bad = valid; bad["endpoint"] = endpoint
      XCTAssertThrowsError(try PhoneSetup.parse(text(bad)))
    }
    for field in ["pin", "code"] { var bad = valid; bad[field] = ""; XCTAssertThrowsError(try PhoneSetup.parse(text(bad))) }
  }

  func testPrivatePairingEndpointPolicy() throws {
    XCTAssertEqual(try BridgeAddress.validate("https://127.0.0.1:43875").host, "127.0.0.1")
    XCTAssertThrowsError(try BridgeAddress.validate("http://127.0.0.1:43872"))
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
  func testCertificatePinIsExactAndRequiresTLS() throws {
    let endpoint = try BridgeAddress.validate("https://192.168.1.2:43873")
    XCTAssertNil(try BridgeCertificate.normalizedPin("", endpoint: endpoint))
    XCTAssertEqual(try BridgeCertificate.normalizedPin(String(repeating: "AB:", count: 31) + "AB", endpoint: endpoint), String(repeating: "ab", count: 32))
    for pin in ["bad", String(repeating: "g", count: 64), String(repeating: "a", count: 63)] {
      XCTAssertThrowsError(try BridgeCertificate.normalizedPin(pin, endpoint: endpoint))
    }
    XCTAssertThrowsError(try BridgeCertificate.normalizedPin(String(repeating: "a", count: 64), endpoint: BridgeAddress.validate("http://127.0.0.1:43872")))
    XCTAssertEqual(BridgeCertificate.digest(Data("abc".utf8)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
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
  func testLiveCapabilityRequiresExplicitConsistentHealth() throws {
    XCTAssertTrue(BridgeHealth(apiVersion: 1, readOnly: false, live: true).canSend)
    XCTAssertFalse(BridgeHealth(apiVersion: 1, readOnly: true, live: true).canSend)
    XCTAssertFalse(BridgeHealth(apiVersion: 1, readOnly: false, live: nil).canSend)
    XCTAssertFalse(BridgeHealth(apiVersion: 2, readOnly: false, live: true).canSend)
  }
  func testSendReceiptRequiresExplicitAcceptanceAndKeepsUnknownBlocked() {
    let nonce = UUID().uuidString
    XCTAssertEqual(BridgeSendReceipt(apiVersion: 1, clientNonce: nonce, accepted: true, status: "accepted").state, .accepted)
    XCTAssertEqual(BridgeSendReceipt(apiVersion: 1, clientNonce: nonce, accepted: nil, status: "unknown").state, .unknown)
    XCTAssertEqual(BridgeSendReceipt(apiVersion: 1, clientNonce: nonce, accepted: false, status: "accepted").state, .unknown)
    XCTAssertTrue(PendingPrompt(clientNonce: nonce, prompt: "Hello", state: .unknown).blocksNewSend)
    XCTAssertFalse(PendingPrompt(clientNonce: nonce, prompt: "Hello", state: .rejected).blocksNewSend)
  }
  func testSendRequestKeepsNonceAndCredentialsInTheirOwnFields() throws {
    let nonce = UUID().uuidString, token = String(repeating: "A", count: 43)
    let client = BridgeClient(baseURL: try BridgeAddress.validate("https://192.168.1.2:43873"), token: token)
    let body = try JSONEncoder().encode(SendPromptBody(prompt: "Hello", clientNonce: nonce))
    let request = client.makeRequest("v1/agents/agent-1/send", method: "POST", body: body)
    XCTAssertEqual(request.httpMethod, "POST")
    XCTAssertEqual(request.timeoutInterval, 30)
    XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(token)")
    XCTAssertNil(request.url?.query)
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: String])
    XCTAssertEqual(object, ["prompt": "Hello", "clientNonce": nonce])
    XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
  }
  func testUnicodeEmojiAndReplyTargetSurviveJSONWithoutChangingPrompt() throws {
    let emoji = "🙂👍❤️🎉🤔👀", nonce = UUID().uuidString
    let encoded = try JSONEncoder().encode(SendPromptBody(prompt: emoji, clientNonce: nonce, replyToId: "entry-123"))
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: String])
    XCTAssertEqual(object, ["prompt": emoji, "clientNonce": nonce, "replyToId": "entry-123"])
    let message = DeckMessage(id: "entry-123", role: "assistant", author: "Other bot", content: "A reply 🙂\nwith detail", timestamp: 1, type: "text", streaming: false)
    let reply = MessageReply(message: message, agentName: "Research")
    XCTAssertEqual(reply.author, "Other bot")
    XCTAssertEqual(reply.excerpt, "A reply 🙂 with detail")
    XCTAssertTrue(reply.sharedDraft(emoji).contains(emoji))
    XCTAssertEqual(PendingPrompt(clientNonce: nonce, prompt: emoji, state: .unknown, replyToId: message.id).replyToId, "entry-123")
  }
  func testAvatarPayloadAcceptsNativeImageAndRejectsOtherContent() throws {
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXQAAAAASUVORK5CYII="
    let payload = AvatarPayload(apiVersion: 1, mimeType: "image/png", dataBase64: png)
    let data = try XCTUnwrap(payload.imageData())
    XCTAssertNotNil(UIImage(data: data))
    XCTAssertNil(AvatarPayload(apiVersion: 1, mimeType: "text/html", dataBase64: png).imageData())
    XCTAssertNil(AvatarPayload(apiVersion: 1, mimeType: "image/png", dataBase64: Data("not an image".utf8).base64EncodedString()).imageData())
    XCTAssertNil(AvatarPayload(apiVersion: 2, mimeType: "image/png", dataBase64: png).imageData())
  }
  func testComputerSnapshotPreservesUnknownAndPartialState() throws {
    let json = #"{"apiVersion":1,"checkedAt":1000,"complete":false,"computers":[{"agentId":"a","name":"Research","state":"running","windows":[{"index":0,"label":"Browser"}],"checkedAt":1000},{"agentId":"b","name":"Other","state":"unknown","windows":[],"checkedAt":1000,"error":"Status unavailable"},{"agentId":"c","name":"Sleeping","state":"hibernated","windows":[],"checkedAt":1000},{"agentId":"d","name":"Empty","state":"absent","windows":[],"checkedAt":1000}]}"#
    let snapshot = try JSONDecoder().decode(ComputersResponse.self, from: Data(json.utf8))
    XCTAssertFalse(snapshot.complete)
    XCTAssertEqual(snapshot.computers.map(\.state), [.running, .unknown, .hibernated, .absent])
    XCTAssertEqual(snapshot.computers.first?.windows.first?.label, "Browser")
    XCTAssertEqual(snapshot.computers[1].error, "Status unavailable")
  }

}
