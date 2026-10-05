from django.urls import path

from . import views

urlpatterns = [
    path("", views.DriveView.as_view(), name="drive"),
]
