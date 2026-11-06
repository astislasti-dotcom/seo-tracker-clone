// Empaqueta el arnés con el webpack que trae Next (no se añade ninguna dependencia nueva).
const path = require('node:path');
const webpack = require('next/dist/compiled/webpack/webpack').webpack;

const here = __dirname;
webpack(
  {
    mode: 'development',
    devtool: false,
    target: 'web',
    context: path.resolve(here, '../..'),
    entry: path.join(here, 'entry.mjs'),
    output: { path: path.join(here, 'dist'), filename: 'bundle.js', clean: true },
    resolve: { extensions: ['.mjs', '.js', '.json'] },
  },
  (err, stats) => {
    if (err || stats.hasErrors()) {
      console.error(err || stats.toString({ all: false, errors: true }));
      process.exit(1);
    }
    console.log('bundle ok');
  }
);
