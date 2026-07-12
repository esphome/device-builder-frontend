const fs = require("fs");
const path = require("path");
const rspack = require("@rspack/core");

const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.resolve(ROOT_DIR, "src");
// Build output lives inside the Python package directory so
// `python -m build` can pick it up directly. Mirrors how
// music-assistant/frontend wires up its wheel — the JS bundles,
// index.html, and the package's `__init__.py` end up side-by-side
// in this folder, which is then included by setuptools as the sole
// package. The directory is gitignored.
const OUTPUT_DIR = path.resolve(ROOT_DIR, "esphome_device_builder_frontend");
const PUBLIC_DIR = path.resolve(ROOT_DIR, "public");

// Standalone "ESPHome Web" static-site build. Shares the src/ tree and
// design system with the wheel dashboard but ships as its own backend-free
// bundle deployed to GitHub Pages (web.esphome.io). Kept fully separate from
// the wheel output above so the two never cross-contaminate.
const WEB_OUTPUT_DIR = path.resolve(ROOT_DIR, "esphome_web");
const WEB_PUBLIC_DIR = path.resolve(PUBLIC_DIR, "web");

// Backend port the dev proxy targets. Honors BACKEND_PORT so two
// checkouts can run side by side without editing this file; validated
// like PORT in dev-server.cjs so a typo (BACKEND_PORT=abc) can't
// produce an invalid proxy URL. Falls back to 6052.
const parsedBackendPort = parseInt(process.env.BACKEND_PORT, 10);
const BACKEND_PORT =
  Number.isFinite(parsedBackendPort) && parsedBackendPort > 0 ? parsedBackendPort : 6052;

// Shared TypeScript + CSS loader rules. Both the wheel dashboard and the
// standalone web build transpile the same src/ tree the same way.
const moduleRules = () => ({
  rules: [
    {
      test: /\.ts$/,
      exclude: /node_modules/,
      use: [
        {
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: {
                syntax: "typescript",
                decorators: true,
              },
              transform: {
                legacyDecorator: true,
                decoratorMetadata: false,
                useDefineForClassFields: false,
              },
              target: "es2021",
            },
          },
        },
      ],
      resolve: {
        fullySpecified: false,
      },
    },
    {
      test: /\.css$/,
      type: "asset/source",
    },
  ],
});

// Shared module resolution (the `.js` → `.ts` extension aliasing and the
// pinned lit sub-path entry points).
const resolveConfig = () => ({
  extensions: [".ts", ".js", ".json"],
  extensionAlias: {
    ".js": [".ts", ".js"],
  },
  alias: {
    "lit/static-html$": "lit/static-html.js",
    "lit/decorators$": "lit/decorators.js",
    "lit/directive$": "lit/directive.js",
    "lit/directives/until$": "lit/directives/until.js",
    "lit/directives/ref$": "lit/directives/ref.js",
    "lit/directives/class-map$": "lit/directives/class-map.js",
    "lit/directives/style-map$": "lit/directives/style-map.js",
    "lit/directives/if-defined$": "lit/directives/if-defined.js",
    "lit/directives/guard$": "lit/directives/guard.js",
    "lit/directives/cache$": "lit/directives/cache.js",
    "lit/directives/repeat$": "lit/directives/repeat.js",
    "lit/directives/live$": "lit/directives/live.js",
    "lit/directives/keyed$": "lit/directives/keyed.js",
  },
});

const optimizationConfig = (isProdBuild) => ({
  minimizer: isProdBuild
    ? [
        new rspack.SwcJsMinimizerRspackPlugin({
          extractComments: true,
        }),
      ]
    : [],
  moduleIds: isProdBuild ? "deterministic" : "named",
  chunkIds: isProdBuild ? "deterministic" : "named",
  splitChunks: {
    chunks: "async",
    cacheGroups: {
      vendors: {
        test: /[\\/]node_modules[\\/]/,
        name: "vendors",
        chunks: "async",
      },
    },
  },
});

const definePlugin = (isProdBuild) =>
  new rspack.DefinePlugin({
    __DEV__: JSON.stringify(!isProdBuild),
    __BUILD_VERSION__: JSON.stringify(
      require(path.resolve(ROOT_DIR, "package.json")).version
    ),
  });

