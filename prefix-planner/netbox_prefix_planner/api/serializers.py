from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from ipam.api.field_serializers import IPNetworkField
from ipam.api.serializers import VRFSerializer
from netbox.api.fields import ChoiceField
from netbox.api.serializers import NetBoxModelSerializer
from tenancy.api.serializers import TenantSerializer

from ..allocation import allocate
from ..choices import ProvisioningStatusChoices
from ..models import CustomerProvisioning

# These define what the provisioning job created, so they can't change afterwards (same as the UI)
IMMUTABLE_FIELDS = ("customer_name", "prefix", "segment_count", "segment_plan", "create_unused")

# Model field -> API field, for error messages raised by the model's clean()
API_NAMES = {"segment_count": "prefix_count", "segment_plan": "plan"}


def api_errors(errors):
    """Rename model field keys in a {field: [messages]} dict to the names API users send."""
    return {API_NAMES.get(field, field): messages for field, messages in errors.items()}

PLAN_ROW_KEYS = {"name": str, "prefixlen": int, "in_scope": bool, "locked": bool, "fixed": str}


def validate_plan_rows(plan):
    """Shape check before the model's clean() does the address arithmetic."""
    if not isinstance(plan, list):
        raise serializers.ValidationError("Must be a list of prefix rows.")
    for i, row in enumerate(plan, start=1):
        if not isinstance(row, dict):
            raise serializers.ValidationError(f"Row {i}: must be an object.")
        unknown = set(row) - set(PLAN_ROW_KEYS)
        if unknown:
            raise serializers.ValidationError(f"Row {i}: unknown key(s) {', '.join(sorted(unknown))}.")
        for key in ("name", "prefixlen"):
            if key not in row:
                raise serializers.ValidationError(f"Row {i}: '{key}' is required.")
        for key, kind in PLAN_ROW_KEYS.items():
            # bool is a subclass of int - don't accept true/false as a prefix length
            if key in row and (not isinstance(row[key], kind) or (kind is int and isinstance(row[key], bool))):
                raise serializers.ValidationError(f"Row {i}: '{key}' must be of type {kind.__name__}.")
    # in_scope defaults to true, locked to false
    return [{"in_scope": True, "locked": False, **row} for row in plan]


def serialize_allocation(rows, unused):
    return {
        "prefixes": [
            {
                "name": row["name"],
                "prefixlen": row["prefixlen"],
                "in_scope": bool(row.get("in_scope")),
                "locked": bool(row.get("locked")),
                "network": str(row["network"]) if row["network"] else None,
                "first_host": str(row["first_host"]) if row["network"] else None,
                "last_host": str(row["last_host"]) if row["network"] else None,
            }
            for row in rows
        ],
        "unused": [str(network) for network in unused],
    }


class CustomerProvisioningSerializer(NetBoxModelSerializer):
    prefix = IPNetworkField(help_text="Address block assigned to the customer, e.g. 10.20.0.0/16")
    prefix_count = serializers.IntegerField(
        source="segment_count", required=False, min_value=1, max_value=64,
        help_text="Number of prefixes to carve out. Defaults to the number of plan rows, or 6.",
    )
    plan = serializers.JSONField(
        source="segment_plan", required=False,
        help_text="Optional list of {name, prefixlen, in_scope, locked, fixed}. Omit for an equal split "
                  "(names seg1..segN). Locked in-scope rows must give their pinned network in 'fixed'.",
    )
    status = ChoiceField(choices=ProvisioningStatusChoices, read_only=True)
    tenant = TenantSerializer(nested=True, read_only=True)
    vrf = VRFSerializer(nested=True, read_only=True)
    allocation = serializers.SerializerMethodField(
        help_text="Where each planned prefix lands, plus the unused space",
    )

    class Meta:
        model = CustomerProvisioning
        fields = [
            "id", "url", "display_url", "display", "customer_name", "prefix", "prefix_count", "plan",
            "create_unused", "status", "tenant", "vrf", "allocation", "comments", "tags", "custom_fields",
            "created", "last_updated",
        ]
        brief_fields = ("id", "url", "display", "customer_name", "prefix", "status")

    def validate_plan(self, value):
        return validate_plan_rows(value)

    def validate(self, data):
        if self.instance is not None:
            for field in IMMUTABLE_FIELDS:
                if field in data and data[field] != getattr(self.instance, field):
                    raise serializers.ValidationError({API_NAMES.get(field, field): "Can't be changed after the "
                                                                                    "customer is created."})
        elif "segment_plan" in data and "segment_count" not in data:
            data["segment_count"] = len(data["segment_plan"]) or 6
        try:
            return super().validate(data)
        except DjangoValidationError as e:
            # raised by the model's clean() via full_clean()
            raise serializers.ValidationError(api_errors(e.message_dict) if hasattr(e, "error_dict") else e.messages)

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_allocation(self, obj):
        if not obj.prefix:
            return None
        return serialize_allocation(*allocate(obj.prefix, obj.get_plan()))


class PlanPreviewSerializer(serializers.Serializer):
    """Input for the dry-run endpoint: same planning fields as a customer, nothing is saved."""
    prefix = IPNetworkField()
    prefix_count = serializers.IntegerField(required=False, min_value=1, max_value=64)
    plan = serializers.JSONField(required=False)

    def validate_plan(self, value):
        return validate_plan_rows(value)
