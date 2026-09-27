import json

from django import forms
from django.template.loader import render_to_string
from django.utils.safestring import mark_safe

from .allocation import MIN_SEGMENT_PREFIXLEN


class InPlannerCheckbox(forms.CheckboxInput):
    """The create_unused checkbox is drawn inside the planner; this widget only reads its value."""

    def render(self, name, value, attrs=None, renderer=None):
        return ""


class SegmentPlannerWidget(forms.Widget):
    """
    Slider UI for sizing the prefixes. Stores the plan as JSON in a hidden input; reads the
    prefix and segment count from the form's own fields (id_prefix / id_segment_count).
    """

    create_unused = False

    def render(self, name, value, attrs=None, renderer=None):
        if isinstance(value, (list, dict)):
            value = json.dumps(value)
        return mark_safe(render_to_string("netbox_prefix_planner/widgets/segment_planner.html", {
            "name": name,
            "value": value or "[]",
            "disabled": bool((attrs or {}).get("disabled") or self.attrs.get("disabled")),
            "min_prefixlen": json.dumps(MIN_SEGMENT_PREFIXLEN),
            "create_unused": self.create_unused,
        }))
