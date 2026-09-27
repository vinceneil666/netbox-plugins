from netbox.api.routers import NetBoxRouter

from . import views

router = NetBoxRouter()
router.APIRootView = views.PrefixPlannerRootView
router.register("customers", views.CustomerProvisioningViewSet)

urlpatterns = router.urls
