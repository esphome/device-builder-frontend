// Fail when the modules under src/ import each other in a circle.
//
// A cycle between two modules means one of them runs while the other is
// still half evaluated, so which exports exist depends on who was imported
// first. It shows up as an undefined export at startup or as a test that
// only fails in a certain file order, far from the import that caused it.
// The platform descriptors, the install flows and the dialogs that read
// them sit close enough together that a convenient import closes a circle
// easily, so CI checks it on every PR.
//
// Only imports that exist at runtime count: `import type`, `export type`
// and a specifier list made of `type` names only are erased by the
// compiler, and a lazy `import()` does not evaluate its target while the
// importer is loading.

const fs = require("fs");
const path = require("path");

// The parser ESLint already uses on this tree, so comments, strings,
// templates and regular expressions are read as the compiler reads them
// rather than guessed at with patterns.
const { parser } = require("typescript-eslint");

const SRC_DIR = path.join(__dirname, "..", "src");
const PARSE_OPTIONS = { sourceType: "module", range: false, loc: false };

/** Whether every name in a `{ ... }` list is a `type` one, which the compiler erases. */
function isTypeOnlyList(specifiers, kindOf) {
  return specifiers.length > 0 && specifiers.every((s) => kindOf(s) === "type");
}

/** The source of a top-level statement, when it imports it at runtime. */
function runtimeSource(node) {
  if (!node.source) return undefined;
  if (node.type === "ImportDeclaration") {
    const erased =
      node.importKind === "type" ||
      isTypeOnlyList(node.specifiers, (s) =>
        s.type === "ImportSpecifier" ? s.importKind : "value"
      );
    return erased ? undefined : node.source.value;
  }
  if (node.type === "ExportAllDeclaration") {
    return node.exportKind === "type" ? undefined : node.source.value;
  }
  if (node.type === "ExportNamedDeclaration") {
    const erased =
      node.exportKind === "type" || isTypeOnlyList(node.specifiers, (s) => s.exportKind);
    return erased ? undefined : node.source.value;
  }
  return undefined;
}

/**
 * The relative sources a module imports at runtime. Static imports and
 * re-exports are top-level statements, so a lazy `import()` is never seen.
 */
function runtimeImports(source) {
  const { ast } = parser.parseForESLint(source, PARSE_OPTIONS);
  return ast.body
    .map(runtimeSource)
    .filter((spec) => typeof spec === "string" && spec.startsWith("."));
}

/** The module an import names: `./a.js` is `a.ts`, a directory its index. */
function resolveImport(importer, spec, sources) {
  const target = path.posix.join(path.posix.dirname(importer), spec);
  return [target.replace(/\.js$/, ".ts"), `${target}.ts`, `${target}/index.ts`].find(
    (candidate) => candidate in sources
  );
}

/**
 * The groups of modules that reach each other (Tarjan's strongly connected
 * components, iteratively so a deep import chain cannot overflow the stack).
 * `graph` maps a module to the modules it imports.
 */
function findCycles(graph) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const cycles = [];
  for (const root of graph.keys()) {
    if (index.has(root)) continue;
    const work = [{ node: root, deps: [...(graph.get(root) ?? [])], next: 0 }];
    index.set(root, index.size);
    low.set(root, index.get(root));
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame.next < frame.deps.length) {
        const dep = frame.deps[frame.next++];
        if (!index.has(dep)) {
          index.set(dep, index.size);
          low.set(dep, index.get(dep));
          stack.push(dep);
          onStack.add(dep);
          work.push({ node: dep, deps: [...(graph.get(dep) ?? [])], next: 0 });
        } else if (onStack.has(dep)) {
          low.set(frame.node, Math.min(low.get(frame.node), index.get(dep)));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        low.set(parent.node, Math.min(low.get(parent.node), low.get(frame.node)));
      }
      if (low.get(frame.node) !== index.get(frame.node)) continue;
      const group = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        group.push(member);
      } while (member !== frame.node);
      const selfImport = graph.get(frame.node)?.has(frame.node);
      if (group.length > 1 || selfImport) cycles.push(group.sort());
    }
  }
  return cycles;
}

/** The import cycles among `sources`, a map of `/`-separated path to source text. */
function cyclesAmong(sources) {
  const graph = new Map();
  for (const [file, source] of Object.entries(sources)) {
    const deps = runtimeImports(source)
      .map((spec) => resolveImport(file, spec, sources))
      .filter(Boolean);
    graph.set(file, new Set(deps));
  }
  return findCycles(graph);
}

/** The import cycles among the `.ts` files under `srcDir`, as paths relative to it. */
function checkImportCycles(srcDir = SRC_DIR) {
  const sources = {};
  const entries = fs.readdirSync(srcDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const file = path.join(entry.parentPath, entry.name);
    const name = path.relative(srcDir, file).split(path.sep).join("/");
    sources[name] = fs.readFileSync(file, "utf8");
  }
  return cyclesAmong(sources);
}

function main() {
  const cycles = checkImportCycles();
  if (cycles.length === 0) {
    console.log("No import cycles in src/.");
    return;
  }
  for (const group of cycles) {
    console.error(
      `Import cycle between ${group.length} modules:\n${group.map((f) => `  src/${f}`).join("\n")}`
    );
  }
  console.error(
    "\nBreak the circle: move what both sides need into a module neither of them" +
      " imports from, or make the import `import type` if only types cross it."
  );
  process.exit(1);
}

if (require.main === module) main();

module.exports = { checkImportCycles, cyclesAmong, findCycles, runtimeImports };
