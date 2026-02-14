/**
 * icons.ts: NodeType → アイコンPNGファイル名マッピング
 *
 * DiagramCanvas と DetailPanel で共用する。
 */

import type { NodeType } from '../types/diagram'

/** NodeType → アイコンPNGファイル名マッピング */
export const ICON_FILES: Partial<Record<NodeType, string>> = {
  ec2: 'ec2.png',
  alb: 'alb.png',
  rds: 'rds.png',
  'nat-gateway': 'nat.png',
  igw: 'igw.png',
  ecs: 'ecs.png',
  eks: 'eks.png',
  lambda: 'lambda.png',
  elasticache: 'elasticache.png',
  redshift: 'redshift.png',
  route53: 'route53.png',
  cloudfront: 'cloudfront.png',
  'api-gateway': 'apigateway.png',
  s3: 's3.png',
  dynamodb: 'dynamodb.png',
  sqs: 'sqs.png',
  sns: 'sns.png',
  waf: 'waf.png',
  acm: 'acm.png',
  kms: 'kms.png',
  cloudtrail: 'cloudtrail.png',
  cloudwatch: 'cloudwatch.png',
  'vpc-endpoint': 'vpc_endpoint.png',
  'auto-scaling': 'autoscaling.png',
  'elastic-beanstalk': 'elasticbeanstalk.png',
}

/** VPC アイコン */
export const VPC_ICON = 'vpc_icon.png'

/** AWS Cloud アイコン */
export const AWS_CLOUD_ICON = 'aws_cloud.png'
