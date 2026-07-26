// typescript-eslint drives the TS 6 JS API; the repo's own `typescript`
// is the TS 7 native port whose API it cannot load (their issue #10940).
// Give the typescript-eslint packages a private TS 6 dependency so the
// fast TS 7 `tsc --noEmit` gate and the type-aware lint coexist.
function readPackage(pkg) {
  if (pkg.name === "typescript-eslint" || pkg.name?.startsWith("@typescript-eslint/")) {
    if (pkg.peerDependencies?.typescript) delete pkg.peerDependencies.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: "~6.0.3" };
  }
  return pkg;
}
module.exports = { hooks: { readPackage } };
