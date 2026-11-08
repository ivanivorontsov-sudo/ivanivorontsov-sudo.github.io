(() => {
"use strict";
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const bytes=n=>n<1048576?(n/1024).toFixed(1)+" КБ":(n/1048576).toFixed(2)+" МБ";
function msg(el,text,kind=""){el.textContent=text;el.className="status"+(kind?" "+kind:"");}
async function copy(s){if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(s);const t=document.createElement("textarea");t.value=s;document.body.append(t);t.select();if(!document.execCommand("copy"))throw new Error("Копирование запрещено браузером");t.remove();}
function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);}
function table(headers,rows){const t=document.createElement("table");t.className="resulttable";const thead=document.createElement("thead"),tr=document.createElement("tr");headers.forEach(h=>{const th=document.createElement("th");th.textContent=h;tr.append(th);});thead.append(tr);t.append(thead);const body=document.createElement("tbody");rows.forEach(row=>{const tr=document.createElement("tr");row.forEach(cell=>{const td=document.createElement("td");td.textContent=cell;tr.append(td);});body.append(tr);});t.append(body);return t;}
const saved=localStorage.getItem("daily-tools-theme");if(saved==="light"||saved==="dark")document.documentElement.dataset.theme=saved;
$("theme").addEventListener("click",()=>{const v=document.documentElement.dataset.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=v;localStorage.setItem("daily-tools-theme",v);});

// 01 — bounded line diff.
function diff(){
 const a=$("diff-a").value.split(/\r?\n/),b=$("diff-b").value.split(/\r?\n/),out=$("diff-output");out.replaceChildren();const cap=1200000;let ops=[];
 if((a.length+1)*(b.length+1)<=cap){
  const w=b.length+1,dp=new Uint32Array((a.length+1)*w);
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i*w+j]=a[i]===b[j]?dp[(i+1)*w+j+1]+1:Math.max(dp[(i+1)*w+j],dp[i*w+j+1]);
  let i=0,j=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){ops.push(["same",a[i++]]);j++;}else if(dp[(i+1)*w+j]>=dp[i*w+j+1])ops.push(["del",a[i++]]);else ops.push(["add",b[j++]]);}
  while(i<a.length)ops.push(["del",a[i++]]);while(j<b.length)ops.push(["add",b[j++]]);
 }else{
  let s=0;while(s<a.length&&s<b.length&&a[s]===b[s])ops.push(["same",a[s++]]);let i=a.length-1,j=b.length-1,z=[];
  while(i>=s&&j>=s&&a[i]===b[j]){z.unshift(["same",a[i]]);i--;j--;}
  for(let k=s;k<=i;k++)ops.push(["del",a[k]]);for(let k=s;k<=j;k++)ops.push(["add",b[k]]);ops.push(...z);
  const note=document.createElement("p");note.className="hint";note.textContent="Большой текст: показаны общее начало и конец, изменённый блок выделен целиком.";out.append(note);
 }
 const box=document.createElement("div");box.className="diff";let n={same:0,add:0,del:0};
 ops.forEach(([k,line])=>{n[k]++;const span=document.createElement("span");span.className="diffline "+k;span.textContent=(k==="add"?"+ ":k==="del"?"− ":"  ")+line;box.append(span);});out.append(box);
 const summary=document.createElement("p");summary.className="hint";summary.textContent="Без изменений: "+n.same+" · Добавлено: "+n.add+" · Удалено: "+n.del;out.append(summary);
}
$("diff-run").addEventListener("click",diff);
$("diff-swap").addEventListener("click",()=>{let x=$("diff-a").value;$("diff-a").value=$("diff-b").value;$("diff-b").value=x;diff();});
$("diff-clear").addEventListener("click",()=>{$("diff-a").value="";$("diff-b").value="";$("diff-output").replaceChildren();});

