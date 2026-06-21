// Enforce a single package manager for this repo: npm.
//
// We previously shipped both a yarn.lock and a package-lock.json, so an
// install with the "wrong" tool silently rewrote the other lockfile (or
// yarn warned about package-lock.json). CI and the release workflow both
// run `npm ci`, so npm is the source of truth. This preinstall guard
// fails fast when someone runs `yarn install` / `pnpm install`, pointing
// them at npm instead of letting a stray lockfile creep back in.

// Returns true when the install is allowed to proceed (npm or no detectable
// user-agent, e.g. tooling that does not set npm_config_user_agent).
function isAllowed(userAgent) {
  if (!userAgent) {
    return true;
  }
  const name = String(userAgent).trim().split("/")[0].toLowerCase();
  return name === "npm";
}

function detectedManager(userAgent) {
  if (!userAgent) {
    return "unknown";
  }
  return String(userAgent).trim().split("/")[0].toLowerCase();
}

function message(userAgent) {
  return (
    `\nThis repository uses npm. Detected "${detectedManager(userAgent)}" instead.\n` +
    `Run "npm install" (CI and the release workflow use "npm ci").\n`
  );
}

module.exports = { isAllowed, detectedManager, message };

// Only enforce when executed directly as the preinstall hook, not when
// imported by tests.
if (require.main === module) {
  const userAgent = process.env.npm_config_user_agent;
  if (!isAllowed(userAgent)) {
    process.stderr.write(message(userAgent));
    process.exit(1);
  }
}
