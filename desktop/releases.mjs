import { randomUUID } from "node:crypto";
const VERSION = /^\d+\.\d+\.\d+$/;
export function compareVersions(a, b) {
  if (!VERSION.test(a) || !VERSION.test(b))
    throw new Error("Unsupported version");
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}
export async function checkRelease({
  platform = process.platform,
  arch = process.arch,
  currentVersion = null,
  fetcher = fetch,
} = {}) {
  const checkedAt = Date.now();
  const unavailable = (message) => ({
    status: "unavailable",
    currentVersion,
    version: null,
    checkedAt,
    message,
  });
  if (!["darwin", "win32"].includes(platform))
    return unavailable("Release checks support macOS and Windows.");
  const current =
    typeof currentVersion === "string" && VERSION.test(currentVersion)
      ? currentVersion
      : null;
  const target =
    platform === "darwin"
      ? `darwin-${arch === "x64" ? "x64" : "arm64"}`
      : `win32-${arch === "arm64" ? "arm64" : "x64"}-user`;
  // Separate ephemeral rollout ID: never reuse Grok Bot's machine or account identity.
  const url = `https://api2.cursor.sh/updates/api/update/${target}/sand/${current || "0.0.0"}/${randomUUID()}/stable`;
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(12000),
      credentials: "omit",
      redirect: "error",
    });
    if (response.status === 204)
      return current
        ? {
            status: "current",
            currentVersion: current,
            version: null,
            checkedAt,
            message:
              "No newer release was offered by the official update feed.",
          }
        : unavailable(
            "No release was offered; the installed version is unknown.",
          );
    if (!response.ok)
      return unavailable(
        `The official update service returned HTTP ${response.status}. Try again later.`,
      );
    const raw = await response.text();
    if (raw.length > 65536) return unavailable("Unexpected update response.");
    const body = JSON.parse(raw);
    const version = platform === "darwin" ? body.name : body.version;
    if (typeof version !== "string" || !VERSION.test(version))
      return unavailable(
        "The update feed format changed. GrokDeck needs a compatibility update.",
      );
    const newer = current ? compareVersions(version, current) > 0 : true;
    return {
      status: newer ? "available" : "current",
      currentVersion: current,
      version,
      checkedAt,
      message: newer
        ? current
          ? `Grok Bot ${version} is available. Update through Grok Bot when you are ready.`
          : `The official feed offers Grok Bot ${version}. Installed version not detected.`
        : "No newer release was offered by the official update feed.",
    };
  } catch {
    return unavailable(
      "Could not check the official update service. Your local discussions remain available.",
    );
  }
}
