from django.urls import include, path

from utilities.urls import get_model_urls

from . import views  # noqa: F401  (registers the model views)

urlpatterns = (
    path("tenants/", include(get_model_urls("netbox_prefix_planner", "customerprovisioning", detail=False))),
    path("tenants/<int:pk>/", include(get_model_urls("netbox_prefix_planner", "customerprovisioning"))),
)
