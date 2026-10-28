import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const result=await build({entryPoints:[root+'scripts/building-preview/scene.js'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'inline'});
const shell=await readFile(root+'scripts/building-preview/shell.html','utf8');
const js=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
await writeFile(root+'scripts/preview-buildings.html',shell.replace('<!-- PREVIEW_SCRIPT -->',()=>'<script>'+js+'</script>'));
console.log('scripts/preview-buildings.html built: offline, inline Three.js + OrbitControls, no src/core imports.');