// 02 — cryptographic file hashes.
$("hash-run").addEventListener("click",async()=>{
 const files=[...$("hash-files").files],out=$("hash-output");out.replaceChildren();
 if(!files.length){msg(out,"Сначала выбери хотя бы один файл.","bad");return;}
 if(!crypto.subtle){msg(out,"Web Crypto недоступен; открой страницу по HTTPS.","bad");return;}
 const algo=$("hash-algo").value,rows=[];
 for(const f of files){try{const h=await crypto.subtle.digest(algo,await f.arrayBuffer());rows.push([f.name,bytes(f.size),[...new Uint8Array(h)].map(v=>v.toString(16).padStart(2,"0")).join("")]);}catch(e){rows.push([f.name,bytes(f.size),"Ошибка: "+e.message]);}}
 out.append(table(["Файл","Размер",algo],rows));
});

// 03 — duplicate finder by SHA-256.
$("dup-run").addEventListener("click",async()=>{
 const files=[...$("dup-files").files],out=$("dup-output");out.replaceChildren();
 if(files.length<2){msg(out,"Выбери минимум два файла.","bad");return;}
 if(!crypto.subtle){msg(out,"Web Crypto недоступен; открой страницу по HTTPS.","bad");return;}
 const bySize=new Map();files.forEach(f=>{if(!bySize.has(f.size))bySize.set(f.size,[]);bySize.get(f.size).push(f);});
 const buckets=new Map();
 try{
  for(const group of bySize.values())if(group.length>1)for(const f of group){const d=await crypto.subtle.digest("SHA-256",await f.arrayBuffer()),h=[...new Uint8Array(d)].map(v=>v.toString(16).padStart(2,"0")).join("");if(!buckets.has(h))buckets.set(h,[]);buckets.get(h).push(f.name);}
  const dup=[...buckets.values()].filter(g=>g.length>1);
  if(!dup.length){msg(out,"Дубликатов по содержимому не найдено.","good");return;}
  const rows=[];dup.forEach((g,i)=>g.forEach(n=>rows.push(["Группа "+(i+1),n])));
  out.append(table(["Совпадение","Файл"],rows));const p=document.createElement("p");p.className="hint";p.textContent="Найдено "+dup.length+" групп одинаковых файлов. Ничего не удалялось.";out.append(p);
 }catch(e){msg(out,"Ошибка проверки: "+e.message,"bad");}
});

// Shared image helpers.
async function bitmap(file){if(!window.createImageBitmap)throw new Error("Браузер не поддерживает createImageBitmap.");return createImageBitmap(file);}
function toBlob(canvas,type,quality){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Не удалось создать изображение.")),type,quality));}
function extension(type){return type==="image/jpeg"?"jpg":type==="image/png"?"png":"webp";}
function previewResult(out,blob,name,description){
 out.replaceChildren();const img=document.createElement("img"),url=URL.createObjectURL(blob);img.src=url;img.alt="Результат обработки";img.style.cssText="display:block;max-width:100%;max-height:230px;margin:0 auto 10px;border-radius:9px";img.onload=()=>URL.revokeObjectURL(url);
 const fileURL=URL.createObjectURL(blob),link=document.createElement("a");link.href=fileURL;link.download=name;link.textContent="Скачать "+name;link.className="btn primary";link.style.display="inline-block";link.style.textDecoration="none";link.addEventListener("click",()=>setTimeout(()=>URL.revokeObjectURL(fileURL),30000),{once:true});
 const note=document.createElement("p");note.className="hint";note.textContent=description;out.append(img,link,note);
}

// 04 — image compression to target byte size.
$("compress-run").addEventListener("click",async()=>{
 const f=$("compress-file").files[0],out=$("compress-output");out.replaceChildren();const target=Number($("compress-target").value)*1024,type=$("compress-format").value;
 if(!f){msg(out,"Выбери изображение.","bad");return;}if(!Number.isFinite(target)||target<5120){msg(out,"Минимальный лимит — 5 КБ.","bad");return;}
 let bm;try{
  bm=await bitmap(f);const initial=Math.min(1,2400/Math.max(bm.width,bm.height));let best=null,hit=false,w=0,h=0;
  for(let step=0;step<23;step++){
   const scale=initial*(step<7?1:Math.pow(.87,step-6));w=Math.max(1,Math.round(bm.width*scale));h=Math.max(1,Math.round(bm.height*scale));
   const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d");if(type==="image/jpeg"){ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);}ctx.drawImage(bm,0,0,w,h);
   const q=type==="image/png"?undefined:Math.max(.4,.94-(step%7)*.08),blob=await toBlob(c,type,q);if(!best||blob.size<best.size)best=blob;if(blob.size<=target){best=blob;hit=true;break;}
  }
  bm.close?.();previewResult(out,best,"compressed-photo."+extension(best.type),bytes(f.size)+" → "+bytes(best.size)+" · "+w+"×"+h+(hit?" · лимит достигнут":" · лимит не достигнут"));
  msg(out,hit?"Готово: размер укладывается в заданный лимит.":"Получен минимальный размер в пределах алгоритма; заданный лимит не достигнут.",hit?"good":"bad");
 }catch(e){bm?.close?.();msg(out,"Ошибка обработки: "+e.message,"bad");}
});

// 05 — re-encode pixels to strip metadata.
$("exif-run").addEventListener("click",async()=>{
 const f=$("exif-file").files[0],out=$("exif-output");out.replaceChildren();if(!f){msg(out,"Выбери изображение.","bad");return;}
 let bm;try{bm=await bitmap(f);const type=$("exif-format").value,c=document.createElement("canvas");c.width=bm.width;c.height=bm.height;const ctx=c.getContext("2d");if(type==="image/jpeg"){ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);}ctx.drawImage(bm,0,0);const ow=bm.width,oh=bm.height;bm.close?.();
 const blob=await toBlob(c,type,type==="image/png"?undefined:.92);previewResult(out,blob,"photo-clean."+extension(blob.type),ow+"×"+oh+" · "+bytes(f.size)+" → "+bytes(blob.size));msg(out,"Создан новый файл из пикселей; исходные EXIF- и другие встроенные метаданные не копируются.","good");
 }catch(e){bm?.close?.();msg(out,"Ошибка: "+e.message,"bad");}
});

