"""Команда генерации демонстрационных данных для Service Desk.

Запуск: ``python manage.py seed_demo`` (по умолчанию ~120 заявок —
этого достаточно, чтобы продемонстрировать скорость рендеринга
большого списка карточек, описанную в разделе 3.5 пояснительной записки).
"""

from __future__ import annotations

import random
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from tickets.models import Category, Ticket


CATEGORIES = [
    ("Доступы и учётные записи", "access", "#7c3aed"),
    ("Программное обеспечение", "software", "#2563eb"),
    ("Оборудование", "hardware", "#0891b2"),
    ("Сеть и интернет", "network", "#059669"),
    ("Принтеры и периферия", "printers", "#d97706"),
    ("Корпоративная почта", "email", "#dc2626"),
    ("1С и бухгалтерия", "1c", "#db2777"),
    ("Прочее", "other", "#475569"),
]

TICKET_TEMPLATES = [
    ("Не запускается Outlook", "После обновления системы Outlook падает при старте. Прилагаю скриншот ошибки."),
    ("Принтер на 3 этаже зажёвывает бумагу", "Принтер HP LaserJet постоянно зажёвывает листы. Замена картриджа не помогает."),
    ("Нужен доступ к папке Договоры", "Прошу выдать права на чтение к сетевой папке //fs01/shared/Договоры."),
    ("Тормозит 1С Бухгалтерия", "При проведении документов 1С зависает на 20-30 секунд. Версия 8.3.22."),
    ("Не работает VPN из дома", "Подключение к VPN обрывается через 5 минут после соединения."),
    ("Сбросить пароль от корпоративной почты", "Заблокировал учётную запись после нескольких неверных попыток входа."),
    ("Установить Photoshop для дизайнера", "Новому сотруднику дизайн-отдела нужен пакет Adobe."),
    ("Не работает Wi-Fi в переговорной №4", "В переговорной не подключается к корпоративному Wi-Fi (CORP)."),
    ("Заменить блок питания на рабочем ПК", "Компьютер периодически выключается под нагрузкой."),
    ("Настроить почту на телефоне", "Не получается настроить корпоративную почту на iPhone через Exchange."),
    ("Создать новую учётную запись для стажёра", "С понедельника выходит стажёр Иванов И.И., нужны базовые доступы."),
    ("Не работает СКУД на входе", "Карта не считывается на турникете. Возможно, размагнитилась."),
    ("Восстановить случайно удалённый файл", "Удалил квартальный отчёт из папки на рабочем столе. Очень срочно!"),
    ("Установить второй монитор", "Заявка на подключение второго монитора Dell U2419H."),
    ("Заменить клавиатуру и мышь", "Клавиатура залита кофе, мышь работает через раз."),
    ("Обновить антивирус", "Антивирус показывает, что базы не обновлялись 30 дней."),
    ("Доступ к Confluence", "Прошу выдать права на пространство «IT-документация»."),
    ("Настроить SIP-телефонию", "Новый сотрудник, нужен внутренний номер и настройка софтфона."),
    ("Сломалась веб-камера", "Не работает встроенная веб-камера на ноутбуке Lenovo."),
    ("Ошибка при печати из 1С", "При попытке печати накладной выпадает ошибка «Файл не найден»."),
]

AUTHORS = [
    ("Анна Смирнова", "a.smirnova@corp.local", "+7 (916) 123-45-67"),
    ("Дмитрий Иванов", "d.ivanov@corp.local", "+7 (903) 555-12-34"),
    ("Екатерина Петрова", "e.petrova@corp.local", "+7 (925) 987-65-43"),
    ("Михаил Соколов", "m.sokolov@corp.local", "+7 (985) 222-33-44"),
    ("Ольга Кузнецова", "o.kuznetsova@corp.local", "+7 (909) 777-88-99"),
    ("Сергей Васильев", "s.vasilev@corp.local", "+7 (926) 111-22-33"),
    ("Юлия Морозова", "yu.morozova@corp.local", ""),
    ("Алексей Новиков", "a.novikov@corp.local", "+7 (910) 444-55-66"),
]

ASSIGNEES = ["", "Антон Лебедев", "Павел Орлов", "Ирина Зайцева", "Денис Карпов"]


class Command(BaseCommand):
    help = "Создаёт демонстрационные категории и заявки для Service Desk."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--count",
            type=int,
            default=120,
            help="Сколько заявок создать (по умолчанию 120).",
        )
        parser.add_argument(
            "--flush",
            action="store_true",
            help="Удалить существующие данные перед заполнением.",
        )

    def handle(self, *args, **options) -> None:
        if options["flush"]:
            Ticket.objects.all().delete()
            Category.objects.all().delete()
            self.stdout.write(self.style.WARNING("Существующие данные удалены."))

        categories = []
        for name, slug, color in CATEGORIES:
            category, _ = Category.objects.get_or_create(
                slug=slug, defaults={"name": name, "color": color}
            )
            categories.append(category)

        statuses = [s for s, _ in Ticket.Status.choices]
        priorities = [p for p, _ in Ticket.Priority.choices]

        now = timezone.now()
        created = 0
        for _ in range(options["count"]):
            template = random.choice(TICKET_TEMPLATES)
            author = random.choice(AUTHORS)
            Ticket.objects.create(
                title=template[0],
                description=template[1],
                category=random.choice(categories),
                status=random.choice(statuses),
                priority=random.choices(priorities, weights=[3, 5, 3, 1])[0],
                author_name=author[0],
                author_email=author[1],
                author_phone=author[2],
                assignee=random.choice(ASSIGNEES),
                created_at=now - timedelta(hours=random.randint(0, 24 * 30)),
            )
            created += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Готово: {len(categories)} категорий, {created} заявок."
            )
        )
