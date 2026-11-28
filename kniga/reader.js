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
    // Восстановленная полная авторская версия стихотворения № 1.
    const firstPoem=reader.querySelector('#poem001');
    if(!firstPoem) throw new Error('В книге не найдено первое стихотворение.');
    const firstPoemStanzas=[
      ['Вьётся под небес окном','И какая-то зеркальность','В восприятии людском.'],
      ['Я про то, что нереально','Вихри жизни объяснить','Всяка ценность — виртуальна','Не за что людей винить.'],
      ['Понимаю, страх быть должен','За преступности разгул','Но наш выбор — он не сложен','Это химии всё гул.'],
      ['Все поступки — результаты','Лишь материи ветров','И нейронов автоматы','Потоки мыслей веют, слов.'],
      ['Что за жизнь? И что за сказки?','Что за лепет серых дней?','Что за мертвенные маски','Здесь у всех подряд людей?'],
      ['Предвзятость — зло, а вера — глупость','Нет на свете правды, лжи,','Физики законов скупость','Только есть, хоть ты брюзжи.'],
      ['Люди — просто обезьяны','Чуть умнее лишь других','И огромные изъяны','Есть в мышлении у них.'],
      ['Пусть придумали культуру','Пусть решили, как всем жить','Но животную натуру','Никому не победить.'],
      ['Становиться эгоистом?','Нет, тут, брат, уж подожди!','В мире, на руку нечистом','Лишь несчастья впереди.']
    ];
    const poemTitle=document.createElement('h2');
    poemTitle.textContent='Нереальная реальность';
    firstPoem.replaceChildren(poemTitle);
    firstPoemStanzas.forEach(lines=>{
      const stanza=document.createElement('p');
      stanza.className='stanza';
      lines.forEach((line,index)=>{
        if(index) stanza.append(document.createElement('br'));
        stanza.append(document.createTextNode(line));
      });
      firstPoem.append(stanza);
    });
    firstPoem.dataset.authorRevision='complete';
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