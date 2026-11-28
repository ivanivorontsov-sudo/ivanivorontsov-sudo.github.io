(async function(){
'use strict';
const root=document.documentElement;
const reader=document.getElementById('book-text');
const search=document.getElementById('search');
const count=document.getElementById('count');
const noResults=document.getElementById('no-results');
const tocLinks=[...document.querySelectorAll('.toc a[href^="#"]')];
function filterBook(){
  const query=(search.value||'').trim().toLocaleLowerCase('ru');
  const chapters=[...reader.querySelectorAll('.chapter')];
  let visible=0;
  chapters.forEach(chapter=>{
    const show=!query||chapter.textContent.toLocaleLowerCase('ru').includes(query);
    chapter.hidden=!show;
    if(show) visible++;
    const link=tocLinks.find(item=>item.getAttribute('href')==='#'+chapter.id);
    if(link) link.parentElement.hidden=!show;
  });
  count.textContent='Найдено произведений и глав: '+visible;
  noResults.style.display=visible?'none':'block';
}
(async function loadBook(){
  try{
    if(!('DecompressionStream' in window)) throw new Error('Для чтения нужен актуальный браузер с поддержкой распаковки gzip.');
    const parts=await Promise.all(Array.from({length:25},(_,index)=>{
      const number=String(index+1).padStart(2,'0');
      return fetch('/kniga/data/part'+number+'.txt',{cache:'force-cache'}).then(response=>{
        if(!response.ok) throw new Error('Не удалось загрузить часть книги '+number+' ('+response.status+').');
        return response.text();
      });
    }));
    const encoded=parts.join('');
    if(encoded.length<90000) throw new Error('Данные книги загружены не полностью.');
    const compressed=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));
    const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const markup=await new Response(stream).text();
    if(!markup.includes('id="poem145"')||!markup.includes('id="ch10"')||!markup.includes('Иван Игоревич Воронцов')) throw new Error('Проверка целостности текста книги не пройдена.');
    reader.innerHTML=markup;
    filterBook();
  }catch(error){
    reader.replaceChildren();
    const message=document.createElement('p');
    message.setAttribute('role','alert');
    message.textContent=String(error.message||error);
    reader.appendChild(message);
    const help=document.createElement('p');
    help.textContent='Обнови страницу или открой сайт в актуальном браузере. Текст книги хранится на этом сайте и не загружается со стороннего сервера.';
    reader.appendChild(help);
    count.textContent='Книга не загружена';
  }
})();
search.addEventListener('input',filterBook);
document.getElementById('clear').addEventListener('click',()=>{search.value='';filterBook();search.focus();});
let fontSize=19;
document.getElementById('larger').addEventListener('click',()=>{fontSize=Math.min(28,fontSize+1);root.style.setProperty('--reader-font',fontSize+'px');});
document.getElementById('smaller').addEventListener('click',()=>{fontSize=Math.max(14,fontSize-1);root.style.setProperty('--reader-font',fontSize+'px');});
const themeButton=document.getElementById('theme');
themeButton.addEventListener('click',()=>{const dark=root.dataset.theme!=='dark';root.dataset.theme=dark?'dark':'light';themeButton.textContent=dark?'Светлая тема':'Тёмная тема';});
function updateProgress(){const bar=document.getElementById('progress');const max=document.documentElement.scrollHeight-window.innerHeight;bar.style.width=(max>0?window.scrollY/max*100:0)+'%';}
window.addEventListener('scroll',updateProgress,{passive:true});window.addEventListener('resize',updateProgress);updateProgress();
})();