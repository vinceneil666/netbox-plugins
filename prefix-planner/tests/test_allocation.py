"""
Tests for the prefix allocator. allocation.py has no NetBox imports, so it is loaded straight
from its file - run with `pip install pytest netaddr && pytest` from the prefix-planner directory.
"""
import importlib.util
from pathlib import Path

import pytest
from netaddr import IPNetwork, IPSet

_spec = importlib.util.spec_from_file_location(
    "allocation", Path(__file__).parents[1] / "netbox_prefix_planner" / "allocation.py"
)
allocation = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(allocation)
allocate, default_plan, host_range = allocation.allocate, allocation.default_plan, allocation.host_range
AllocationError = allocation.AllocationError

PARENT = IPNetwork("10.20.0.0/16")


def row(name, prefixlen, in_scope=True, locked=False, fixed=None):
    r = {"name": name, "prefixlen": prefixlen, "in_scope": in_scope, "locked": locked}
    if fixed:
        r["fixed"] = fixed
    return r


def assert_tiles_parent(rows, unused, parent=PARENT):
    """Placed prefixes + unused blocks never overlap and cover the parent exactly."""
    seen = IPSet()
    for net in [r["network"] for r in rows if r["network"]] + unused:
        assert not (IPSet([net]) & seen), f"{net} overlaps"
        assert net in parent
        seen.add(net)
    assert seen == IPSet([parent])


def test_default_plan_six_is_an_eight_way_split():
    plan = default_plan(PARENT, 6)
    assert [r["prefixlen"] for r in plan] == [19] * 6
    rows, unused = allocate(PARENT, plan)
    assert [str(r["network"]) for r in rows] == [
        "10.20.0.0/19", "10.20.32.0/19", "10.20.64.0/19", "10.20.96.0/19", "10.20.128.0/19", "10.20.160.0/19",
    ]
    assert [str(u) for u in unused] == ["10.20.192.0/18"]      # the two spare /19s merged
    assert_tiles_parent(rows, unused)


def test_largest_first_keeps_blocks_aligned():
    plan = [row("a", 20), row("b", 17), row("c", 19), row("d", 18)]
    rows, unused = allocate(PARENT, plan)
    nets = {r["name"]: str(r["network"]) for r in rows}
    assert nets == {"b": "10.20.0.0/17", "d": "10.20.128.0/18", "c": "10.20.192.0/19", "a": "10.20.224.0/20"}
    assert [str(u) for u in unused] == ["10.20.240.0/20"]
    assert_tiles_parent(rows, unused)


def test_out_of_scope_rows_get_no_network():
    rows, unused = allocate(PARENT, [row("a", 17), row("b", 17, in_scope=False)])
    assert rows[1]["network"] is None
    assert [str(u) for u in unused] == ["10.20.128.0/17"]


def test_locked_rows_keep_their_exact_network():
    plan = [
        row("mgmt", 18, locked=True, fixed="10.20.64.0/18"),
        row("clients", 19, locked=True, fixed="10.20.192.0/19"),
        row("voice", 18), row("servers", 20), row("guest", 22),
    ]
    rows, unused = allocate(PARENT, plan)
    nets = {r["name"]: str(r["network"]) for r in rows}
    assert nets["mgmt"] == "10.20.64.0/18"
    assert nets["clients"] == "10.20.192.0/19"
    assert_tiles_parent(rows, unused)


def test_fragmentation_is_detected_even_when_total_size_fits():
    # .64/18 and .192/19 are pinned: 37.5% used, but no aligned /17 is left anywhere
    plan = [
        row("mgmt", 18, locked=True, fixed="10.20.64.0/18"),
        row("clients", 19, locked=True, fixed="10.20.192.0/19"),
        row("big", 17),
    ]
    with pytest.raises(AllocationError, match="does not fit"):
        allocate(PARENT, plan)


def test_overlapping_locked_rows_are_rejected():
    plan = [row("a", 18, locked=True, fixed="10.20.64.0/18"), row("b", 19, locked=True, fixed="10.20.64.0/19")]
    with pytest.raises(AllocationError, match="overlaps"):
        allocate(PARENT, plan)


@pytest.mark.parametrize("fixed", ["10.20.32.0/18", "10.21.0.0/18", "10.20.64.0/19"])
def test_invalid_locked_network_is_rejected(fixed):
    with pytest.raises(AllocationError, match="does not match"):
        allocate(PARENT, [row("a", 18, locked=True, fixed=fixed)])


def test_over_capacity_is_rejected():
    with pytest.raises(AllocationError):
        allocate(PARENT, [row(f"s{i}", 17) for i in range(3)])


def test_host_range():
    first, last = host_range(IPNetwork("10.20.0.0/19"))
    assert (str(first), str(last)) == ("10.20.0.1", "10.20.31.254")
    first, last = host_range(IPNetwork("2001:db8:0:10::/60"))
    assert (str(first), str(last)) == ("2001:db8:0:10::", "2001:db8:0:1f:ffff:ffff:ffff:ffff")


def test_ipv6():
    parent = IPNetwork("2001:db8::/48")
    rows, unused = allocate(parent, [row("a", 50), row("b", 52), row("c", 64, locked=True, fixed="2001:db8:0:ffff::/64")])
    assert str(rows[2]["network"]) == "2001:db8:0:ffff::/64"
    assert_tiles_parent(rows, unused, parent)
