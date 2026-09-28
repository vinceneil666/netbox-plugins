from netbox.plugins import PluginConfig

__version__ = "0.5.0"


class PrefixPlannerConfig(PluginConfig):
    name = "netbox_prefix_planner"
    verbose_name = "Prefix Planner"
    description = "Plan a tenant's address block with sliders and provision the tenant and its prefixes in one go"
    version = __version__
    base_url = "prefix-planner"
    min_version = "4.7.0"

    def ready(self):
        super().ready()
        from . import signals  # noqa: F401


config = PrefixPlannerConfig
