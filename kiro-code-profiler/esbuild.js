const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
  minify: false,
  loader: { '.html': 'text' },  // inlines webview.html as a string — no runtime file reads
}).catch(() => process.exit(1));
