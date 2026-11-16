/* Local presentation only: no analytics, network calls, or storage. */
(() => {
  "use strict";
  if (!document.body) return;
  // The main page already contains the canonical donation card.
  if (document.querySelector(".site-support,[aria-label='Поддержать автора']")) return;

  const section = document.createElement("section");
  section.className = "site-support";
  section.setAttribute("role", "region");
  section.setAttribute("aria-labelledby", "site-support-title");

  const head = document.createElement("div");
  head.className = "site-support-head";
  const title = document.createElement("h2");
  title.id = "site-support-title";
  title.className = "site-support-title";
  title.textContent = "☕ Поддержать автора";
  const note = document.createElement("p");
  note.className = "site-support-note";
  note.textContent = "Добровольная поддержка проектов. Платёж обрабатывает ваш банк, сайт не принимает и не обрабатывает переводы.";
  head.append(title, note);

  const grid = document.createElement("div");
  grid.className = "site-support-grid";
  const status = document.createElement("p");
  status.className = "site-support-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const accounts = [
    { bank: "Карта Сбербанка", number: "2202 2085 2800 0566", button: "Копировать номер Сбербанка" },
    { bank: "Карта Т-Банка", number: "2200 7021 5197 6516", button: "Копировать номер Т-Банка" }
  ];

  async function copyNumber(number) {
    const value = number.replace(/\s+/g, "");
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("Браузер не разрешил копирование");
  }

  for (const account of accounts) {
    const card = document.createElement("div");
    card.className = "site-support-account";
    const bank = document.createElement("p");
    bank.className = "site-support-bank";
    bank.textContent = account.bank;
    const number = document.createElement("span");
    number.className = "site-support-number";
    number.textContent = account.number;
    const button = document.createElement("button");
    button.className = "site-support-copy";
    button.type = "button";
    button.textContent = account.button;
    button.addEventListener("click", async () => {
      try {
        await copyNumber(account.number);
        status.textContent = "Номер скопирован. Перевод выполняется напрямую через приложение или сайт вашего банка.";
        button.textContent = "✓ Скопировано";
        button.disabled = true;
        window.setTimeout(() => {
          button.textContent = account.button;
          button.disabled = false;
        }, 1800);
      } catch (error) {
        status.textContent = error && error.message ? error.message : "Не удалось скопировать номер.";
      }
    });
    card.append(bank, number, button);
    grid.append(card);
  }

  const footer = document.createElement("p");
  footer.className = "site-support-footer";
  footer.textContent = "Поддержать игры Atari 2600 и Sega Mega Drive можно переводом на карту Т-Банка.";
  section.append(head, grid, footer, status);
  document.body.insertBefore(section, document.body.firstChild);
})();
