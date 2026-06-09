"""Представления Service Desk.

В проекте сознательно не используется Django REST Framework: упор курсовой —
на клиентскую часть, поэтому JSON-API реализован вручную поверх JsonResponse.
Это позволяет показать прозрачную работу с fetch() и состояниями загрузки/ошибок.
"""

from __future__ import annotations

import json
from typing import Any

from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .models import Category, Ticket


def index(request: HttpRequest) -> HttpResponse:
    """Главная страница — рендерит шаблон, который подключает Vue-приложение."""
    return render(request, "tickets/index.html")


def _parse_json(request: HttpRequest) -> dict[str, Any]:
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _validate_ticket_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    """Server-side валидация: дублирует клиентскую, чтобы не доверять браузеру.

    Возвращает (очищенные данные, словарь ошибок). Ошибки пустые — значит ок.
    """
    errors: dict[str, str] = {}
    cleaned: dict[str, Any] = {}

    title = str(payload.get("title", "")).strip()
    if len(title) < 5:
        errors["title"] = "Тема должна содержать минимум 5 символов."
    elif len(title) > 160:
        errors["title"] = "Тема не может быть длиннее 160 символов."
    cleaned["title"] = title

    description = str(payload.get("description", "")).strip()
    if len(description) < 10:
        errors["description"] = "Опишите проблему подробнее (минимум 10 символов)."
    cleaned["description"] = description

    category_id = payload.get("category_id")
    try:
        category = Category.objects.get(pk=int(category_id))
    except (Category.DoesNotExist, TypeError, ValueError):
        errors["category_id"] = "Выберите корректную категорию."
        category = None
    cleaned["category"] = category

    priority = str(payload.get("priority", "")).strip()
    if priority not in {choice for choice, _ in Ticket.Priority.choices}:
        errors["priority"] = "Некорректный приоритет."
    cleaned["priority"] = priority or Ticket.Priority.MEDIUM

    author_name = str(payload.get("author_name", "")).strip()
    if len(author_name) < 2:
        errors["author_name"] = "Укажите ваше имя."
    cleaned["author_name"] = author_name

    author_email = str(payload.get("author_email", "")).strip()
    if "@" not in author_email or "." not in author_email:
        errors["author_email"] = "Введите корректный e-mail."
    cleaned["author_email"] = author_email

    cleaned["author_phone"] = str(payload.get("author_phone", "")).strip()

    return cleaned, errors


@require_http_methods(["GET"])
def api_categories(request: HttpRequest) -> JsonResponse:
    """Список категорий заявок."""
    data = [cat.to_dict() for cat in Category.objects.all()]
    return JsonResponse({"results": data})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def api_tickets(request: HttpRequest) -> JsonResponse:
    """Коллекция заявок: список (GET) и создание (POST).

    CSRF выключен только для упрощения учебного API. В реальном проекте
    используется CSRF-токен из cookie/шаблона.
    """
    if request.method == "GET":
        queryset = Ticket.objects.select_related("category").all()
        return JsonResponse({"results": [t.to_dict() for t in queryset]})

    payload = _parse_json(request)
    cleaned, errors = _validate_ticket_payload(payload)
    if errors:
        return JsonResponse({"errors": errors}, status=400)

    ticket = Ticket.objects.create(
        title=cleaned["title"],
        description=cleaned["description"],
        category=cleaned["category"],
        priority=cleaned["priority"],
        author_name=cleaned["author_name"],
        author_email=cleaned["author_email"],
        author_phone=cleaned["author_phone"],
    )
    return JsonResponse(ticket.to_dict(), status=201)


@csrf_exempt
@require_http_methods(["GET", "PATCH", "DELETE"])
def api_ticket_detail(request: HttpRequest, ticket_id: int) -> JsonResponse:
    """Операции над одной заявкой."""
    try:
        ticket = Ticket.objects.select_related("category").get(pk=ticket_id)
    except Ticket.DoesNotExist:
        return JsonResponse({"detail": "Заявка не найдена."}, status=404)

    if request.method == "GET":
        return JsonResponse(ticket.to_dict())

    if request.method == "DELETE":
        ticket.delete()
        return JsonResponse({"detail": "Удалено."}, status=200)

    payload = _parse_json(request)
    allowed_status = {choice for choice, _ in Ticket.Status.choices}
    if "status" in payload:
        if payload["status"] not in allowed_status:
            return JsonResponse({"errors": {"status": "Некорректный статус."}}, status=400)
        ticket.status = payload["status"]
    if "assignee" in payload:
        ticket.assignee = str(payload["assignee"]).strip()[:80]
    ticket.save()
    return JsonResponse(ticket.to_dict())
