# Prefix Planner

A [NetBox](https://github.com/netbox-community/netbox) plugin for onboarding a customer's address space in one step.
Type the customer name and the block assigned to them, size the prefixes with sliders, and save. A background job
creates the tenant, a VRF, the customer's container prefix and one container per planned prefix, all attached to
the customer.

![The prefix planner](docs/planner.png)

## Features

- **Interactive planner**: one slider per prefix, stepping through power-of-two sizes (/19, /20, /21 …). Each row
  shows the CIDR, the usable host range, the address count and its share of the block. A coloured address map
  shows where every prefix sits.
- **Automatic rebalancing**: when a prefix grows and the plan no longer fits, the largest other prefix is
  halved. When nothing can shrink further, the last one is marked *out of scope* and not created. Rows that
  were adjusted flash so you can see what changed.
- **Locks**: lock a prefix to pin it to its exact network. Locked prefixes are never resized, moved or dropped
  automatically; the others are fitted around them.
- **Your own names**: every prefix has an editable name, which becomes the prefix description in NetBox.
- **In or out of scope**: switch individual prefixes on or off.
- **Unused space**: optionally create the space no prefix uses as well, as the fewest possible CIDRs, with the
  description `unused`.
- **What you see is what you get**: the browser and the server run the same allocation algorithm, and the server
  re-validates every plan before anything is created.
- **Safe to re-run**: the provisioning job reuses existing objects and never creates duplicates. A
  *Run provisioning again* button and the object's Jobs tab (with the job log) are on the customer page.
- **Existing tenants**: if a tenant with the customer name already exists, matched on name with any slug, it
  is reused.
- IPv4 and IPv6.

![A provisioned customer](docs/customer.png)

## What gets created

For customer `ACME Corp` with `10.20.0.0/16`:

| Object | Details |
|---|---|
| Tenant | `ACME Corp`, reused if it already exists |
| VRF | `ACME Corp`, enforce unique, tenant ACME Corp (see `vrf_per_customer`) |
| Prefix | `10.20.0.0/16`, status *container*, description `ACME Corp address block` |
| Prefix per planned row | status *container*, description = the row name, e.g. `10.20.128.0/18` → `Clients` |
| Prefix per unused block | only with *Create prefixes for unused space*: status *container*, description `unused` |

All prefixes get the customer's tenant and VRF.

## Requirements

- NetBox 4.7 or later
- Python 3.12 or later

## Installation

```bash
source /opt/netbox/venv/bin/activate
pip install "git+https://github.com/vinceneil666/netbox-plugins.git#subdirectory=prefix-planner"
```

Enable it in `configuration.py`:

```python
PLUGINS = ["netbox_prefix_planner"]

PLUGINS_CONFIG = {
    "netbox_prefix_planner": {
        "vrf_per_customer": True,
    },
}
```

Then apply the migrations and restart NetBox and the background worker (`rqworker`), which runs the
provisioning job:

```bash
cd /opt/netbox/netbox
python manage.py migrate
sudo systemctl restart netbox netbox-rq
```

### netbox-docker

Build an image with the plugin, as described in
[Using NetBox Plugins](https://github.com/netbox-community/netbox-docker/wiki/Using-Netbox-Plugins), for example:

```dockerfile
FROM docker.io/netboxcommunity/netbox:v4.7
RUN /usr/local/bin/uv pip install --python /opt/netbox/venv/bin/python \
      "git+https://github.com/vinceneil666/netbox-plugins.git#subdirectory=prefix-planner"
```

Use the image for both the `netbox` and the `netbox-worker` services, and add the plugin to
`configuration/plugins.py`.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `vrf_per_customer` | `True` | Put each customer in its own VRF. MSP customers usually overlap in RFC 1918 space, so the VRF keeps their prefixes apart. With `False`, prefixes go in the global table and the job refuses blocks that overlap another tenant's prefixes. |

## Usage

1. Go to **Plugins → Prefix Planner → Customers** and click **+**.
2. Enter the **customer name** (this becomes the tenant) and the **prefix** assigned to them.
3. Set the **number of prefixes**. The planner starts with an equal split: 6 prefixes use an 8-way split,
   leaving 2 parts free.
4. Plan:
   - drag a slider to resize a prefix,
   - type a name for each prefix,
   - click the lock to pin a prefix to its current network,
   - untick *In scope* to leave a prefix out,
   - switch on *Create prefixes for unused space* if the free space should be registered too.
5. Click **Create**. The job runs in the background; the customer page shows its status, the prefix plan and the
   prefixes created.

The name, prefix and plan can't be changed after creation, because they define what the job created. Delete the
customer record and the objects it created if you need to start over.

## How the allocation works

Prefix sizes are powers of two, and the plan is placed with buddy allocation:

1. Locked prefixes are carved out at their pinned network.
2. The other prefixes, largest first, each take the smallest free block they fit in (lowest address first). Equal
   sizes keep their order from the plan.
3. The leftover free blocks are merged into the fewest aligned CIDRs; these are the *unused* prefixes.

This detects fragmentation: a plan can be rejected even when the total size fits, if locked prefixes leave no
aligned block big enough. The smallest prefix the planner offers is /30 for IPv4 and /64 for IPv6. Host ranges
exclude the network and broadcast address for IPv4; IPv6 shows the full range.

The algorithm lives in [`allocation.py`](netbox_prefix_planner/allocation.py) (Python, used by the server and the
job) and in the planner template (JavaScript, used in the browser). The two must stay in sync.

## Development

The allocator has no NetBox dependencies, so its tests run anywhere:

```bash
cd prefix-planner
pip install pytest netaddr
pytest
```

## License

Apache License 2.0, see [LICENSE](../LICENSE).
