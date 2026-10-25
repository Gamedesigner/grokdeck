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
    XCTAssertTrue(app.textFields["bridge-address"].waitForExistence(timeout: 5))
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

}
