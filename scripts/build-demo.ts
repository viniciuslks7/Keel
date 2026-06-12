import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild, { type Plugin } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * The source uses NodeNext `.js` import specifiers that actually point at
 * `.ts` files. esbuild resolves the literal path, so this plugin rewrites
 * those relative specifiers back to their `.ts` sources during bundling.
 */
const resolveTsExtensions: Plugin = {
  name: 'resolve-ts-extensions',
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.importer || !args.path.startsWith('.')) {
        return null;
      }
      const candidate = resolve(dirname(args.importer), args.path.replace(/\.js$/, '.ts'));
      return existsSync(candidate) ? { path: candidate } : null;
    });
  },
};

await esbuild.build({
  entryPoints: [resolve(root, 'demo/main.ts')],
  outfile: resolve(root, 'public/app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  plugins: [resolveTsExtensions],
});

console.log('built public/app.js');
