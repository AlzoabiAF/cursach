"""WSGI-конфигурация проекта Service Desk."""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "servicedesk.settings")

application = get_wsgi_application()
