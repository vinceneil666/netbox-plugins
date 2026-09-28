import django.db.models.deletion
from django.db import migrations, models

import ipam.fields


class Migration(migrations.Migration):
    """0.4.0: customers become tenants - pick an existing tenant or name a new one; no more VRF per tenant."""

    dependencies = [
        ("netbox_prefix_planner", "0001_initial"),
    ]

    operations = [
        migrations.RenameField("customerprovisioning", "customer_name", "tenant_name"),
        migrations.AlterField(
            model_name="customerprovisioning",
            name="tenant_name",
            field=models.CharField(blank=True, help_text="Name of the tenant to create, e.g. ACME Corp",
                                   max_length=100),
        ),
        migrations.AlterField(
            model_name="customerprovisioning",
            name="prefix",
            field=ipam.fields.IPNetworkField(
                help_text="Address block assigned to the tenant, e.g. 10.20.0.0/16"),
        ),
        migrations.AlterField(
            model_name="customerprovisioning",
            name="segment_count",
            field=models.PositiveSmallIntegerField(default=6,
                                                   help_text="Number of prefixes to carve out of the tenant's block"),
        ),
        migrations.AlterField(
            model_name="customerprovisioning",
            name="tenant",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                    related_name="+", to="tenancy.tenant"),
        ),
        migrations.AlterModelOptions(
            name="customerprovisioning",
            options={"ordering": ("tenant_name", "prefix"), "verbose_name": "tenant",
                     "verbose_name_plural": "tenants"},
        ),
    ]