// ``eval-cheap-module-source-map`` is the rspack default for dev and uses
// ``eval()`` to evaluate each module — clashes with our CSP's lack of
// ``script-src 'unsafe-eval'`` so the dev server would 100% fail to boot the
// app. ``cheap-module-source-map`` emits a separate ``.map`` file and avoids
// eval entirely; same line-level fidelity, slower hot reloads (fine for dev).
const devtoolFor = (isProdBuild) =>
  isProdBuild ? "nosources-source-map" : "cheap-module-source-map";

// The exact connect-src directive in public/web/index.html. Kept as a constant
// so the dev-only widening below can assert it still matches — a silent
// string-replace miss would break HMR (no ws:/wss:) with no build error.
const WEB_CSP_CONNECT_SRC = "connect-src 'self' data: https://firmware.esphome.io";

/**
 * In prod, ship the tight CSP verbatim. In dev, widen connect-src with ws:/wss:
 * so the HMR client can connect. Throws if the expected connect-src directive
 * isn't present, so a reworded CSP fails the build loudly instead of silently
 * disabling hot reload.
 */
const widenDevConnectSrc = (html, isProdBuild) => {
  if (!html.includes(WEB_CSP_CONNECT_SRC)) {
    throw new Error(
      `ESPHome Web: expected CSP directive "${WEB_CSP_CONNECT_SRC}" not found in ` +
        "public/web/index.html. Update WEB_CSP_CONNECT_SRC in build-scripts/rspack.cjs " +
        "to match, or dev HMR (ws:/wss:) will silently break."
    );
  }
  if (isProdBuild) return html;
  return html.replace(WEB_CSP_CONNECT_SRC, `${WEB_CSP_CONNECT_SRC} ws: wss:`);
};

/**
 * Create the rspack configuration for the ESPHome (wheel) frontend.
 */
