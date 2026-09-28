from django import forms

from ipam.formfields import IPNetworkFormField
from netbox.forms import NetBoxModelFilterSetForm, NetBoxModelForm
from tenancy.models import Tenant
from utilities.forms.fields import CommentField, DynamicModelChoiceField, TagFilterField
from utilities.forms.rendering import FieldSet

from .choices import ProvisioningStatusChoices
from .models import CustomerProvisioning
from .widgets import InPlannerCheckbox, SegmentPlannerWidget


NEW_TENANT = "Add new tenant"


class CustomerProvisioningForm(NetBoxModelForm):
    tenant = DynamicModelChoiceField(
        queryset=Tenant.objects.all(),
        required=False,
        null_option=NEW_TENANT,
        empty_label=None,  # no blank entry, so "Add new tenant" is the default
        label="Tenant",
        help_text="An existing tenant, or \"Add new tenant\" to create one",
    )
    tenant_name = forms.CharField(
        label="New tenant name",
        max_length=100,
        required=False,
        help_text="The tenant to create, e.g. ACME Corp",
    )
    prefix = IPNetworkFormField(label="Prefix", help_text="Address block assigned to the tenant, e.g. 10.20.0.0/16")
    segment_count = forms.IntegerField(
        label="Number of prefixes",
        min_value=1,
        max_value=64,
        initial=6,
        help_text="How many prefixes to carve out of the tenant's block",
    )
    segment_plan = forms.JSONField(
        label="Prefixes",
        required=False,
        widget=SegmentPlannerWidget,
    )
    # Rendered by the planner itself (checkbox in its header), so it sits next to the sliders
    create_unused = forms.BooleanField(required=False, widget=InPlannerCheckbox)
    comments = CommentField()

    fieldsets = (
        FieldSet("tenant", "tenant_name", "prefix", "tags", name="Tenant"),
        FieldSet("segment_count", "segment_plan", name="Prefixes"),
    )

    class Meta:
        model = CustomerProvisioning
        fields = ("tenant", "tenant_name", "prefix", "segment_count", "segment_plan", "create_unused", "comments", "tags")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Tenant/prefix/plan drive what the job created; changing them afterwards would orphan objects
        if self.instance.pk:
            for field in ("tenant", "tenant_name", "prefix", "segment_count", "segment_plan", "create_unused"):
                self.fields[field].disabled = True
            if not self.instance.segment_plan and self.instance.prefix:
                self.initial["segment_plan"] = self.instance.get_plan()

        # The planner draws the unused-space checkbox, so hand it the current value
        if self.is_bound:
            create_unused = self.fields["create_unused"].widget.value_from_datadict(self.data, None, "create_unused")
        else:
            create_unused = self.initial.get("create_unused", self.instance.create_unused)
        self.fields["segment_plan"].widget.create_unused = bool(create_unused)

    def clean_segment_plan(self):
        return self.cleaned_data.get("segment_plan") or []


class CustomerProvisioningFilterForm(NetBoxModelFilterSetForm):
    model = CustomerProvisioning
    status = forms.MultipleChoiceField(choices=ProvisioningStatusChoices, required=False)
    tag = TagFilterField(model)
