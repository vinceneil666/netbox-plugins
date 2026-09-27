# NetBox plugins

A collection of plugins for [NetBox](https://github.com/netbox-community/netbox). Each plugin lives in its own
directory, is a separate Python package and can be installed on its own.

| Plugin | Description | NetBox |
|---|---|---|
| [Prefix Planner](prefix-planner/) | Plan a customer's address block with sliders and provision the tenant, VRF and prefixes in one go. Includes a REST API. | 4.7+ |

## Installing a plugin

Install a plugin straight from this repository with pip, using its directory as `subdirectory`:

```bash
source /opt/netbox/venv/bin/activate
pip install "git+https://github.com/vinceneil666/netbox-plugins.git#subdirectory=prefix-planner"
```

Then follow the plugin's own README to enable and configure it.

## License

Apache License 2.0, see [LICENSE](LICENSE).
