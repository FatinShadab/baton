import * as esbuild from 'esbuild';

const base = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
};
const entries = [
  { ...base, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] },
  { ...base, entryPoints: ['src/mcp/server.ts'], outfile: 'out/mcp.js', external: ['vscode'] },
];

try {
  if (process.argv.includes('--watch')) {
    const contexts = await Promise.all(entries.map((options) => esbuild.context(options)));
    await Promise.all(contexts.map((context) => context.watch()));
  } else {
    await Promise.all(entries.map((options) => esbuild.build(options)));
  }
} catch {
  process.exitCode = 1;
}
