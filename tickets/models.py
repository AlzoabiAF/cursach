"""Модели предметной области Service Desk.

Domain-сущности максимально простые: одна таблица заявок и
один справочник категорий. Этого достаточно, чтобы продемонстрировать
работу клиентского UI с реальным Django API.
"""

from django.db import models
from django.utils import timezone


class Category(models.Model):
    """Категория, к которой относится заявка (ПО, оборудование, доступы и т.д.)."""

    name = models.CharField("Название", max_length=64, unique=True)
    slug = models.SlugField("Идентификатор", max_length=64, unique=True)
    color = models.CharField(
        "Акцентный цвет",
        max_length=16,
        default="#2563eb",
        help_text="HEX-цвет бейджа категории в интерфейсе.",
    )

    class Meta:
        verbose_name = "Категория"
        verbose_name_plural = "Категории"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    def to_dict(self) -> dict:
        return {"id": self.pk, "name": self.name, "slug": self.slug, "color": self.color}


class Ticket(models.Model):
    """Заявка пользователя в службу поддержки."""

    class Status(models.TextChoices):
        NEW = "new", "Новая"
        IN_PROGRESS = "in_progress", "В работе"
        WAITING = "waiting", "Ожидает ответа"
        RESOLVED = "resolved", "Решена"
        CLOSED = "closed", "Закрыта"

    class Priority(models.TextChoices):
        LOW = "low", "Низкий"
        MEDIUM = "medium", "Средний"
        HIGH = "high", "Высокий"
        CRITICAL = "critical", "Критический"

    title = models.CharField("Тема обращения", max_length=160)
    description = models.TextField("Подробное описание")
    category = models.ForeignKey(
        Category,
        verbose_name="Категория",
        related_name="tickets",
        on_delete=models.PROTECT,
    )
    status = models.CharField(
        "Статус", max_length=20, choices=Status.choices, default=Status.NEW
    )
    priority = models.CharField(
        "Приоритет", max_length=20, choices=Priority.choices, default=Priority.MEDIUM
    )
    author_name = models.CharField("Имя заявителя", max_length=80)
    author_email = models.EmailField("E-mail заявителя")
    author_phone = models.CharField("Телефон заявителя", max_length=32, blank=True)
    assignee = models.CharField("Ответственный инженер", max_length=80, blank=True)
    created_at = models.DateTimeField("Создана", default=timezone.now)
    updated_at = models.DateTimeField("Обновлена", auto_now=True)

    class Meta:
        verbose_name = "Заявка"
        verbose_name_plural = "Заявки"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"#{self.pk} {self.title}"

    def to_dict(self) -> dict:
        """Сериализация заявки в простой словарь для JSON-API.

        Возвращаемые поля используются Vue-приложением напрямую без
        дополнительной нормализации.
        """
        return {
            "id": self.pk,
            "title": self.title,
            "description": self.description,
            "category": self.category.to_dict() if self.category_id else None,
            "status": self.status,
            "status_label": self.get_status_display(),
            "priority": self.priority,
            "priority_label": self.get_priority_display(),
            "author_name": self.author_name,
            "author_email": self.author_email,
            "author_phone": self.author_phone,
            "assignee": self.assignee,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