// 06 — image resize with contain or crop.
$("resize-run").addEventListener("click",async()=>{
 const f=$("resize-file").files[0],out=$("resize-output");out.replaceChildren();const w=Number($("resize-width").value),h=Number($("resize-height").value);
 if(!f){msg(out,"Выбери изображение.","bad");return;}if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>12000||h>12000){msg(out,"Размеры должны быть от 1 до 12 000 пикселей.","bad");return;}
 let bm;try{bm=await bitmap(f);const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d");
 if($("resize-mode").value==="contain"){const s=Math.min(w/bm.width,h/bm.height),dw=bm.width*s,dh=bm.height*s;ctx.drawImage(bm,(w-dw)/2,(h-dh)/2,dw,dh);}
 else{const s=Math.max(w/bm.width,h/bm.height),sw=w/s,sh=h/s;ctx.drawImage(bm,(bm.width-sw)/2,(bm.height-sh)/2,sw,sh,0,0,w,h);}
 const ow=bm.width,oh=bm.height;bm.close?.();const blob=await toBlob(c,"image/webp",.92);previewResult(out,blob,"resized-photo."+extension(blob.type),ow+"×"+oh+" → "+w+"×"+h+" · "+bytes(blob.size));msg(out,"Готово.","good");
 }catch(e){bm?.close?.();msg(out,"Ошибка: "+e.message,"bad");}
});

