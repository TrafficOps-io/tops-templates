import {build} from 'esbuild';
import {chmod, copyFile, mkdir} from 'node:fs/promises';
await mkdir('dist', {recursive:true});
await build({entryPoints:['src/cli.js'], outfile:'dist/cli.js', bundle:true, packages:'external', platform:'node', format:'esm', target:'node22', banner:{js:'#!/usr/bin/env node'}, sourcemap:true});
await chmod('dist/cli.js', 0o755);
await copyFile('../LICENSE', 'LICENSE');
