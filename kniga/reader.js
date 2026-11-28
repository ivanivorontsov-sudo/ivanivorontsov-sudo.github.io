(async function(){
const root=document.documentElement,reader=document.getElementById('book-text');
try{
 const raw=atob(window.BOOK_DATA_GZIP||'');if(!raw)throw new Error('Данные книги не найдены');
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 if(!('DecompressionStream' in window))throw new Error('Браузер не поддерживает встроенное распаковывание книги. Обновите браузер до последней версии.');
 const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
 const markup=await new Response(stream).text();reader.innerHTML=markup;
 const chapters=[...reader.querySelectorAll('.chapter')],links=[...document.querySelectorAll('.toc a[href^="#"]')],search=document.getElementById('search'),count=document.getElementById('count'),noResults=document.getElementById('no-results');
 function filterText(){const q=search.value.trim().toLocaleLowerCase('ru');let visible=0;chapters.forEach(c=>{const show=!q||c.textContent.toLocaleLowerCase('ru').includes(q);c.hidden=!show;if(show)visible++;const link=links.find(a=>a.getAttribute('href')==='#'+c.id);if(link)link.parentElement.hidden=!show;});count.textContent='Найдено разделов: '+visible;noResults.style.display=visible?'none':'block';}
 search.addEventListener('input',filterText);document.getElementById('clear').addEventListener('click',()=>{search.value='';filterText();search.focus();});
 let size=19;document.getElementById('larger').addEventListener('click',()=>{size=Math.min(28,size+1);root.style.setProperty('--reader-font',size+'px');});document.getElementById('smaller').addEventListener('click',()=>{size=Math.max(14,size-1);root.style.setProperty('--reader-font',size+'px');});
 const themeBtn=document.getElementById('theme');themeBtn.addEventListener('click',()=>{const dark=root.dataset.theme!=='dark';root.dataset.theme=dark?'dark':'light';themeBtn.textContent=dark?'Светлая тема':'Тёмная тема';});document.getElementById('count').textContent=chapters.length+' разделов';
}catch(error){reader.innerHTML='<p class="error" role="alert">'+String(error.message||error)+'</p><p>Текст книги хранится на этом сайте и не загружается со стороннего сервера. Попробуйте открыть страницу в актуальной версии браузера.</p>';}
function setProgress(){const bar=document.getElementById('progress');const max=document.documentElement.scrollHeight-innerHeight;bar.style.width=(max>0?scrollY/max*100:0)+'%';}addEventListener('scroll',setProgress,{passive:true});addEventListener('resize',setProgress);setProgress();
})();