// 07 — CSV parser respecting quoted delimiters and line breaks.
function parseCSV(text,delimiter){
 const rows=[];let row=[],field="",quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];
  if(quoted){if(ch==='"'&&next==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;}
  else if(ch==='"'&&field==="")quoted=true;
  else if(ch===delimiter){row.push(field);field="";}
  else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&next==="\n")i++;row.push(field);rows.push(row);row=[];field="";}
  else field+=ch;
 }
 if(quoted)throw new Error("Незакрытая кавычка в CSV.");row.push(field);rows.push(row);return rows.filter((r,i)=>!(i===rows.length-1&&r.length===1&&r[0]===""));
}
function delimiterOf(text){
 let counts={",":0,";":0,"\t":0},quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];if(ch==='"'&&quoted&&next==='"'){i++;continue;}if(ch==='"'){quoted=!quoted;continue;}if(!quoted&&(ch==="\n"||ch==="\r"))break;if(!quoted&&Object.prototype.hasOwnProperty.call(counts,ch))counts[ch]++;}
 return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][1] ? Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0] : ",";
}
function csvCell(v){const s=v==null?"":typeof v==="object"?JSON.stringify(v):String(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
$("csv-run").addEventListener("click",()=>{
 const input=$("csv-input").value,out=$("csv-output");
 try{
  if($("csv-mode").value==="json-csv"){
   const data=JSON.parse(input);if(!Array.isArray(data)||!data.length||!data.every(x=>x&&typeof x==="object"&&!Array.isArray(x)))throw new Error("Нужен непустой массив объектов JSON.");
   const heads=[...new Set(data.flatMap(Object.keys))];out.value=[heads.map(csvCell).join(","),...data.map(x=>heads.map(h=>csvCell(x[h])).join(","))].join("\r\n");
  }else{
   const rows=parseCSV(input,delimiterOf(input));if(!rows.length)throw new Error("CSV пуст.");const heads=rows[0].map((x,i)=>x||"column_"+(i+1));
   out.value=JSON.stringify(rows.slice(1).map((r,i)=>{if(r.length>heads.length)throw new Error("В строке "+(i+2)+" слишком много столбцов.");const o={};heads.forEach((h,j)=>o[h]=r[j]??"");return o;}),null,2);
  }
  msg(out,"Преобразование готово.","good");
 }catch(e){out.value="";msg(out,e.message,"bad");}
});
$("csv-copy").addEventListener("click",async()=>{try{await copy($("csv-output").value);msg($("csv-output"),"Скопировано.","good");}catch(e){msg($("csv-output"),e.message,"bad");}});
$("csv-download").addEventListener("click",()=>{const s=$("csv-output").value;if(!s){msg($("csv-output"),"Сначала создай результат.","bad");return;}const csv=$("csv-mode").value==="json-csv";save(new Blob([csv?"\ufeff"+s:s],{type:csv?"text/csv;charset=utf-8":"application/json;charset=utf-8"}),csv?"converted.csv":"converted.json");});

// 08 — safe Markdown renderer; raw HTML is escaped.
function inlineMD(text){let s=esc(text);s=s.replace(/\x60([^\x60]+)\x60/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/\*([^*]+)\*/g,"<em>$1</em>");return s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');}
function markdown(text){
 const lines=text.replace(/\r\n?/g,"\n").split("\n");let out="",p=[],list=false,quote=false,code=false,c=[];
 const flush=()=>{if(p.length){out+="<p>"+p.map(inlineMD).join("<br>")+"</p>";p=[];}};
 const endList=()=>{if(list){out+="</ul>";list=false;}};const endQuote=()=>{if(quote){out+="</blockquote>";quote=false;}};
 for(const line of lines){
  if(/^ *\x60{3}/.test(line)){flush();endList();endQuote();if(code){out+="<pre><code>"+esc(c.join("\n"))+"</code></pre>";c=[];code=false;}else code=true;continue;}
  if(code){c.push(line);continue;}if(!line.trim()){flush();endList();endQuote();continue;}
  const h=line.match(/^(#{1,3})\s+(.*)$/);if(h){flush();endList();endQuote();const n=h[1].length;out+="<h"+n+">"+inlineMD(h[2])+"</h"+n+">";continue;}
  if(/^[-*]\s+/.test(line)){flush();endQuote();if(!list){out+="<ul>";list=true;}out+="<li>"+inlineMD(line.replace(/^[-*]\s+/,""))+"</li>";continue;}
  if(/^>\s?/.test(line)){flush();endList();if(!quote){out+="<blockquote>";quote=true;}out+="<p>"+inlineMD(line.replace(/^>\s?/,""))+"</p>";continue;}
  if(/^---+$/.test(line)){flush();endList();endQuote();out+="<hr>";continue;}endList();endQuote();p.push(line);
 }
 flush();endList();endQuote();if(code)out+="<pre><code>"+esc(c.join("\n"))+"</code></pre>";return out;
}
$("md-input").addEventListener("input",()=>{$("md-preview").innerHTML=markdown($("md-input").value);});$("md-input").dispatchEvent(new Event("input"));

// 09 — URL parser; it does not visit the provided address.
function parseURL(){const s=$("url-input").value.trim();if(!s)throw new Error("Введи адрес.");return new URL(/^[a-z][a-z0-9+.-]*:/i.test(s)?s:"https://"+s);}
$("url-run").addEventListener("click",()=>{
 const out=$("url-output");out.replaceChildren();try{const u=parseURL(),rows=[["Протокол",u.protocol],["Домен",u.hostname],["Порт",u.port||"по умолчанию"],["Путь",u.pathname],["Фрагмент",u.hash||"—"]];out.append(table(["Поле","Значение"],rows));
 if(u.searchParams.size){const p=document.createElement("p");p.textContent="Параметры запроса:";p.style.fontWeight="700";out.append(p);for(const [k,v] of u.searchParams){const line=document.createElement("p");line.textContent=k+" = "+v;out.append(line);}}
 msg(out,"URL разобран локально; запросов к этому адресу не было.","good");
 }catch(e){msg(out,e.message,"bad");}
});
$("url-encode").addEventListener("click",()=>{$("url-output").textContent=encodeURIComponent($("url-input").value);});
$("url-decode").addEventListener("click",()=>{try{$("url-output").textContent=decodeURIComponent($("url-input").value);}catch{msg($("url-output"),"Некорректное URL-кодирование.","bad");}});
$("url-add").addEventListener("click",()=>{try{const u=parseURL(),key=$("url-key").value.trim();if(!key)throw new Error("Введи имя параметра.");u.searchParams.set(key,$("url-value").value);$("url-input").value=u.toString();msg($("url-output"),"Параметр добавлен. Ссылка не открывалась.","good");}catch(e){msg($("url-output"),e.message,"bad");}});

// 10 — text cleanup.
$("clean-run").addEventListener("click",()=>{
 let lines=$("clean-input").value.replace(/\r\n?/g,"\n").split("\n");if($("clean-trailing").checked)lines=lines.map(x=>x.replace(/[ \t]+$/g,""));
 if($("clean-dedupe").checked){const seen=new Set();lines=lines.filter(x=>{if(seen.has(x))return false;seen.add(x);return true;});}
 if($("clean-blank").checked){const res=[];let prev=false;for(const x of lines){const blank=!x.trim();if(blank&&prev)continue;res.push(x);prev=blank;}lines=res;}
 let out=lines.join("\n");if($("clean-trim").checked)out=out.trim();$("clean-output").value=out;
});
$("clean-copy").addEventListener("click",async()=>{try{await copy($("clean-output").value);msg($("clean-output"),"Скопировано.","good");}catch(e){msg($("clean-output"),e.message,"bad");}});

// 11 — WCAG contrast.
function rgb(hex){const m=hex.trim().match(/^#?([0-9a-f]{6})$/i);if(!m)throw new Error("Укажи цвет в формате #RRGGBB.");return [0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)/255);}
function lum(c){const x=c.map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*x[0]+.7152*x[1]+.0722*x[2];}
function contrast(){try{
 const fh=$("fg-hex").value,bh=$("bg-hex").value,ratio=(Math.max(lum(rgb(fh)),lum(rgb(bh)))+.05)/(Math.min(lum(rgb(fh)),lum(rgb(bh)))+.05);
 const f="#"+fh.replace("#",""),b="#"+bh.replace("#","");$("fg-color").value=f;$("bg-color").value=b;$("contrast-preview").style.color=f;$("contrast-preview").style.background=b;
 const out=$("contrast-output");out.replaceChildren();const strong=document.createElement("strong");strong.textContent="Контраст: "+ratio.toFixed(2)+":1";out.append(strong);
 [["AA обычный",4.5],["AA крупный",3],["AAA обычный",7],["AAA крупный",4.5]].forEach(([name,limit])=>{const span=document.createElement("span");span.className="metric";span.textContent=name+": "+(ratio>=limit?"пройдено":"не пройдено");out.append(span);});
 }catch(e){msg($("contrast-output"),e.message,"bad");}}
[["fg-color","fg-hex"],["bg-color","bg-hex"]].forEach(([color,hex])=>{$(color).addEventListener("input",()=>{$(hex).value=$(color).value.toUpperCase();contrast();});$(hex).addEventListener("change",contrast);});contrast();
})();