"""Маршруты приложения tickets."""

from django.urls import path

from . import views

app_name = "tickets"

urlpatterns = [
    path("", views.index, name="index"),
    path("api/categories/", views.api_categories, name="api-categories"),
    path("api/tickets/", views.api_tickets, name="api-tickets"),
    path("api/tickets/<int:ticket_id>/", views.api_ticket_detail, name="api-ticket-detail"),
]
