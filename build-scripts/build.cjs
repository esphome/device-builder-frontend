const { createRspackConfig } = require("./rspack.cjs");
const rspack = require("@rspack/core");

// Refresh the language manifest from whatever locales are present (the
// release job restores the Lokalise locales before building) so the picker
// reflects the shipped set. localize.ts statically imports the manifest.
require("./gen-language-manifest.cjs").generate();

const config = createRspackConfig({ isProdBuild: true });

const compiler = rspack.rspack(config);

compiler.run((err, stats) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  console.log(
    stats.toString({
      colors: true,
      chunks: false,
      modules: false,
    }),
  );

  compiler.close((closeErr) => {
    if (closeErr) {
      console.error(closeErr);
    }
  });
});
