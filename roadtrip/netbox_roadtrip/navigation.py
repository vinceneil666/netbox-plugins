from netbox.plugins import PluginMenu, PluginMenuItem

menu = PluginMenu(
    label="Road Trip",
    groups=(
        ("Road Trip", (
            PluginMenuItem(link="plugins:netbox_roadtrip:drive", link_text="Drive"),
        )),
    ),
    icon_class="mdi mdi-car-side",
)
