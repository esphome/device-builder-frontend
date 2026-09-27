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

const SRC_DIR = path.join(__dirname, "..", "src");

// A static import or re-export with a relative source, or a side-effect
// import. Group 1: the `type` keyword; 2: what is imported; 3 and 4: the
// source.
const STATEMENT =
  /^(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["'](\.[^"']+)["']|^import\s+["'](\.[^"']+)["']/gm;
// Comments that start a line, which is where a commented-out import sits.
// Anchored so a `/*` inside a string ("image/*", a glob) cannot swallow the
// imports after it.
const COMMENTS = /^\s*\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm;
// A comment trailing one name of a multi-line specifier list. Left in, it
// would glue itself to the next name (a `type` list read as a runtime one)
// or, with a quote in it, stop the statement from matching at all.
const SPECIFIER_COMMENT = /^(\s*(?:type\s+)?[\w$]+(?:\s+as\s+[\w$]+)?\s*,?)\s*\/\/.*$/gm;

/** Whether `{ type A, type B }` names types only. */
function isTypeOnlyList(specifiers) {
  if (!specifiers.startsWith("{")) return false;
  const names = specifiers
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((name) => name.startsWith("type "));
}

function stripComments(source) {
  return source.replace(COMMENTS, "").replace(SPECIFIER_COMMENT, "$1");
}

/** The relative sources a module imports at runtime. */
function runtimeImports(source) {
  const specs = [];
  for (const match of stripComments(source).matchAll(STATEMENT)) {
    const [, typeKeyword, specifiers, from, sideEffect] = match;
    if (sideEffect) specs.push(sideEffect);
    else if (!typeKeyword && !isTypeOnlyList(specifiers)) specs.push(from);
  }
  return specs;
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
