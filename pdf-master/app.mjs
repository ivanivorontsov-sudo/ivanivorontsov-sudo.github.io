import * as PDFLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.esm.min.js";
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.mjs";
window.PDFLib = PDFLib;
window.pdfjsLib = pdfjsLib;

(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = { files: [], pages: [], nextId: 1, renderToken: 0, busy: false };
  const fmt = new Intl.NumberFormat("ru-RU", {maximumFractionDigits:1});
  const bytesText = n => n < 1024*1024 ? fmt.format(n/1024)+" КБ" : fmt.format(n/1024/1024)+" МБ";

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const savedTheme = localStorage.getItem("pdf-master-theme");
  if (savedTheme === "dark" || savedTheme === "light") document.documentElement.dataset.theme = savedTheme;
  $("theme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("pdf-master-theme", next);
  });

  function status(message, kind = "") {
    const node = $("status");
    node.textContent = message;
    node.className = "status show" + (kind ? " " + kind : "");
  }
  function clearStatus() { $("status").className = "status"; }
  function safeName(name) {
    return (name || "document-ready.pdf").replace(/[\\/:*?"<>|]+/g,"-").replace(/\.pdf$/i,"").slice(0,90) + ".pdf";
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function setBusy(busy) {
    state.busy = busy;
    ["choose","clear","select-all","select-none","remove-unselected","export-selected","export-range"].forEach(id => {
      const node = $(id);
      if (node) node.disabled = busy || state.pages.length === 0;
    });
    $("drop").style.opacity = busy ? ".55" : "1";
    $("drop").style.pointerEvents = busy ? "none" : "auto";
  }
  function updateCounts() {
    const selected = state.pages.filter(p => p.selected).length;
    $("page-count").textContent = state.pages.length + " стр. · выбрано " + selected;
    const hasPages = state.pages.length > 0;
    ["clear","select-all","select-none","remove-unselected","export-selected","export-range"].forEach(id => $(id).disabled = state.busy || !hasPages);
    $("export-selected").disabled = state.busy || selected === 0;
  }
  function renderFileList() {
    const box = $("file-list");
    box.replaceChildren();
    for (const file of state.files) {
      const row = document.createElement("div");
      row.className = "file-row";
      const label = document.createElement("span");
      label.textContent = file.name + " · " + bytesText(file.size) + " · " + file.pageCount + " стр.";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "small-btn";
      remove.textContent = "Убрать";
      remove.setAttribute("aria-label", "Убрать " + file.name);
      remove.addEventListener("click", () => removeFile(file.id));
      row.append(label, remove);
      box.append(row);
    }
  }
  function makePageCard(page, index) {
    const card = document.createElement("article");
    card.className = "page-card";
    card.draggable = true;
    card.dataset.pageId = String(page.id);

    const canvas = document.createElement("canvas");
    canvas.width = 140;
    canvas.height = 180;
    canvas.setAttribute("aria-label", "Предпросмотр страницы " + (index+1));
    const meta = document.createElement("div");
    meta.className = "page-meta";
    const number = document.createElement("strong");
    number.textContent = "Страница " + (index+1);
    const check = document.createElement("label");
    check.className = "page-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = page.selected;
    checkbox.setAttribute("aria-label", "Выбрать страницу " + (index+1));
    checkbox.addEventListener("change", () => { page.selected = checkbox.checked; updateCounts(); });
    const checkText = document.createElement("span");
    checkText.textContent = "Включить";
    check.append(checkbox, checkText);
    meta.append(number, check);

    const from = document.createElement("div");
    from.className = "muted";
    from.style.fontSize = ".7rem";
    from.style.margin = "0 0 6px";
    from.textContent = page.fileName;

    const actions = document.createElement("div");
    actions.className = "page-actions";
    const rotate = document.createElement("button");
    rotate.type = "button";
    rotate.textContent = "↻ Поворот";
    rotate.title = "Повернуть на 90°";
    rotate.addEventListener("click", async () => {
      page.rotation = (page.rotation + 90) % 360;
      await drawThumbnail(page, canvas, ++state.renderToken);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Удалить";
    remove.addEventListener("click", () => {
      state.pages = state.pages.filter(p => p.id !== page.id);
      renderAll();
    });
    actions.append(rotate, remove);
    card.append(canvas, meta, from, actions);

    card.addEventListener("dragstart", e => {
      if (state.busy) { e.preventDefault(); return; }
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(page.id));
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", e => { e.preventDefault(); card.classList.add("over"); });
    card.addEventListener("dragleave", () => card.classList.remove("over"));
    card.addEventListener("drop", e => {
      e.preventDefault();
      card.classList.remove("over");
      const fromId = Number(e.dataTransfer.getData("text/plain"));
      if (!fromId || fromId === page.id) return;
      const fromIndex = state.pages.findIndex(p => p.id === fromId);
      const toIndex = state.pages.findIndex(p => p.id === page.id);
      if (fromIndex < 0 || toIndex < 0) return;
      const [moved] = state.pages.splice(fromIndex, 1);
      state.pages.splice(toIndex, 0, moved);
      renderAll();
    });
    return {card, canvas};
  }

  async function drawThumbnail(page, canvas, token) {
    try {
      const pdfPage = await page.pdfjs.getPage(page.pageIndex + 1);
      const base = pdfPage.getViewport({scale:1, rotation:page.rotation});
      const scale = Math.min(160/base.width, 180/base.height, 0.55);
      const viewport = pdfPage.getViewport({scale, rotation:page.rotation});
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.floor(viewport.width*ratio));
      canvas.height = Math.max(1, Math.floor(viewport.height*ratio));
      canvas.style.height = Math.min(180, viewport.height) + "px";
      const ctx = canvas.getContext("2d", {alpha:false});
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0,0,canvas.width,canvas.height);
      await pdfPage.render({canvasContext:ctx,viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]}).promise;
    } catch (error) {
      const ctx=canvas.getContext("2d");
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle="#9b342f";ctx.font="12px system-ui";ctx.textAlign="center";ctx.fillText("Предпросмотр",canvas.width/2,canvas.height/2);
    }
  }

  async function renderAll() {
    const holder = $("pages");
    holder.replaceChildren();
    const token = ++state.renderToken;
    if (!state.pages.length) {
      const empty=document.createElement("div");
      empty.className="empty-state";
      const title=document.createElement("strong");
      title.textContent="Пока нет страниц";
      empty.append(title,document.createTextNode("Добавь один или несколько PDF — здесь появятся миниатюры."));
      holder.append(empty);
      updateCounts();
      renderFileList();
      return;
    }
    const canvases=[];
    state.pages.forEach((page,index)=>{
      const built=makePageCard(page,index);
      holder.append(built.card);
      canvases.push({page,canvas:built.canvas});
    });
    updateCounts();
    for (const item of canvases) {
      if (token !== state.renderToken) return;
      await drawThumbnail(item.page,item.canvas,token);
    }
  }

  async function addFiles(fileList) {
    if (state.busy) return;
    const files = [...fileList].filter(file => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!files.length) { status("Выбери файл PDF. Другие форматы не поддерживаются.", "error"); return; }
    setBusy(true);
    clearStatus();
    let added=0;
    const errors=[];
    try {
      for (const file of files) {
        try {
          if (file.size > 250*1024*1024) throw new Error("файл больше 250 МБ — браузеру может не хватить памяти");
          const buffer = await file.arrayBuffer();
          const sourceDoc = await PDFLib.PDFDocument.load(buffer.slice(0), {updateMetadata:false});
          const pdfjs = await pdfjsLib.getDocument({
            data:new Uint8Array(buffer.slice(0)),
            cMapUrl:"https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/cmaps/",
            cMapPacked:true,
            standardFontDataUrl:"https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/standard_fonts/",
            wasmUrl:"https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/wasm/"
          }).promise;
          const fileId=state.nextId++;
          const source={id:fileId,name:file.name,size:file.size,pageCount:sourceDoc.getPageCount(),sourceDoc,pdfjs};
          state.files.push(source);
          for(let i=0;i<source.pageCount;i++){
            const p=await pdfjs.getPage(i+1);
            state.pages.push({
              id:state.nextId++,fileId,sourceDoc,pdfjs,pageIndex:i,fileName:file.name,
              rotation:p.rotate||0,selected:true
            });
          }
          added++;
          status("Загружено: "+added+" из "+files.length+" файлов. Страниц: "+state.pages.length+".", "");
          await renderAll();
        } catch(error) {
          errors.push(file.name+": "+(error&&error.message?error.message:"не удалось прочитать PDF"));
        }
      }
    } finally {
      setBusy(false);
      renderFileList();
      updateCounts();
      if(errors.length) status((added?"Добавлено файлов: "+added+". ":"")+"Не удалось открыть: "+errors.join(" · "), "error");
      else if(added) status("Готово. Добавлено файлов: "+added+", страниц: "+state.pages.length+". Файлы не загружались на сервер.", "ok");
    }
  }

  function removeFile(fileId) {
    if(state.busy)return;
    state.pages=state.pages.filter(p=>p.fileId!==fileId);
    state.files=state.files.filter(f=>f.id!==fileId);
    renderAll();
    clearStatus();
  }

  function parseRange(raw, max) {
    const parts=raw.split(/[,;]+/).map(s=>s.trim()).filter(Boolean);
    if(!parts.length)throw new Error("Укажи диапазон, например 1-3, 5, 8-10.");
    const result=[],seen=new Set();
    for(const part of parts){
      const match=part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if(!match)throw new Error("Непонятный фрагмент диапазона: "+part);
      const start=Number(match[1]),end=Number(match[2]||match[1]);
      if(start<1||end<start||end>max)throw new Error("Диапазон "+part+" выходит за пределы 1–"+max+".");
      for(let n=start;n<=end;n++){if(!seen.has(n)){seen.add(n);result.push(n-1);}}
    }
    return result.map(i=>state.pages[i]);
  }

  async function exportPages(selected, label) {
    if(state.busy)return;
    if(!selected.length){status("Не выбрано ни одной страницы.", "error");return;}
    setBusy(true);
    status("Собираю новый PDF…");
    try {
      const out=await PDFLib.PDFDocument.create();
      const sourceMap=new Map();
      for(let i=0;i<selected.length;i++){
        const item=selected[i];
        let indices=sourceMap.get(item.sourceDoc);
        if(!indices){indices=[];sourceMap.set(item.sourceDoc,indices);}
        indices.push({sourceIndex:item.pageIndex,targetIndex:i,item});
      }
      const copied=new Array(selected.length);
      for(const [sourceDoc,entries] of sourceMap.entries()){
        const pages=await out.copyPages(sourceDoc,entries.map(e=>e.item.pageIndex));
        entries.forEach((entry,index)=>{
          const page=pages[index];
          page.setRotation(PDFLib.degrees(entry.item.rotation));
          copied[entry.targetIndex]=page;
        });
      }
      copied.forEach(page=>out.addPage(page));
      if($("page-numbers").checked){
        const font=await out.embedFont(PDFLib.StandardFonts.Helvetica);
        copied.forEach((page,index)=>{
          const {width}=page.getSize();
          page.drawText(String(index+1),{x:width-34,y:15,size:9,font,color:PDFLib.rgb(.42,.42,.42)});
        });
      }
      if($("clear-meta").checked) clearMetadata(out);
      const bytes=await out.save({useObjectStreams:true,addDefaultPage:false});
      const blob=new Blob([bytes],{type:"application/pdf"});
      const name=safeName($("filename").value || "document-ready.pdf");
      downloadBlob(blob,name);
      status("Готово: "+selected.length+" страниц · "+bytesText(blob.size)+" · "+label+". Исходные файлы не изменены.","ok");
    } catch(error) {
      status("Не удалось создать PDF: "+(error&&error.message?error.message:"неизвестная ошибка"),"error");
    } finally {
      setBusy(false);
      updateCounts();
    }
  }

  function clearMetadata(doc) {
    doc.setTitle("");
    doc.setAuthor("");
    doc.setSubject("");
    doc.setKeywords([]);
    doc.setCreator("");
    doc.setProducer("");
    try {
      const infoRef=doc.context.trailerInfo.Info;
      if(infoRef){
        const info=doc.context.lookup(infoRef);
        if(info&&typeof info.delete==="function"){
          ["Title","Author","Subject","Keywords","Creator","Producer","CreationDate","ModDate"].forEach(key=>info.delete(PDFLib.PDFName.of(key)));
        }
      }
    } catch (_) {}
    try { doc.catalog.delete(PDFLib.PDFName.of("Metadata")); } catch (_) {}
  }

  $("choose").addEventListener("click",()=>$("files").click());
  $("files").addEventListener("change",async e=>{await addFiles(e.target.files);e.target.value="";});
  $("drop").addEventListener("dragover",e=>{e.preventDefault();$("drop").classList.add("drag");});
  $("drop").addEventListener("dragleave",()=> $("drop").classList.remove("drag"));
  $("drop").addEventListener("drop",async e=>{e.preventDefault();$("drop").classList.remove("drag");await addFiles(e.dataTransfer.files);});
  $("clear").addEventListener("click",()=>{if(state.busy)return;state.files=[];state.pages=[];renderAll();clearStatus();});
  $("select-all").addEventListener("click",()=>{state.pages.forEach(p=>p.selected=true);renderAll();});
  $("select-none").addEventListener("click",()=>{state.pages.forEach(p=>p.selected=false);renderAll();});
  $("remove-unselected").addEventListener("click",()=>{state.pages=state.pages.filter(p=>p.selected);renderAll();status("Неотмеченные страницы удалены из рабочего списка. Исходные PDF не изменены.","ok");});
  $("export-selected").addEventListener("click",()=>exportPages(state.pages.filter(p=>p.selected),"выбранные страницы"));
  $("export-range").addEventListener("click",()=>{
    try {const chosen=parseRange($("range").value,state.pages.length);exportPages(chosen,"диапазон "+$("range").value.trim());}
    catch(error){status(error.message,"error");}
  });

  if(!window.PDFLib||!window.pdfjsLib){
    status("Не удалось загрузить библиотеки PDF с CDN. Проверь подключение к интернету и обнови страницу. Сами документы никуда не отправляются.","error");
  }
})();