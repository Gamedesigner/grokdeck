// Release metadata is untrusted. Only this repository's exact platform assets
// can become download candidates; no renderer-supplied URL or version is used.
const API = 'https://api.github.com/repos/Gamedesigner/grokdeck';
const DOWNLOAD = 'https://github.com/Gamedesigner/grokdeck/releases/download/';
const MAX_ASSET = 512 * 1024 * 1024;
function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) return null;
  const core = match.slice(1, 4).map(Number), pre = match[4]?.split('.') || [];
  if (core.some(n => !Number.isSafeInteger(n)) || pre.some(v => /^\d+$/.test(v) && (v.length > 1 && v[0] === '0' || !Number.isSafeInteger(Number(v))))) return null;
  return {core, pre};
}
function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) throw new Error('Invalid app version');
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return Math.sign(left.core[i] - right.core[i]);
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return Math.sign(Number(x) - Number(y));
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
function assetFor(release, name, limit = MAX_ASSET) {
  const found = release.assets.filter(a => a?.name === name);
  if (found.length !== 1) return null;
  const a = found[0];
  if (!Number.isSafeInteger(a.id) || a.id <= 0 || a.state !== 'uploaded' ||
      !Number.isSafeInteger(a.size) || a.size < 1 || a.size > limit ||
      !/^sha256:[a-f0-9]{64}$/.test(a.digest) ||
      a.url !== `${API}/releases/assets/${a.id}` ||
      a.browser_download_url !== `${DOWNLOAD}${release.tag_name}/${name}`) return null;
  return Object.freeze({id:a.id, name, size:a.size, sha256:a.digest.slice(7), url:a.url, downloadUrl:a.browser_download_url});
}
function selectRelease(releases, {currentVersion, platform, arch}) {
  const current = parseVersion(currentVersion);
  if (!current || !Array.isArray(releases) || releases.length > 100 || !['win32','darwin'].includes(platform) || !['x64','arm64'].includes(arch)) throw new Error('Unsupported update request');
  const candidates = [];
  for (const release of releases) {
    if (!release || release.draft !== false || typeof release.prerelease !== 'boolean' || !Array.isArray(release.assets) || release.assets.length > 100 ||
        typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) continue;
    const version = release.tag_name.slice(1), parsed = parseVersion(version);
    if (!parsed || (parsed.pre.length > 0) !== release.prerelease || (!current.pre.length && release.prerelease) || compareVersions(version,currentVersion) <= 0) continue;
    const name = platform === 'win32' ? `GrokDeck-${version}-win-${arch}.exe` : `GrokDeck-${version}-mac-${arch}.zip`;
    // A release for another platform is normal; malformed matching assets are
    // not evidence that this device is up to date.
    if (!release.assets.some(a=>a?.name===name)) continue;
    const asset = assetFor(release,name);
    const manifest = platform === 'darwin' ? assetFor(release,'latest-mac.yml',64*1024) : null;
    if (!asset || platform === 'darwin' && !manifest) throw new Error('Invalid platform release assets');
    candidates.push({version, tag:release.tag_name, asset, manifest, release});
  }
  candidates.sort((a,b)=>compareVersions(b.version,a.version));
  if (candidates.length > 1 && compareVersions(candidates[0].version,candidates[1].version) === 0) throw new Error('Ambiguous release');
  return candidates[0] || null;
}
function macManifest(raw, candidate) {
  const yaml = require('js-yaml');
  const info = yaml.load(raw);
  if (!info || info.version !== candidate.version || !Array.isArray(info.files) || info.files.length < 1 || info.files.length > 12 ||
      info.packages !== undefined || new Set(info.files.map(f=>f?.url)).size !== info.files.length) throw new Error('Invalid Mac update manifest');
  const allowed = new Set(['arm64','x64'].flatMap(arch=>['zip','dmg'].map(ext=>`GrokDeck-${candidate.version}-mac-${arch}.${ext}`)));
  for (const file of info.files) {
    const asset = allowed.has(file?.url) && assetFor(candidate.release,file.url);
    if (!asset || file.size !== asset.size || typeof file.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) throw new Error('Invalid Mac update file');
  }
  const chosen = info.files.find(f=>f.url===candidate.asset.name);
  const legacy = info.files.find(f=>f.url===info.path);
  if (!chosen || !legacy || legacy.sha512 !== info.sha512) throw new Error('Mac update manifest mismatch');
  if (info.minimumSystemVersion !== undefined && (typeof info.minimumSystemVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(info.minimumSystemVersion) || !parseVersion(info.minimumSystemVersion))) throw new Error('Invalid minimum system version');
  return {version:candidate.version, files:[{url:chosen.url,size:chosen.size,sha512:chosen.sha512}],path:chosen.url,sha512:chosen.sha512,
    ...(info.minimumSystemVersion===undefined?{}:{minimumSystemVersion:info.minimumSystemVersion})};
}
module.exports={API,MAX_ASSET,parseVersion,compareVersions,assetFor,selectRelease,macManifest};
