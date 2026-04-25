const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

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
}).then(() => {
  // Copy webview HTML files to out/
  const dashboardDir = path.join(__dirname, 'out', 'dashboard');
  if (!fs.existsSync(dashboardDir)) fs.mkdirSync(dashboardDir, { recursive: true });
  const srcHtml = path.join(__dirname, 'src', 'dashboard', 'webview.html');
  if (fs.existsSync(srcHtml)) fs.copyFileSync(srcHtml, path.join(dashboardDir, 'webview.html'));
}).catch(() => process.exit(1));
