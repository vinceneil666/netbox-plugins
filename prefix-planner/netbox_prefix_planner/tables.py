import django_tables2 as tables

from netbox.tables import NetBoxTable, columns

from .models import CustomerProvisioning


class CustomerProvisioningTable(NetBoxTable):
    tenant_name = tables.Column(linkify=True, verbose_name="Tenant")
    prefix = tables.Column()
    segment_count = tables.Column(verbose_name="Prefixes")
    status = columns.ChoiceFieldColumn()
    tenant = tables.Column(linkify=True, verbose_name="NetBox tenant")
    vrf = tables.Column(linkify=True, verbose_name="VRF")
    tags = columns.TagColumn(url_name="plugins:netbox_prefix_planner:customerprovisioning_list")

    class Meta(NetBoxTable.Meta):
        model = CustomerProvisioning
        fields = ("pk", "id", "tenant_name", "prefix", "segment_count", "status", "tenant", "vrf",
                  "tags", "created", "last_updated")
        default_columns = ("tenant_name", "prefix", "segment_count", "status")
