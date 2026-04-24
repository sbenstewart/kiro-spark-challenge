const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],   // vscode is provided by the extension host
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
  minify: false,
}).catch(() => process.exit(1));
