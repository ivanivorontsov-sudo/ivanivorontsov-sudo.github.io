/* Shared top-of-page support card; local only, no analytics or network APIs. */
(() => {
  if (document.querySelector('script[data-site-support]')) return;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/assets/site-support.css";
  css.dataset.siteSupport = "true";
  document.head.append(css);
  const script = document.createElement("script");
  script.src = "/assets/site-support.js";
  script.defer = true;
  script.dataset.siteSupport = "true";
  document.head.append(script);
})();
(()=>{"use strict";
const fmt=new Intl.NumberFormat("ru-RU",{maximumSignificantDigits:12});
document.querySelectorAll(".convert-tool").forEach(original=>{
  // Convert the markup form into a neutral container before attaching handlers.
  // This guarantees that user-entered values are never sent as a form request.
  const f=document.createElement("div");
  for(const attr of original.attributes)f.setAttribute(attr.name,attr.value);
  f.innerHTML=original.innerHTML;
  original.replaceWith(f);

  const input=f.querySelector('input[type="number"]');
  const out=f.querySelector("[data-result]");
  const status=f.querySelector("[data-status]");
  const copy=f.querySelector("[data-copy]");
  const calculate=()=>{
    if(!input||!out||!status||!copy)return;
    if(!input.checkValidity()){
      input.reportValidity();
      return;
    }
    const raw=input.value.trim(),v=Number(raw);
    const a=Number(f.dataset.sourceFactor),b=Number(f.dataset.targetFactor);
    if(!raw||!Number.isFinite(v)){
      out.textContent="Введите конечное число.";
      copy.disabled=true;
      return;
    }
    if(!(a>0)||!(b>0)){
      out.textContent="Ошибка коэффициента.";
      copy.disabled=true;
      return;
    }
    const n=v*a/b;
    if(!Number.isFinite(n)){
      out.textContent="Результат вне диапазона JavaScript.";
      copy.disabled=true;
      return;
    }
    const result=fmt.format(Object.is(n,-0)?0:n)+(f.dataset.targetSymbol?" "+f.dataset.targetSymbol:"");
    f.dataset.lastResult=result;
    out.textContent=result;
    status.textContent="Готово. Расчёт выполнен локально.";
    copy.disabled=false;
  };
  const calculateButton=f.querySelector('button[type="submit"]');
  if(calculateButton){
    calculateButton.type="button";
    calculateButton.addEventListener("click",calculate);
  }
  input?.addEventListener("keydown",e=>{
    if(e.key==="Enter"){
      e.preventDefault();
      calculate();
    }
  });
  input?.addEventListener("input",()=>{
    if(copy)copy.disabled=true;
    if(status)status.textContent="";
  });
  copy?.addEventListener("click",async()=>{
    try{
      await navigator.clipboard.writeText(f.dataset.lastResult||"");
      status.textContent="Скопировано.";
    }catch(e){
      status.textContent="Копирование недоступно: "+e.message;
    }
  });
});
})();