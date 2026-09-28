from django.core.exceptions import ValidationError
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.routers import APIRootView

from core.api.serializers import JobSerializer
from netbox.api.viewsets import NetBoxModelViewSet

from .. import filtersets
from ..allocation import allocate
from ..jobs import ProvisionCustomerJob
from ..models import CustomerProvisioning
from .serializers import CustomerProvisioningSerializer, PlanPreviewSerializer, api_errors, serialize_allocation


class PrefixPlannerRootView(APIRootView):
    def get_view_name(self):
        return "Prefix Planner"


class CustomerProvisioningViewSet(NetBoxModelViewSet):
    queryset = CustomerProvisioning.objects.select_related("tenant", "vrf").prefetch_related("tags")
    serializer_class = CustomerProvisioningSerializer
    filterset_class = filtersets.CustomerProvisioningFilterSet

    @extend_schema(
        request=PlanPreviewSerializer,
        responses={200: OpenApiTypes.OBJECT, 400: OpenApiResponse(description="The plan does not fit")},
        description="Dry run: allocate a plan without saving anything or creating objects.",
    )
    @action(detail=False, methods=["post"])
    def preview(self, request):
        data = PlanPreviewSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        plan = data.validated_data.get("plan") or []
        count = data.validated_data.get("prefix_count") or len(plan) or 6
        # Run the same plan validation as a real tenant plan, on an instance that is never saved
        candidate = CustomerProvisioning(
            tenant_name="preview", prefix=data.validated_data["prefix"], segment_count=count, segment_plan=plan,
        )
        try:
            candidate.clean_plan()
        except ValidationError as e:
            return Response(api_errors(e.message_dict), status=status.HTTP_400_BAD_REQUEST)
        rows, unused = allocate(candidate.prefix, candidate.get_plan())
        parent = candidate.prefix
        used = sum(row["network"].size for row in rows if row["network"])
        return Response({
            "prefix": str(parent),
            "prefix_count": count,
            "allocated_percent": round(used * 100 / parent.size, 2),
            **serialize_allocation(rows, unused),
        })

    @extend_schema(request=None, responses={202: JobSerializer})
    @action(detail=True, methods=["post"])
    def run(self, request, pk=None):
        """Queue the (idempotent) provisioning job again."""
        if not request.user.has_perm("netbox_prefix_planner.change_customerprovisioning"):
            raise PermissionDenied("You need permission to change tenant plans to run provisioning.")
        plan = self.get_object()
        job = ProvisionCustomerJob.enqueue(instance=plan, user=request.user)
        return Response(JobSerializer(job, context={"request": request}).data, status=status.HTTP_202_ACCEPTED)
