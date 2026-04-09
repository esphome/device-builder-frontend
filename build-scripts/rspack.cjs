const path = require("path");
const rspack = require("@rspack/core");

const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.resolve(ROOT_DIR, "src");
const OUTPUT_DIR = path.resolve(ROOT_DIR, "dist");
const PUBLIC_DIR = path.resolve(ROOT_DIR, "public");

/**
 * Create the rspack configuration for the ESPHome frontend.
 */
const createRspackConfig = ({ isProdBuild = false } = {}) => ({
  name: "esphome-frontend",
  mode: isProdBuild ? "production" : "development",
  target: "browserslist:modern",
  devtool: isProdBuild ? "nosources-source-map" : "eval-cheap-module-source-map",
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
    new rspack.HtmlRspackPlugin({
      template: path.resolve(PUBLIC_DIR, "index.html"),
      inject: "body",
    }),
    new rspack.CopyRspackPlugin({
      patterns: [
        {
          from: path.resolve(PUBLIC_DIR, "static"),
          to: path.resolve(OUTPUT_DIR, "static"),
          noErrorOnMissing: true,
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
    publicPath: "/",
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
        // Legacy REST endpoints (for backward compat if needed)
        context: ["/devices", "/json-config", "/compile", "/upload"],
        target: "http://localhost:6052",
        changeOrigin: true,
      },
    ],
  },
});

module.exports = { createRspackConfig };
