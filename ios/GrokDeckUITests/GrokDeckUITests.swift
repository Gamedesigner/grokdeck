import XCTest

final class GrokDeckUITests: XCTestCase {
  @MainActor func testCachedDiscussionAndDraftSharingInterface() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--ui-testing"]
    app.launch()
    XCTAssertTrue(app.staticTexts["EXAMPLE DATA"].waitForExistence(timeout: 10))
    app.buttons["agent-example-agent"].tap()
    XCTAssertTrue(
      app.staticTexts[
        "This is example data for interface testing. Real discussions are read through your paired Mac bridge."
      ].waitForExistence(timeout: 10))
    app.buttons["reply-to-example-2"].tap()
    XCTAssertTrue(app.staticTexts["This cached reply is a draft. Share it in Grok Bot to send."].exists)
    app.buttons["cancel-reply"].tap()
    app.buttons["Draft a follow-up"].tap()
    let editor = app.textViews["follow-up-draft"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.tap()
    editor.typeText("Explore this idea")
    XCTAssertTrue(app.buttons["Share draft"].isEnabled)
  }
  @MainActor func testConnectionSettingsExplainSimulatorAndPhysicalPhoneBoundary() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--ui-testing"]
    app.launch()
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.staticTexts["1. Sign in to Grok Bot on your Mac or Windows PC."].waitForExistence(timeout: 5))
    // The setup walkthrough precedes manual pairing. SwiftUI Form lazily
    // creates offscreen rows, so reach them as a user would on a small phone.
    let address = app.textFields["bridge-address"]
    for _ in 0..<6 {
      if address.exists && address.isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(address.exists && address.isHittable)
    for _ in 0..<3 {
      if app.buttons["Connect"].exists && app.buttons["Connect"].isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(app.secureTextFields["pairing-key"].exists)
    XCTAssertTrue(app.buttons["Connect"].exists)
  }
  @MainActor func testUnavailableHandoffOffersSharingInstead() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--ui-testing"]
    app.launch()
    app.buttons["agent-example-agent"].tap()
    app.buttons["Discussion actions"].tap()
    app.buttons["Open in Grok Bot"].tap()
    XCTAssertTrue(app.alerts["Grok Bot handoff"].waitForExistence(timeout: 5))
    XCTAssertTrue(
      app.alerts.staticTexts[
        "Grok Bot is not available for this link on this device. You can still prepare a draft and use the share sheet."
      ].exists)
  }
  @MainActor func testLiveComposerSendsOnlyAfterExplicitTap() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--ui-testing", "--ui-testing-live"]
    app.launch()
    XCTAssertTrue(app.staticTexts["EXAMPLE LIVE DATA"].waitForExistence(timeout: 10))
    app.buttons["agent-example-agent"].tap()
    let composer = app.descendants(matching: .any).matching(identifier: "message-composer").firstMatch
    XCTAssertTrue(composer.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["Send message"].isEnabled)
    composer.tap(); composer.typeText("A test message")
    XCTAssertTrue(app.buttons["Send message"].isEnabled)
    XCTAssertFalse(app.staticTexts["Message accepted. Watching for reply updates."].exists)
    app.buttons["Send message"].tap()
    XCTAssertTrue(app.staticTexts["Message accepted. Watching for reply updates."].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["Send message"].isEnabled)
  }
  @MainActor func testUnknownSendLocksDraftUntilStatusCheckWithoutResending() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--ui-testing", "--ui-testing-live", "--ui-testing-send-unknown"]
    app.launch()
    app.buttons["agent-example-agent"].tap()
    app.buttons["reply-to-example-2"].tap()
    let composer = app.descendants(matching: .any).matching(identifier: "message-composer").firstMatch
    XCTAssertTrue(composer.waitForExistence(timeout: 5))
    composer.tap(); composer.typeText("Keep this original draft")
    app.buttons["Send message"].tap()
    XCTAssertTrue(app.buttons["Check send status"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Send not confirmed. Check status before sending again."].exists)
    XCTAssertFalse(app.buttons["Send message"].isEnabled)
    XCTAssertFalse(app.buttons["cancel-reply"].isEnabled)
    app.buttons["Check send status"].tap()
    XCTAssertTrue(app.staticTexts["Message accepted. Watching for reply updates."].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["Send message"].isEnabled)
    XCTAssertFalse(app.buttons["cancel-reply"].exists)
  }
  @MainActor func testOpeningConversationStartsAtLatestMessage() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--ui-testing", "--ui-testing-live", "--ui-testing-long-discussion"]
    app.launch()
    app.buttons["agent-example-agent"].tap()
    let latest = app.staticTexts["Latest example message"]
    XCTAssertTrue(latest.waitForExistence(timeout: 10))
    XCTAssertTrue(latest.isHittable)
    XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Earlier example message 0.")).firstMatch.isHittable)
  }
  @MainActor func testSearchExpandsAtTopOnlyWhenItsIconIsTapped() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--ui-testing", "--ui-testing-live"]
    app.launch()
    XCTAssertFalse(app.textFields["agent-search-field"].exists)
    app.buttons["Search agents"].tap()
    let agentsSearch = app.textFields["agent-search-field"]
    XCTAssertTrue(agentsSearch.waitForExistence(timeout: 5))
    agentsSearch.typeText("Research")
    app.buttons["Close search"].tap()
    app.buttons["agent-example-agent"].tap()
    XCTAssertFalse(app.textFields["discussion-search-field"].exists)
    app.buttons["Search discussion"].tap()
    XCTAssertTrue(app.textFields["discussion-search-field"].waitForExistence(timeout: 5))
    app.textFields["discussion-search-field"].typeText("example")
    app.buttons["Close search"].tap()
    XCTAssertFalse(app.textFields["discussion-search-field"].exists)
    XCTAssertTrue(app.buttons["quick-emoji-0"].exists)
  }
  @MainActor func testEmojiMessageRenderingQuickInsertionAndReplyComposer() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--ui-testing", "--ui-testing-live", "--ui-testing-emoji"]
    app.launch()
    app.buttons["agent-example-agent"].tap()
    XCTAssertTrue(app.staticTexts["Emoji render check: 🙂 👍 ❤️ 🎉 🤔 👀"].waitForExistence(timeout: 5))
    app.buttons["reply-to-example-emoji"].tap()
    XCTAssertTrue(app.staticTexts["Replying to Research desk"].exists)
    app.buttons["quick-emoji-0"].tap()
    app.buttons["quick-emoji-2"].tap()
    let composer = app.descendants(matching: .any).matching(identifier: "message-composer").firstMatch
    XCTAssertEqual(composer.value as? String, "🙂❤️")
    app.buttons["Send message"].tap()
    XCTAssertTrue(app.staticTexts["Message accepted. Watching for reply updates."].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["cancel-reply"].exists)
  }
  @MainActor func testComputersListKeepsPartialNoticeInRunningFilter() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--ui-testing", "--ui-testing-live"]
    app.launch()
    app.buttons["Computers"].tap()
    let notice = app.staticTexts["Some computer statuses could not be checked. Refresh to try again."]
    XCTAssertTrue(notice.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Research browser"].exists)
    app.segmentedControls["computer-filter"].buttons["Running"].tap()
    XCTAssertTrue(notice.exists)
    XCTAssertFalse(app.staticTexts["Hibernated"].exists)
    app.buttons["Open conversation"].tap()
    XCTAssertTrue(app.buttons["Send message"].waitForExistence(timeout: 5))
  }

}
