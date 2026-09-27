from django.db import transaction
from django.utils.text import slugify

from ipam.choices import PrefixStatusChoices
from ipam.models import VRF, Prefix
from netbox.jobs import JobRunner
from netbox.plugins import get_plugin_config
from tenancy.models import Tenant

from .choices import ProvisioningStatusChoices


class ProvisionCustomerJob(JobRunner):
    """
    Create (or bring up to date) the tenant, VRF, customer container prefix and seg1..segN containers.
    Safe to re-run: existing objects are reused, never duplicated.
    """

    class Meta:
        name = "Provision customer"

    def run(self, *args, **kwargs):
        obj = self.job.object
        obj.status = ProvisioningStatusChoices.RUNNING
        obj.save()
        try:
            with transaction.atomic():
                self.provision(obj)
        except Exception:
            obj.status = ProvisioningStatusChoices.FAILED
            obj.save()
            raise
        obj.status = ProvisioningStatusChoices.COMPLETED
        obj.save()

    def provision(self, obj):
        name = obj.customer_name
        # Attach to an existing tenant with this name (any slug) before falling back to creating one
        tenant = Tenant.objects.filter(name__iexact=name).first() or Tenant.objects.filter(slug=slugify(name)).first()
        created = tenant is None
        if created:
            tenant = Tenant(name=name, slug=slugify(name))
            tenant.full_clean()
            tenant.save()
        self.logger.info(f"Tenant {tenant} {'created' if created else 'already exists - attaching to it'}")

        vrf = None
        if get_plugin_config("netbox_prefix_planner", "vrf_per_customer"):
            vrf, created = VRF.objects.get_or_create(
                name=name, defaults={"tenant": tenant, "enforce_unique": True}
            )
            self.logger.info(f"VRF {vrf} {'created' if created else 'already exists'}")
        else:
            # Shared global table: refuse to overlap another tenant's space
            clash = Prefix.objects.filter(vrf__isnull=True, prefix__net_overlap=obj.prefix).exclude(tenant=tenant)
            if clash.exists():
                raise ValueError(f"{obj.prefix} overlaps existing global prefix(es): "
                                 f"{', '.join(str(p.prefix) for p in clash[:5])}")

        self.ensure_container(obj.prefix, vrf, tenant, f"{name} address block")
        for row in obj.planned_segments:
            if row["network"] is None:
                self.logger.info(f"{row['name']}: out of scope, not created")
                continue
            self.ensure_container(row["network"], vrf, tenant, row["name"])
        if obj.create_unused:
            for network in obj.unused_prefixes:
                self.ensure_container(network, vrf, tenant, "unused")

        obj.tenant, obj.vrf = tenant, vrf

    def ensure_container(self, prefix, vrf, tenant, description):
        pfx = Prefix.objects.filter(prefix=str(prefix), vrf=vrf).first()
        if pfx is None:
            pfx = Prefix(prefix=str(prefix), vrf=vrf)
            action = "created"
        elif pfx.tenant_id not in (None, tenant.pk):
            raise ValueError(f"{prefix} already exists and belongs to tenant {pfx.tenant}")
        else:
            action = "updated"
        pfx.tenant = tenant
        pfx.status = PrefixStatusChoices.STATUS_CONTAINER
        pfx.description = description
        pfx.full_clean()
        pfx.save()
        self.logger.info(f"{description}: {prefix} {action}")
