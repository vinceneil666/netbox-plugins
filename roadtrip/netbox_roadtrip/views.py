from django.contrib.auth.mixins import LoginRequiredMixin
from django.shortcuts import render
from django.views.generic import View
from netbox.plugins import get_plugin_config

from dcim.models import Device, Site
from ipam.models import Prefix
from tenancy.models import Tenant


def world(user):
    """The tenants, sites and devices the user may see - the city is built from these in the browser."""
    limit = get_plugin_config("netbox_roadtrip", "max_devices")
    bird_count = get_plugin_config("netbox_roadtrip", "max_prefixes")
    tenants = [
        {"id": t.pk, "name": t.name, "url": t.get_absolute_url(), "group": str(t.group or "")}
        for t in Tenant.objects.restrict(user, "view").select_related("group").order_by("name")
    ]
    sites = [
        {"id": s.pk, "name": s.name, "url": s.get_absolute_url(), "status": s.status,
         "status_label": s.get_status_display(), "tenant": s.tenant_id, "region": str(s.region or "")}
        for s in Site.objects.restrict(user, "view").select_related("region").order_by("name")
    ]
    devices = []
    queryset = (Device.objects.restrict(user, "view")
                .select_related("role", "tenant", "site", "device_type__manufacturer", "primary_ip4", "primary_ip6")
                .order_by("name", "pk"))
    total = queryset.count()
    for d in queryset[:limit]:
        primary_ip = d.primary_ip4 or d.primary_ip6
        devices.append({
            "id": d.pk,
            "name": d.name or str(d),
            "url": d.get_absolute_url(),
            "tenant": d.tenant_id,
            "site": d.site.name if d.site_id else "",
            "role": d.role.name if d.role_id else "",
            "color": d.role.color if d.role_id else "9e9e9e",
            "type": f"{d.device_type.manufacturer.name} {d.device_type.model}",
            "status": d.status,
            "status_label": d.get_status_display(),
            "ip": str(primary_ip.address.ip) if primary_ip else "",
        })
    # A random handful of prefixes - they fly around as birds when the car jumps
    prefixes = [str(p) for p in Prefix.objects.restrict(user, "view").order_by("?")
                .values_list("prefix", flat=True)[:bird_count]]
    return {"tenants": tenants, "sites": sites, "devices": devices, "total_devices": total, "limit": limit,
            "prefixes": prefixes}


class DriveView(LoginRequiredMixin, View):
    template_name = "netbox_roadtrip/drive.html"

    def get(self, request):
        return render(request, self.template_name, {"world": world(request.user)})
