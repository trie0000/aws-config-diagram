"""
debug_raw_subnet.py: Dump raw subnet & related data from AWS Config JSON

Usage: python debug_raw_subnet.py aws.json
"""
import json
import sys

if len(sys.argv) < 2:
    print("Usage: python debug_raw_subnet.py <config.json>")
    sys.exit(1)

with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)

items = data.get("configurationItems", [])

print("=" * 70)
print("=== RAW Subnet entries ===")
print("=" * 70)
for item in items:
    if item.get("resourceType") == "AWS::EC2::Subnet":
        print(f"\nresourceId: {item.get('resourceId')}")
        print(f"resourceName: {item.get('resourceName')}")
        print(f"configurationItemStatus: {item.get('configurationItemStatus')}")
        print(f"availabilityZone: {item.get('availabilityZone')}")
        cfg = item.get("configuration")
        if cfg is None:
            print("configuration: None")
        elif isinstance(cfg, str):
            print(f"configuration (string, len={len(cfg)}): {cfg[:300]}")
        elif isinstance(cfg, dict):
            print(f"configuration (dict): {json.dumps(cfg, indent=2, default=str)[:500]}")
        else:
            print(f"configuration (type={type(cfg).__name__}): {str(cfg)[:300]}")

        supp = item.get("supplementaryConfiguration")
        if supp:
            print(f"supplementaryConfiguration: {json.dumps(supp, indent=2, default=str)[:500]}")
        else:
            print("supplementaryConfiguration: None/empty")

        tags = item.get("tags")
        print(f"tags: {tags}")
        rels = item.get("relationships", [])
        print(f"relationships ({len(rels)}):")
        for r in rels[:5]:
            print(f"  {r}")

print("\n" + "=" * 70)
print("=== NetworkInterface entries (for subnet CIDR hints) ===")
print("=" * 70)
for item in items:
    if item.get("resourceType") == "AWS::EC2::NetworkInterface":
        cfg = item.get("configuration")
        if isinstance(cfg, str):
            try:
                cfg = json.loads(cfg)
            except Exception:
                pass
        if isinstance(cfg, dict):
            subnet_id = cfg.get("subnetId", cfg.get("SubnetId", ""))
            priv_ips = cfg.get("privateIpAddresses", cfg.get("PrivateIpAddresses", []))
            desc = cfg.get("description", cfg.get("Description", ""))
            print(f"\n  ENI: {item.get('resourceId')}")
            print(f"  subnetId: {subnet_id}")
            print(f"  description: {desc}")
            if priv_ips:
                for p in priv_ips[:3]:
                    if isinstance(p, dict):
                        print(f"    privateIp: {p.get('privateIpAddress', p.get('PrivateIpAddress', '?'))}")

print("\n" + "=" * 70)
print("=== VPC entries (for cidrBlockAssociationSet) ===")
print("=" * 70)
for item in items:
    if item.get("resourceType") == "AWS::EC2::VPC":
        print(f"\nresourceId: {item.get('resourceId')}")
        print(f"configurationItemStatus: {item.get('configurationItemStatus')}")
        cfg = item.get("configuration")
        if cfg is None:
            print("configuration: None")
        elif isinstance(cfg, str):
            print(f"configuration (string, len={len(cfg)}): {cfg[:500]}")
        elif isinstance(cfg, dict):
            print(f"configuration (dict): {json.dumps(cfg, indent=2, default=str)[:500]}")
        supp = item.get("supplementaryConfiguration")
        if supp:
            print(f"supplementaryConfiguration: {json.dumps(supp, indent=2, default=str)[:500]}")
