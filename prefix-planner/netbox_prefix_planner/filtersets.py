import django_filters
from django.db.models import Q

from netbox.filtersets import NetBoxModelFilterSet

from .choices import ProvisioningStatusChoices
from .models import CustomerProvisioning


class CustomerProvisioningFilterSet(NetBoxModelFilterSet):
    status = django_filters.MultipleChoiceFilter(choices=ProvisioningStatusChoices)

    class Meta:
        model = CustomerProvisioning
        fields = ("id", "tenant_name", "segment_count", "tenant", "vrf")

    def search(self, queryset, name, value):
        if not value.strip():
            return queryset
        return queryset.filter(Q(tenant_name__icontains=value) | Q(comments__icontains=value))
