/* Shared first-party support link. No analytics, storage, form submission, or payment processing. */
(() => {
  "use strict";
  if (!document.body) return;
  // The main page already has the canonical donation card with the bank details.
  if (document.querySelector(".site-support,[aria-label='Поддержать автора']")) return;

  const section = document.createElement("section");
  section.className = "site-support";
  section.setAttribute("role", "region");
  section.setAttribute("aria-labelledby", "site-support-title");

  const title = document.createElement("h2");
  title.id = "site-support-title";
  title.className = "site-support-title";
  title.textContent = "☕ Поддержать проекты";

  const note = document.createElement("p");
  note.className = "site-support-note";
  note.textContent = "Добровольная поддержка автора. Реквизиты находятся на главной странице; перевод выполняется напрямую через приложение или сайт вашего банка.";

  const link = document.createElement("a");
  link.className = "site-support-link";
  link.href = "https://ivanivorontsov-sudo.github.io/#donate";
  link.textContent = "Открыть реквизиты и поддержать";

  const status = document.createElement("p");
  status.className = "site-support-footer";
  status.textContent = "Сайт не принимает платежи, не запрашивает банковские данные и не подключает платёжные виджеты.";

  section.append(title, note, link, status);
  document.body.insertBefore(section, document.body.firstChild);
})();