const createRspackConfig = ({ isProdBuild = false } = {}) => ({
  name: "esphome-frontend",
  mode: isProdBuild ? "production" : "development",
  target: "browserslist:modern",
  devtool: devtoolFor(isProdBuild),
  entry: {
    app: path.resolve(SRC_DIR, "entrypoint.ts"),
  },
  node: false,
  module: moduleRules(),
  optimization: optimizationConfig(isProdBuild),
  plugins: [
    definePlugin(isProdBuild),
    // The source ``public/index.html`` carries an
    // ``__ESPHOME_BASE_HREF__`` placeholder that the backend
    // substitutes per-request with the deployment prefix
    // (esphome/device-builder serves index.html and rewrites it).
    // The rspack dev server doesn't go through that backend, so we
    // pre-substitute the placeholder to ``"/"`` at build time for
    // dev. Prod builds emit the placeholder verbatim — the backend
    // is the substituter.
    new rspack.HtmlRspackPlugin({
      templateContent: fs
        .readFileSync(path.resolve(PUBLIC_DIR, "index.html"), "utf-8")
        .replace(/__ESPHOME_BASE_HREF__/g, isProdBuild ? "__ESPHOME_BASE_HREF__" : "/"),
      inject: "body",
    }),
    new rspack.CopyRspackPlugin({
      patterns: [
        {
          from: path.resolve(PUBLIC_DIR, "assets"),
          to: path.resolve(OUTPUT_DIR, "assets"),
          noErrorOnMissing: true,
        },
        {
          from: path.resolve(PUBLIC_DIR, "static"),
          to: path.resolve(OUTPUT_DIR, "static"),
          noErrorOnMissing: true,
        },
        // Drop the Python package's __init__.py alongside the JS
        // bundles so `pip install` ships a runnable module pointing
        // to the static asset root. See public/__init__.py for the
        // tiny `where()` helper the backend uses to locate it.
        {
          from: path.resolve(PUBLIC_DIR, "__init__.py"),
          to: path.resolve(OUTPUT_DIR, "__init__.py"),
        },
      ],
    }),
  ].filter(Boolean),
  resolve: resolveConfig(),
  output: {
    filename: isProdBuild ? "[name].[contenthash].js" : "[name].js",
    chunkFilename: isProdBuild ? "[name].[contenthash].js" : "[name].js",
    path: OUTPUT_DIR,
    // ``auto`` makes the runtime derive the public path from
    // ``document.currentScript.src`` and HtmlRspackPlugin emit the
    // entry script with a relative href. That lets the bundle load
    // from any mount point — bare ``/``, an HA ingress prefix like
    // ``/api/hassio_ingress/<token>/``, or a reverse-proxy subpath
    // — without rebuilding. ``src/util/base-path.ts`` reads the same
    // signal to keep client-side routing, the WebSocket URL, and the
    // ``/assets/...`` references in lockstep.
    publicPath: "auto",
    clean: true,
    hashFunction: "xxhash64",
  },
  experiments: {
    outputModule: false,
  },
  devServer: {
    static: {
      directory: PUBLIC_DIR,
    },
    port: 5173,
    hot: true,
    client: {
      webSocketURL: {
        pathname: "/hmr-ws",
      },
    },
    webSocketServer: {
      options: {
        path: "/hmr-ws",
      },
    },
    historyApiFallback: { disableDotRule: true },
    proxy: [
      {
        // All communication goes through the single /ws WebSocket endpoint
        context: ["/ws"],
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
      },
      {
        // Backend-served static files (board images, etc.)
        context: ["/boards"],
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
      {
        // REST endpoints, incl. the firmware artifact download
        // (GET /api/firmware/download — too large for the WS).
        context: ["/api"],
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
      {
        // Legacy REST endpoints (for backward compat if needed)
        context: ["/devices", "/json-config", "/compile", "/upload"],
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    ],
  },
});

/**
 * Create the rspack configuration for the standalone ESPHome Web site.
 *
 * A backend-free static bundle: no WebSocket, no dev proxy. It reuses the
 * shared src/ tree (design system, Web Serial engine, localization) and adds
 * only the ``src/web/`` app on top. Output goes to ``esphome_web/`` and is
 * published to GitHub Pages; the wheel build is untouched.
 */
const createWebRspackConfig = ({ isProdBuild = false } = {}) => ({
  name: "esphome-web",
  mode: isProdBuild ? "production" : "development",
  target: "browserslist:modern",
  devtool: devtoolFor(isProdBuild),
  entry: {
    app: path.resolve(SRC_DIR, "web/entrypoint.ts"),
  },
  node: false,
  module: moduleRules(),
  optimization: optimizationConfig(isProdBuild),
  plugins: [
    definePlugin(isProdBuild),
    // The prod CSP has no ws:/wss: — ESPHome Web is a static site with no
    // WebSocket. But the dev server's HMR client connects over ws://.../hmr-ws,
    // so widen connect-src to allow it in dev only (prod ships the tight CSP).
    new rspack.HtmlRspackPlugin({
      templateContent: widenDevConnectSrc(
        fs.readFileSync(path.resolve(WEB_PUBLIC_DIR, "index.html"), "utf-8"),
        isProdBuild
      ),
      inject: "body",
    }),
    new rspack.CopyRspackPlugin({
      patterns: [
        {
          from: path.resolve(WEB_PUBLIC_DIR, "static"),
          to: path.resolve(WEB_OUTPUT_DIR, "static"),
          noErrorOnMissing: true,
        },
        {
          // Served from the site root so Safari's /favicon.ico fallback resolves
          // (its <link rel=icon> is SVG-only).
          from: path.resolve(WEB_PUBLIC_DIR, "favicon.ico"),
          to: path.resolve(WEB_OUTPUT_DIR, "favicon.ico"),
          noErrorOnMissing: true,
        },
      ],
    }),
  ].filter(Boolean),
  resolve: resolveConfig(),
  output: {
    filename: isProdBuild ? "[name].[contenthash].js" : "[name].js",
    chunkFilename: isProdBuild ? "[name].[contenthash].js" : "[name].js",
    path: WEB_OUTPUT_DIR,
    // Served from the site root (custom domain web.esphome.io) in prod;
    // ``auto`` in dev so the HMR client resolves against the dev origin.
    publicPath: isProdBuild ? "/" : "auto",
    clean: true,
    hashFunction: "xxhash64",
  },
  experiments: {
    outputModule: false,
  },
  devServer: {
    static: {
      directory: WEB_PUBLIC_DIR,
    },
    port: 5174,
    hot: true,
    client: {
      webSocketURL: {
        pathname: "/hmr-ws",
      },
    },
    webSocketServer: {
      options: {
        path: "/hmr-ws",
      },
    },
    historyApiFallback: { disableDotRule: true },
  },
});

module.exports = { createRspackConfig, createWebRspackConfig, BACKEND_PORT };
