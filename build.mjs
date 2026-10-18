// Bundles the site. drand-client and tlock-js each ship their own copy of the
// same @noble versions, so both are pointed at one copy to halve the bundle.
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
const require = createRequire(import.meta.url);
const dedupe = {
  name: 'dedupe-noble',
  setup(b) {
    b.onResolve({ filter: /^@noble\/(curves|hashes)(\/.*)?$/ }, (args) => {
      if (!args.importer.includes('drand-client')) return;
      return { path: require.resolve(args.path, { paths: [path.dirname(require.resolve('tlock-js'))] }) };
    });
  },
};
const common = { bundle: true, minify: true, format: 'iife', target: 'es2020', define: { global: 'globalThis' }, logLevel: 'warning', plugins: [dedupe] };
await esbuild.build({ ...common, entryPoints: ['src/app.mjs'], outfile: 'site/app.js' });
await esbuild.build({ ...common, entryPoints: ['src/owner.mjs'], outfile: 'site/owner.js' });
await esbuild.build({ ...common, entryPoints: ['src/deploy.mjs'], outfile: 'site/deploy.js' });
console.log('app.js', fs.statSync('site/app.js').size, 'gzip', zlib.gzipSync(fs.readFileSync('site/app.js')).length);
