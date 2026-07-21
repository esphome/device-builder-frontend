// Enforce a single package manager for this repo: pnpm.
//
// We previously shipped both a yarn.lock and a package-lock.json, so an
// install with the "wrong" tool silently rewrote the other lockfile (or
// yarn warned about package-lock.json). CI and the release workflow both
// run `pnpm install --frozen-lockfile`, so pnpm is the source of truth.
// This preinstall guard fails fast when someone runs `npm install` /
// `yarn install` (both run preinstall before touching node_modules),
// pointing them at pnpm instead of letting a stray lockfile creep back in.

// Returns true when the install is allowed to proceed (pnpm or no detectable
// user-agent, e.g. tooling that does not set npm_config_user_agent).
function isAllowed(userAgent) {
  if (!userAgent) {
    return true;
  }
  const name = String(userAgent).trim().split("/")[0].toLowerCase();
  return name === "pnpm";
}

function detectedManager(userAgent) {
  if (!userAgent) {
    return "unknown";
  }
  return String(userAgent).trim().split("/")[0].toLowerCase();
}

function message(userAgent) {
  return (
    `\nThis repository uses pnpm. Detected "${detectedManager(userAgent)}" instead.\n` +
    `Run "pnpm install" (CI and the release workflow use "pnpm install --frozen-lockfile").\n`
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
