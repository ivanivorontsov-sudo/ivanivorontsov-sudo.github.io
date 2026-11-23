#!/usr/bin/env python3
"""Print Markdown links for the project's individual landing pages."""
PROJECTS = {
    "Строка": "stroka-ide",
    "ИванМозг": "ivan-mozg",
    "Матрёшка ОС": "matryoshka-os",
    "Пособия": "posobiya",
    "Антираскладка": "antiraskladka",
    "Отучение": "otuchenie",
}
BASE = "https://ivanivorontsov-sudo.github.io/projects"
print("<!-- Project landing pages: add to the matching repository README. -->")
for name, slug in PROJECTS.items():
    print(f"- [{name} — описание и документация]({BASE}/{slug}/)")
