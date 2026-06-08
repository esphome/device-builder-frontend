const { createRspackConfig, BACKEND_PORT } = require("./rspack.cjs");
const { RspackDevServer } = require("@rspack/dev-server");
const rspack = require("@rspack/core");

// Refresh the language manifest from whatever locales are present so the
// picker reflects them in dev. localize.ts statically imports the manifest.
require("./gen-language-manifest.cjs").generate();

const config = createRspackConfig({ isProdBuild: false });

// Honor PORT from the environment so harnesses (including Claude
// Code's preview tool) can run a parallel dev server on a free port
// when the default is already in use. Falls back to the rspack
// config's hardcoded port when PORT isn't set.
const envPort = parseInt(process.env.PORT, 10);
if (Number.isFinite(envPort) && envPort > 0) {
  config.devServer.port = envPort;
}

const compiler = rspack.rspack(config);
const server = new RspackDevServer(config.devServer, compiler);

server.start().then(() => {
  console.log(`\n  ESPHome Frontend dev server running at:\n`);
  console.log(`  > Local:   http://localhost:${config.devServer.port}/\n`);
  console.log(`  API proxy target: http://localhost:${BACKEND_PORT}\n`);
});
