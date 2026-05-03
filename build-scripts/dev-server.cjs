const { createRspackConfig } = require("./rspack.cjs");
const { RspackDevServer } = require("@rspack/dev-server");
const rspack = require("@rspack/core");

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
  console.log(`  API proxy target: http://localhost:6052\n`);
});
