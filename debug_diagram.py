"""
debug_diagram.py: Excel版の描画デバッグ用スクリプト

Usage: python debug_diagram.py aws.json
"""
import sys
from generate_diagram import AWSConfigParser

if len(sys.argv) < 2:
    print("Usage: python debug_diagram.py <config.json>")
    sys.exit(1)

p = AWSConfigParser(sys.argv[1])
vpcs = p.get_vpcs()

for vpc in vpcs:
    vid = vpc["id"]
    print(f"\n{'='*60}")
    print(f"VPC: {vpc['name']} ({vid}) score={vpc.get('score','?')}")
    print(f"{'='*60}")

    subs = p.get_subnets_for_vpc(vid)
    print(f"\n--- Subnets ({len(subs)}) ---")
    for s in subs:
        insts = p.get_instances_for_subnet(s["id"])
        inst_names = [i["name"] for i in insts]
        print(f"  {s['id']}  tier={s['tier']:8s}  az={s['az']}  cidr={s.get('cidr','?')}")
        if inst_names:
            print(f"    EC2: {inst_names}")

    rdss = p.get_rds_for_vpc(vid)
    print(f"\n--- RDS ({len(rdss)}) ---")
    for r in rdss:
        print(f"  {r['id']}  subnet_ids={r['subnet_ids']}  engine={r.get('engine','?')}")

    nats = p.get_nat_gateways_for_vpc(vid)
    print(f"\n--- NAT Gateways ({len(nats)}) ---")
    for n in nats:
        print(f"  {n['id']}  subnet_id={n.get('subnet_id','?')}")

    albs = p.get_albs_for_vpc(vid)
    print(f"\n--- ALBs ({len(albs)}) ---")
    for a in albs:
        print(f"  {a['id'][:60]}")

    igw = p.get_igw_for_vpc(vid)
    print(f"\n--- IGW: {igw if igw else 'None'} ---")

    print(f"\n--- Global Services ---")
    print(f"  KMS keys:     {len(p.get_kms_keys())}")
    print(f"  S3 buckets:   {len(p.get_s3_buckets())}")
    print(f"  Lambda:       {len(p.get_lambda_functions())}")
    lfs = p.get_lambda_functions()
    for lf in lfs:
        print(f"    {lf['id']}  in_vpc={lf.get('in_vpc')}  subnets={lf.get('vpc_subnet_ids',[])}")
    print(f"  ECS services: {len(p.get_ecs_services())}")
    print(f"  EKS clusters: {len(p.get_eks_clusters())}")
    print(f"  CloudFront:   {len(p.get_cloudfront_distributions())}")
    print(f"  API Gateway:  {len(p.get_api_gateways())}")
    print(f"  Route53:      {len(p.get_route53_hosted_zones())}")
    print(f"  DynamoDB:     {len(p.get_dynamodb_tables())}")
    print(f"  ElastiCache:  {len(p.get_elasticache_clusters())}")
    print(f"  Redshift:     {len(p.get_redshift_clusters())}")
    print(f"  SQS:          {len(p.get_sqs_queues())}")
    print(f"  SNS:          {len(p.get_sns_topics())}")
    print(f"  CloudTrail:   {len(p.get_cloudtrail_trails())}")
    print(f"  CloudWatch:   {len(p.get_cloudwatch_alarms())}")
    print(f"  AutoScaling:  {len(p.get_autoscaling_groups())}")
    print(f"  Beanstalk:    {len(p.get_elasticbeanstalk_environments())}")
    print(f"  Peerings:     {len(p.get_peering_connections())}")

    waf = None
    for a in albs:
        waf = p.get_waf_for_alb(a["id"])
        if waf:
            break
    print(f"  WAF:          {bool(waf)}")
