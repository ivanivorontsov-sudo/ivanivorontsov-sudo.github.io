# Подключение редактора

Редактор использует Decap CMS с backend turbo-github. Вход в CMS выполняется через аккаунт Decap Turbo, зарегистрированный через GitHub; GitHub App даёт редактору доступ к репозиторию.

## Однократная настройка

1. Открой https://turbo.decapcms.org/ и создай организацию, войдя через GitHub под ivanivorontsov-sudo.
2. В разделе Git connection установи Decap Turbo GitHub App на аккаунт ivanivorontsov-sudo. В выборе репозиториев разреши доступ **только** к ivanivorontsov-sudo.github.io.
3. Создай один сайт:
   - Git provider: GitHub
   - Repository: ivanivorontsov-sudo/ivanivorontsov-sudo.github.io
   - Branch: main
   - Config path: proizvedeniya/admin/config.yml
   - Admin interface URL: https://ivanivorontsov-sudo.github.io/proizvedeniya/admin/
4. Скопируй UUID из вкладки Overview созданного сайта.
5. Открой в GitHub файл proizvedeniya/admin/config.yml, замени REPLACE_WITH_DECAP_TURBO_SITE_UUID на полученный UUID и сохрани коммитом.
6. В настройках профиля Decap Turbo оставь GitHub единственным способом входа, отключив Google и пароль, если они подключены. Не приглашай других участников и не выдавай доступ посторонним.
7. Открой редактор по адресу https://ivanivorontsov-sudo.github.io/proizvedeniya/admin/ и войди через подключённый GitHub-аккаунт.

## Публикация

В редакторе две коллекции: «Авторские произведения» и «ИИ-произведения». Нажми New, заполни название, дату, жанр, описание и полный текст. Для ИИ-публикаций укажи происхождение, при необходимости — модель и роль человека. CMS сохраняет JSON в GitHub; GitHub Actions генерирует HTML-страницу, каталог и обновляет sitemap.

## Безопасность

- Папка admin содержит интерфейс CMS и noindex; это не защита сама по себе.
- Реальный контроль доступа обеспечивает Decap Turbo и GitHub App. Разреши приложению доступ только к этому репозиторию.
- Не помещай personal access token, пароль или OAuth secret в HTML, JavaScript, YAML публикаций или изображения.
- GitHub Pages публикует материалы в каталогах proizvedeniya/ и ii-proizvedeniya/ публично. Приватность редактора не делает произведения приватными.
- На момент подготовки тариф Decap Turbo Free предусматривает одну площадку и одно место редактора; условия могут меняться.

Официальные инструкции:
- https://decapcms.org/docs/turbo-getting-started/
- https://decapcms.org/docs/turbo-connecting-a-site/
- https://decapcms.org/docs/configuration-options/
