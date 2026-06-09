"""Регистрация моделей Service Desk в админке."""

from django.contrib import admin

from .models import Category, Ticket


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "color")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "category", "status", "priority", "created_at")
    list_filter = ("status", "priority", "category")
    search_fields = ("title", "description", "author_name", "author_email")
    readonly_fields = ("created_at", "updated_at")
