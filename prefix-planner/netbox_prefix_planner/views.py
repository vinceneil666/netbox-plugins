from django.contrib import messages
from django.shortcuts import get_object_or_404, redirect

from extras.ui.panels import CustomFieldsPanel, TagsPanel
from netbox.ui import attrs, layout
from netbox.ui.panels import CommentsPanel, ObjectAttributesPanel, ObjectsTablePanel, TemplatePanel
from netbox.views import generic
from utilities.views import register_model_view

from . import filtersets, forms, tables
from .jobs import ProvisionCustomerJob
from .models import CustomerProvisioning


class CustomerProvisioningPanel(ObjectAttributesPanel):
    tenant = attrs.RelatedObjectAttr("tenant", linkify=True)
    prefix = attrs.TextAttr("prefix")
    segment_count = attrs.NumericAttr("segment_count", label="Prefixes")
    create_unused = attrs.BooleanAttr("create_unused", label="Create unused")
    status = attrs.ChoiceAttr("status")
    vrf = attrs.RelatedObjectAttr("vrf", linkify=True, label="VRF")

    def get_context(self, context):
        ctx = super().get_context(context)
        # Only plans provisioned before 0.4.0 have a VRF - don't show an empty row on newer ones
        if ctx["object"].vrf_id is None:
            ctx["attrs"] = [a for a in ctx["attrs"] if a["label"] != "VRF"]
        return ctx


@register_model_view(CustomerProvisioning, "list", path="", detail=False)
class CustomerProvisioningListView(generic.ObjectListView):
    queryset = CustomerProvisioning.objects.select_related("tenant", "vrf")
    table = tables.CustomerProvisioningTable
    filterset = filtersets.CustomerProvisioningFilterSet
    filterset_form = forms.CustomerProvisioningFilterForm


@register_model_view(CustomerProvisioning)
class CustomerProvisioningView(generic.ObjectView):
    queryset = CustomerProvisioning.objects.all()
    layout = layout.SimpleLayout(
        left_panels=[
            CustomerProvisioningPanel(),
            TemplatePanel("netbox_prefix_planner/panels/segment_plan.html", title="Prefix plan"),
            TagsPanel(),
            CommentsPanel(),
        ],
        right_panels=[
            ObjectsTablePanel(
                "ipam.prefix",
                title="Tenant prefixes",
                # 0 matches nothing until the job has created the tenant
                filters={"tenant_id": lambda ctx: ctx["object"].tenant_id or 0},
                include_columns=["prefix", "status", "tenant", "vrf", "utilization", "description"],
            ),
            CustomFieldsPanel(),
        ],
    )


@register_model_view(CustomerProvisioning, "run")
class CustomerProvisioningRunView(generic.ObjectView):
    """Re-enqueue the (idempotent) provisioning job, e.g. after a failure or manual cleanup."""
    queryset = CustomerProvisioning.objects.all()

    def get_required_permission(self):
        return "netbox_prefix_planner.change_customerprovisioning"

    def get(self, request, pk):
        return redirect(get_object_or_404(self.queryset, pk=pk).get_absolute_url())

    def post(self, request, pk):
        obj = get_object_or_404(self.queryset.restrict(request.user, "change"), pk=pk)
        ProvisionCustomerJob.enqueue(instance=obj, user=request.user)
        messages.success(request, f"Provisioning job queued for {obj}.")
        return redirect(obj.get_absolute_url())


@register_model_view(CustomerProvisioning, "add", detail=False)
@register_model_view(CustomerProvisioning, "edit")
class CustomerProvisioningEditView(generic.ObjectEditView):
    queryset = CustomerProvisioning.objects.all()
    form = forms.CustomerProvisioningForm
    template_name = "netbox_prefix_planner/customerprovisioning_edit.html"


@register_model_view(CustomerProvisioning, "delete")
class CustomerProvisioningDeleteView(generic.ObjectDeleteView):
    queryset = CustomerProvisioning.objects.all()


@register_model_view(CustomerProvisioning, "bulk_delete", path="delete", detail=False)
class CustomerProvisioningBulkDeleteView(generic.BulkDeleteView):
    queryset = CustomerProvisioning.objects.all()
    filterset = filtersets.CustomerProvisioningFilterSet
    table = tables.CustomerProvisioningTable
