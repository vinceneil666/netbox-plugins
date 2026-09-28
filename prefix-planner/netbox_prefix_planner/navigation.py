from netbox.plugins import PluginMenuButton, PluginMenuItem

menu_items = (
    PluginMenuItem(
        link="plugins:netbox_prefix_planner:customerprovisioning_list",
        link_text="Tenants",
        permissions=["netbox_prefix_planner.view_customerprovisioning"],
        buttons=(
            PluginMenuButton(
                link="plugins:netbox_prefix_planner:customerprovisioning_add",
                title="Add",
                icon_class="mdi mdi-plus-thick",
                permissions=["netbox_prefix_planner.add_customerprovisioning"],
            ),
        ),
    ),
)
