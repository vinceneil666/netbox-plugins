import math

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.urls import reverse

from django.utils.text import slugify

from ipam.fields import IPNetworkField
from netbox.models import NetBoxModel
from netbox.models.features import JobsMixin

from .allocation import MIN_SEGMENT_PREFIXLEN, AllocationError, allocate, default_plan
from .choices import ProvisioningStatusChoices


def overlapping(prefix):
    """Filter for prefix fields that overlap `prefix` (inside it, or containing it)."""
    return Q(prefix__net_contained_or_equal=prefix) | Q(prefix__net_contains=prefix)


class CustomerProvisioning(JobsMixin, NetBoxModel):
    """A tenant's address block and its prefix plan (shown as a "tenant" in the UI)."""
    tenant_name = models.CharField(
        max_length=100,
        blank=True,
        help_text="Name of the tenant to create, e.g. ACME Corp",
    )
    prefix = IPNetworkField(
        help_text="Address block assigned to the tenant, e.g. 10.20.0.0/16",
    )
    segment_count = models.PositiveSmallIntegerField(
        default=6,
        help_text="Number of prefixes to carve out of the tenant's block",
    )
    segment_plan = models.JSONField(
        default=list,
        blank=True,
        help_text="Per-prefix name, size, scope and lock, set with the planner",
    )
    create_unused = models.BooleanField(
        default=False,
        help_text="Also create container prefixes (description 'unused') for the space no prefix uses",
    )
    status = models.CharField(
        max_length=20,
        choices=ProvisioningStatusChoices,
        default=ProvisioningStatusChoices.PENDING,
        editable=False,
    )
    # Chosen in the form, or set by the job when it creates the tenant named tenant_name
    tenant = models.ForeignKey(
        to="tenancy.Tenant",
        on_delete=models.SET_NULL,
        related_name="+",
        blank=True,
        null=True,
    )
    # Only set on plans provisioned before 0.4.0, which created a VRF per tenant
    vrf = models.ForeignKey(
        to="ipam.VRF",
        on_delete=models.SET_NULL,
        related_name="+",
        blank=True,
        null=True,
        editable=False,
    )
    comments = models.TextField(blank=True)

    class Meta:
        ordering = ("tenant_name", "prefix")
        verbose_name = "tenant"
        verbose_name_plural = "tenants"

    def __str__(self):
        return f"{self.tenant_name} – {self.prefix}" if self.prefix else self.tenant_name

    def get_absolute_url(self):
        return reverse("plugins:netbox_prefix_planner:customerprovisioning", args=[self.pk])

    def get_status_color(self):
        return ProvisioningStatusChoices.colors.get(self.status)

    def clean(self):
        super().clean()
        self.clean_plan()
        if self.pk is None:
            self.clean_tenant()

    def clean_tenant(self):
        """New plans: an existing tenant, or the name of one to create; the block must be free in the global table."""
        from ipam.models import Prefix
        from tenancy.models import Tenant

        if self.tenant:
            self.tenant_name = self.tenant.name
        else:
            self.tenant_name = (self.tenant_name or "").strip()
            if not self.tenant_name:
                raise ValidationError({"tenant_name": "Enter a name for the new tenant, or choose an existing one."})
            existing = (Tenant.objects.filter(name__iexact=self.tenant_name).first()
                        or Tenant.objects.filter(slug=slugify(self.tenant_name)).first())
            if existing:
                raise ValidationError({"tenant_name": f"Tenant {existing} already exists - choose it in the "
                                                      f"Tenant list instead."})
        if not self.prefix:
            return
        clash = Prefix.objects.filter(overlapping(self.prefix), vrf__isnull=True, tenant__isnull=False)
        if self.tenant:
            clash = clash.exclude(tenant=self.tenant)
        if clash.exists():
            raise ValidationError({"prefix": "Overlaps prefixes of another tenant: " + ", ".join(
                f"{p.prefix} ({p.tenant})" for p in clash.select_related("tenant")[:5])})
        planned = CustomerProvisioning.objects.filter(overlapping(self.prefix), vrf__isnull=True)
        if planned.exists():
            raise ValidationError({"prefix": "Overlaps the block of another plan: " + ", ".join(
                str(p) for p in planned[:5])})

    def clean_plan(self):
        """Address arithmetic only - also used by the API's dry run."""
        if not self.prefix:
            return
        if self.prefix.ip != self.prefix.network:
            raise ValidationError({"prefix": f"Not a network address - did you mean {self.prefix.cidr}?"})
        if not 1 <= self.segment_count <= 64:
            raise ValidationError({"segment_count": "Must be between 1 and 64."})
        min_len = MIN_SEGMENT_PREFIXLEN[self.prefix.version]
        if self.prefix.prefixlen >= min_len:
            raise ValidationError({"prefix": f"Too small to split (prefixes are /{min_len} or larger)."})

        if not self.segment_plan:
            needed = math.ceil(math.log2(self.segment_count)) if self.segment_count > 1 else 0
            if self.prefix.prefixlen + needed > min_len:
                raise ValidationError({"prefix": f"Too small to split into {self.segment_count} prefixes."})
            return

        # Validate a plan coming from the planner - never trust the browser's arithmetic
        plan = self.segment_plan
        if len(plan) != self.segment_count:
            raise ValidationError({"segment_plan": f"Plan has {len(plan)} rows, expected {self.segment_count}."})
        names = [str(row.get("name") or "").strip() for row in plan]
        if not all(names):
            raise ValidationError({"segment_plan": "Every prefix needs a name."})
        if any(len(n) > 100 for n in names):
            raise ValidationError({"segment_plan": "Prefix names can be at most 100 characters."})
        if len({n.lower() for n in names}) != len(names):
            raise ValidationError({"segment_plan": "Prefix names must be unique."})
        for row, name in zip(plan, names):
            row["name"] = name
        for row in plan:
            length = row.get("prefixlen")
            if not isinstance(length, int) or not self.prefix.prefixlen < length <= min_len:
                raise ValidationError({"segment_plan": f"{row.get('name')}: size /{length} must be between "
                                                       f"/{self.prefix.prefixlen + 1} and /{min_len}."})
            if row.get("locked") and row.get("in_scope") and not row.get("fixed"):
                raise ValidationError({"segment_plan": f"{row['name']}: locked without a network."})
        if not any(row.get("in_scope") for row in plan):
            raise ValidationError({"segment_plan": "At least one prefix must be in scope."})
        try:
            allocate(self.prefix, plan)
        except (AllocationError, ValueError) as e:
            raise ValidationError({"segment_plan": str(e)})

    def get_plan(self):
        """The plan to provision: the saved planner plan, or the equal split for records created without one."""
        return self.segment_plan or default_plan(self.prefix, self.segment_count)

    @property
    def planned_segments(self):
        return allocate(self.prefix, self.get_plan())[0] if self.prefix else []

    @property
    def unused_prefixes(self):
        """Free space left by the plan, as the fewest aligned prefixes (created only with create_unused)."""
        return allocate(self.prefix, self.get_plan())[1] if self.prefix else []
