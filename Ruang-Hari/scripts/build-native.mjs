import { build } from 'esbuild';
await build({entryPoints:['native/index.js'],bundle:true,format:'esm',outfile:'dist/native.js',minify:true});
console.log('Native notification bridge built.');
