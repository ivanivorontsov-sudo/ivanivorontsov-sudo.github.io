# Техническое SEO сайта

Основной адрес: https://ivanivorontsov-sudo.github.io/

## Что настроено

- Уникальные title и meta description для основных страниц.
- Самоссылочные canonical URL для индексируемых страниц.
- Open Graph и Twitter Card для предпросмотров ссылок.
- Schema.org JSON-LD: WebSite, CollectionPage, ItemList, WebApplication, VideoGame, WebPage и хлебные крошки там, где это уместно.
- robots.txt с адресом XML sitemap.
- XML sitemap содержит опубликованные страницы корневого сайта и его проектных GitHub Pages.
- Пользовательская страница 404 с noindex.
- Внутренние ссылки и sitemap проверяются скриптом scripts/seo_audit.py.
- GitHub Actions запускает SEO-проверку при push и pull request в main.

## Проверка перед публикацией

Запустить локально:

    python3 scripts/seo_audit.py

Проверка контролирует:
- ровно один заголовок страницы, описание и canonical;
- один H1;
- уникальность canonical URL;
- согласованность Open Graph и Twitter метаданных;
- синтаксис JSON-LD;
- локальные ссылки, ведущие на файлы текущего репозитория;
- валидность sitemap, отсутствие дубликатов и наличие всех индексируемых локальных страниц в карте сайта.

Страницы по путям vizitka/, edinicy/, tools-portal/ и supersmart-privacy/ публикуются из отдельных репозиториев GitHub Pages. Их содержимое проверяется в соответствующих репозиториях; основной скрипт не пытается считать их файлами корневого репозитория.

## Google Search Console

1. Добавить ресурс типа URL-prefix: https://ivanivorontsov-sudo.github.io/
2. Подтвердить право собственности способом, который предложит Search Console.
3. Отправить sitemap: https://ivanivorontsov-sudo.github.io/sitemap.xml
4. Проверить главную страницу, каталог инструментов и страницы веб-приложений через URL Inspection.
5. После переобхода смотреть отчёты Pages, Sitemaps и Enhancements, если для страницы доступна соответствующая функция.

Наличие sitemap и корректных метаданных помогает поисковым системам обнаруживать и интерпретировать страницы, но не гарантирует индексацию или конкретные позиции в выдаче.
