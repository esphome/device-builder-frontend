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

/**
 * Create the rspack configuration for the ESPHome frontend.
 */
const createRspackConfig = ({ isProdBuild = false } = {}) => ({
  name: "esphome-frontend",
  mode: isProdBuild ? "production" : "development",
  target: "browserslist:modern",
  // ``eval-cheap-module-source-map`` is the rspack default for dev
  // and uses ``eval()`` to evaluate each module — clashes with our
  // CSP's lack of ``script-src 'unsafe-eval'`` so the dev server
  // would 100% fail to boot the app. ``cheap-module-source-map``
  // emits a separate ``.map`` file and avoids eval entirely; same
  // line-level fidelity, slower hot reloads (acceptable for dev).
  devtool: isProdBuild ? "nosources-source-map" : "cheap-module-source-map",
  entry: {
    app: path.resolve(SRC_DIR, "entrypoint.ts"),
  },
  node: false,
  module: {
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
  },
  optimization: {
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
  },
  plugins: [
    new rspack.DefinePlugin({
      __DEV__: JSON.stringify(!isProdBuild),
      __BUILD_VERSION__: JSON.stringify(
        require(path.resolve(ROOT_DIR, "package.json")).version
      ),
    }),
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
  resolve: {
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
  },
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
        target: "ws://localhost:6052",
        ws: true,
      },
      {
        // Backend-served static files (board images, etc.)
        context: ["/boards"],
        target: "http://localhost:6052",
        changeOrigin: true,
      },
      {
        // REST endpoints, incl. the firmware artifact download
        // (GET /api/firmware/download — too large for the WS).
        context: ["/api"],
        target: "http://localhost:6052",
        changeOrigin: true,
      },
      {
        // Legacy REST endpoints (for backward compat if needed)
        context: ["/devices", "/json-config", "/compile", "/upload"],
        target: "http://localhost:6052",
        changeOrigin: true,
      },
    ],
  },
});

module.exports = { createRspackConfig };
