from netbox.plugins import PluginConfig

__version__ = "0.1.0"


class RoadTripConfig(PluginConfig):
    name = "netbox_roadtrip"
    verbose_name = "Road Trip"
    description = "Just for fun: drive a car through a city made of your tenants, sites and devices"
    version = __version__
    base_url = "roadtrip"
    min_version = "4.7.0"
    default_settings = {
        # At most this many devices are placed in the city
        "max_devices": 500,
    }


config = RoadTripConfig
