# Agent computers on iOS

## Evidence

Read-only static inspection of the installed Grok Bot 0.75.8 package confirms a noVNC web viewer (`vnc.html`, RFB connection and keyboard handling). The desktop viewer seeds authentication from `port_token` or `network_token` URL parameters and adds corresponding headers to requests in its isolated viewer session, including WebSocket traffic. It also handles wake-related headers, reconnects, input enablement and clipboard integration. A simple WKWebView navigation is therefore not established as sufficient.

The gateway exposes `getForeverBoxStatus`, `ensureForeverBox`, and `handBackForeverBox`. GrokDeck currently implements only status reads and deliberately omits VNC URLs and credentials from its phone response. No start, wake, handback or computer input was invoked during this investigation.

The inspected deep-link route definitions support `grokbot://app/v1/agent?id=...`. No computer-specific route or computer-opening parameter was found there. This is desktop package evidence, not proof of the installed iOS app's route behavior. GrokDeck already offers Open in Grok Bot in discussion actions, with an unavailable-link explanation.

## Implementation path

Prototype a per-agent viewer through the existing authenticated Mac bridge. Keep upstream computer credentials on the Mac; create a narrowly scoped viewer session and relay the required HTTP assets and WebSocket connection. Validate origin, account, agent, window, expiry and redirect boundaries rather than exposing an arbitrary URL proxy. Check actual viewer loading on the phone before implementing touch, keyboard and explicit control takeover. Do not automatically wake a computer or take input control merely by listing it.

First device milestone: display one already-running computer without sending input, then verify touch/keyboard against an explicitly selected test computer. Status-only and local-computer configurations may not supply a remotely usable viewer, so universal support is not promised.

Fallback: open the selected agent in Grok Bot and let the user select its computer there. Test this on iOS before claiming a working handoff. A one-tap direct-to-computer link remains unverified.
