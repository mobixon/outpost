// Bundles the server into dist/main.js. Workspace packages (@outpost/*) are compiled in from
// source. Dependencies listed in this package.json stay external and are installed next to the
// bundle by `pnpm deploy`; anything else a plugin imports is bundled. A plugin dependency with a
// native module must therefore also be added to this package's dependencies.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const { dependencies = {} } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);
const external = new Set(Object.keys(dependencies).filter((name) => !name.startsWith('@outpost/')));
const packageName = (specifier) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'externalize-dependencies',
      setup(esbuild) {
        esbuild.onResolve({ filter: /^[^./]/ }, (args) =>
          external.has(packageName(args.path)) ? { path: args.path, external: true } : undefined,
        );
      },
    },
  ],
  // Bundled CommonJS code may call require(), which does not exist in ES modules.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
