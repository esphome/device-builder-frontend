// typescript-eslint drives the TS 6 JS API; the repo's own `typescript`
// is the TS 7 native port whose API it cannot load:
// https://github.com/typescript-eslint/typescript-eslint/issues/10940
// Give the typescript-eslint packages a private TS 6 dependency so the
// fast TS 7 `tsc --noEmit` gate and the type-aware lint coexist.
//
// Consequences to keep in mind:
// - Lint evaluates the codebase under TS ~6.0.3 while the build and
//   the `lint` gate use the package.json `typescript` pin; a TS 7-only
//   construct can surface as an ESLint-only parse/type error.
// - The pin below is disconnected from package.json and nothing warns
//   on drift (the peer dependency is deleted on purpose).
// DELETE THIS WHOLE FILE once typescript-eslint supports the TS 7 API.
// NOTE: any edit to this file (comments included) changes the
// pnpmfileChecksum pnpm stamps into the lockfile; run `pnpm install`
// afterwards or --frozen-lockfile installs fail.
function readPackage(pkg) {
  if (pkg.name === "typescript-eslint" || pkg.name?.startsWith("@typescript-eslint/")) {
    if (pkg.peerDependencies?.typescript) delete pkg.peerDependencies.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: "~6.0.3" };
  }
  return pkg;
}
module.exports = { hooks: { readPackage } };
