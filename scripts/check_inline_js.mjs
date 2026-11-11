#!/usr/bin/env node
/** Parse inline JavaScript in HTML without executing it. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");const htmlFiles=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name===".git"||entry.name==="node_modules")continue;const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(entry.isFile()&&entry.name.toLowerCase().endsWith(".html"))htmlFiles.push(full);}}
walk(root);const errors=[];let checked=0;
for(const file of htmlFiles.sort()){const html=fs.readFileSync(file,"utf8");const re=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;let match,block=0;
while((match=re.exec(html))!==null){const attrs=match[1],code=match[2].trim();if(!code||/\bsrc\s*=/.test(attrs))continue;const type=(attrs.match(/\btype\s*=\s*["\x27]([^"\x27]+)["\x27]/i)||[,""])[1].toLowerCase();if(type&&!["text/javascript","application/javascript"].includes(type))continue;block++;try{new vm.Script(code,{filename:path.relative(root,file)+":inline-"+block});checked++;}catch(error){errors.push(path.relative(root,file)+": inline script "+block+" — "+error.message);}}}
console.log("Checked "+checked+" inline JavaScript blocks across "+htmlFiles.length+" HTML pages.");
if(errors.length){for(const error of errors)console.error("ERROR:",error);process.exitCode=1;}else console.log("Inline JavaScript syntax check passed.");
