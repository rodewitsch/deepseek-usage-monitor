// standard-version updater: keeps `version` in manifest.json in sync with
// package.json. Invoked by standard-version with (contents, version) args.

module.exports.readVersion = function (contents) {
  return JSON.parse(contents).version;
};

module.exports.writeVersion = function (contents, version) {
  const manifest = JSON.parse(contents);
  // Chrome only accepts dotted numeric versions — drop any pre-release suffix
  // (e.g. "1.2.0-beta.1" → "1.2.0").
  manifest.version = String(version).split('-')[0];
  return `${JSON.stringify(manifest, null, 2)}\n`;
};
