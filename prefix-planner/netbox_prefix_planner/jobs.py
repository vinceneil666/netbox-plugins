from django.db import transaction
from django.utils.text import slugify

from ipam.choices import PrefixStatusChoices
from ipam.models import Prefix
from netbox.jobs import JobRunner
from tenancy.models import Tenant

from .choices import ProvisioningStatusChoices


class ProvisionCustomerJob(JobRunner):
    """
    Create (or bring up to date) the tenant, the tenant's container prefix and one container per planned prefix.
    Safe to re-run: existing objects are reused, never duplicated.
    """

    class Meta:
        name = "Provision tenant"

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
        tenant = obj.tenant
        if tenant is None:
            name = obj.tenant_name
            # A tenant with this name may have appeared since the plan was saved - attach to it then
            tenant = (Tenant.objects.filter(name__iexact=name).first()
                      or Tenant.objects.filter(slug=slugify(name)).first())
            created = tenant is None
            if created:
                tenant = Tenant(name=name, slug=slugify(name))
                tenant.full_clean()
                tenant.save()
            self.logger.info(f"Tenant {tenant} {'created' if created else 'already exists - attaching to it'}")
        else:
            self.logger.info(f"Using existing tenant {tenant}")

        # Plans from before 0.4.0 keep the VRF they were provisioned in; new plans use the global table
        vrf = obj.vrf
        name = tenant.name

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
        # Another tenant may have the same network; only update this tenant's own prefix, or claim an unowned one.
        # A duplicate is then created - NetBox's full_clean() refuses it while ENFORCE_GLOBAL_UNIQUE is on.
        existing = Prefix.objects.filter(prefix=str(prefix), vrf=vrf)
        pfx = existing.filter(tenant=tenant).first() or existing.filter(tenant__isnull=True).first()
        if pfx is None:
            pfx = Prefix(prefix=str(prefix), vrf=vrf)
            action = "created"
        else:
            action = "updated"
        pfx.tenant = tenant
        pfx.status = PrefixStatusChoices.STATUS_CONTAINER
        pfx.description = description
        pfx.full_clean()
        pfx.save()
        self.logger.info(f"{description}: {prefix} {action}")
