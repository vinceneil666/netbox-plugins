from django.db import migrations, models

LEGACY_NOTE = "VRF created by Prefix Planner before 0.4.0, which gave every customer its own VRF."


def mark_legacy_vrfs(apps, schema_editor):
    """Plans that already have a VRF keep using it on re-runs."""
    Plan = apps.get_model("netbox_prefix_planner", "CustomerProvisioning")
    Plan.objects.filter(vrf__isnull=False).update(use_vrf=True, vrf_note=LEGACY_NOTE)


class Migration(migrations.Migration):
    """Use a VRF per tenant only while NetBox's ENFORCE_GLOBAL_UNIQUE is on, and record why."""

    dependencies = [
        ("netbox_prefix_planner", "0002_tenant_select"),
    ]

    operations = [
        migrations.AddField(
            model_name="customerprovisioning",
            name="use_vrf",
            field=models.BooleanField(
                default=False, editable=False,
                help_text="Provision into a VRF named after the tenant instead of the global table"),
        ),
        migrations.AddField(
            model_name="customerprovisioning",
            name="vrf_note",
            field=models.CharField(blank=True, editable=False, help_text="Why the plan uses a VRF", max_length=300),
        ),
        migrations.RunPython(mark_legacy_vrfs, migrations.RunPython.noop),
    ]
