// Only explicitly reviewed versions may use the private live protocol.
export const VERIFIED_VERSION='0.75.0';
export const REVIEWED_VERSIONS=Object.freeze(['0.75.0','0.75.8']);
export const supportsLiveVersion=version=>REVIEWED_VERSIONS.includes(version);
export function compatibilityWarning(version) {
  if(!version)return 'Grok Bot version could not be detected. Live compatibility is unknown.';
  if(supportsLiveVersion(version))return null;
  return `Grok Bot ${version} differs from tested version ${VERIFIED_VERSION} and has not been reviewed. Update GrokDeck before using live commands. Cached history remains available.`;
}
