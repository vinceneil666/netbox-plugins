"""
Prefix allocation - pure netaddr, no NetBox/Django imports, so it can be unit-tested on its own.

The planner UI (templates/netbox_prefix_planner/widgets/segment_planner.html) implements the same
algorithm in JavaScript; keep the two in sync.
"""
import math

from netaddr import IPAddress, IPNetwork

# The planner never offers prefixes smaller than this (IPv4 /30 = 4 addresses, IPv6 /64)
MIN_SEGMENT_PREFIXLEN = {4: 30, 6: 64}


class AllocationError(ValueError):
    pass


def default_plan(prefix, count):
    """Equal split: the smallest power-of-two number of equal subnets that fits `count`, first `count` used."""
    network = IPNetwork(str(prefix))
    extra_bits = math.ceil(math.log2(count)) if count > 1 else 0
    return [{"name": f"seg{i}", "prefixlen": network.prefixlen + extra_bits, "in_scope": True}
            for i in range(1, count + 1)]


def allocate(prefix, plan):
    """
    Place the in-scope rows of `plan` inside `prefix`. Buddy allocation over aligned blocks:

    1. Locked rows are carved out at their exact saved network ("fixed").
    2. The other in-scope rows, largest first (stable, so equal sizes keep plan order), each take the
       smallest free block that is big enough, lowest address first.
    3. What is left is merged into the fewest aligned blocks - the "unused" prefixes.

    The planner UI runs the same algorithm, so what you see is what gets created.
    Returns (rows, unused): rows get "network" (IPNetwork, or None when out of scope) plus
    "first_host"/"last_host"; unused is a sorted list of IPNetworks.
    Raises AllocationError when the plan does not fit.
    """
    parent = IPNetwork(str(prefix))
    bits = 32 if parent.version == 4 else 128
    size = lambda length: 2 ** (bits - length)  # noqa: E731
    free = {(0, parent.prefixlen)}                # (offset from parent start, prefixlen)
    rows = [dict(row, network=None) for row in plan]

    def take(block, offset, length):
        """Remove `block` from free, split it down to `length` around `offset`, return the rest to free."""
        free.remove(block)
        b_off, b_len = block
        while b_len < length:
            b_len += 1
            low, high = (b_off, b_len), (b_off + size(b_len), b_len)
            keep, spare = (high, low) if offset >= high[0] else (low, high)
            free.add(spare)
            b_off = keep[0]

    def place(row, offset):
        row["network"] = IPNetwork(f"{parent.network + offset}/{row['prefixlen']}")
        row["first_host"], row["last_host"] = host_range(row["network"])

    for row in rows:
        if not (row.get("in_scope") and row.get("locked") and row.get("fixed")):
            continue
        fixed = IPNetwork(row["fixed"])
        offset = fixed.first - parent.first
        if fixed.prefixlen != row["prefixlen"] or fixed not in parent or fixed.ip != fixed.network:
            raise AllocationError(f"{row['name']}: locked network {row['fixed']} does not match its size/prefix.")
        block = next((b for b in free if b[1] <= row["prefixlen"] and b[0] <= offset < b[0] + size(b[1])), None)
        if block is None:
            raise AllocationError(f"{row['name']}: locked network {row['fixed']} overlaps another prefix.")
        take(block, offset, row["prefixlen"])
        place(row, offset)

    pending = [r for r in rows if r.get("in_scope") and r["network"] is None]
    for row in sorted(pending, key=lambda r: r["prefixlen"]):
        fits = [b for b in free if b[1] <= row["prefixlen"]]
        if not fits:
            raise AllocationError(f"{row['name']} (/{row['prefixlen']}) does not fit in the remaining space.")
        block = max(fits, key=lambda b: (b[1], -b[0]))  # smallest block, then lowest address
        take(block, block[0], row["prefixlen"])
        place(row, block[0])

    # merge free buddies into maximal aligned blocks
    merged = True
    while merged:
        merged = False
        for off, length in sorted(free, key=lambda b: (-b[1], b[0])):
            if length == parent.prefixlen:
                continue
            buddy = (off ^ size(length), length)
            if buddy in free and (off, length) in free:
                free -= {(off, length), buddy}
                free.add((min(off, buddy[0]), length - 1))
                merged = True
    unused = sorted(IPNetwork(f"{parent.network + off}/{length}") for off, length in free)
    return rows, unused


def host_range(network):
    """First and last usable address: IPv4 skips the network and broadcast address, IPv6 has neither."""
    if network.version == 4 and network.prefixlen < 31:
        return IPAddress(network.first + 1), IPAddress(network.last - 1)
    return IPAddress(network.first), IPAddress(network.last)
