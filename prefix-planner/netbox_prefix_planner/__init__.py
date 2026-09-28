from netbox.plugins import PluginConfig

__version__ = "0.3.0"


class PrefixPlannerConfig(PluginConfig):
    name = "netbox_prefix_planner"
    verbose_name = "Prefix Planner"
    description = "Plan a customer's address block with sliders and provision tenant, VRF and prefixes in one go"
    version = __version__
    base_url = "prefix-planner"
    min_version = "4.7.0"
    default_settings = {
        # Put each customer in its own VRF (MSP customers overlap RFC1918 space)
        "vrf_per_customer": True,
    }

    def ready(self):
        super().ready()
        from . import signals  # noqa: F401


config = PrefixPlannerConfig
