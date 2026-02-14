/**
 * styles.ts: DiagramCanvas スタイル定数
 *
 * モックアップ v3 (Light) に準拠。
 * コンテナ/アイコン/エッジの色・サイズ定義を一元管理。
 */

import type { NodeType } from '../types/diagram'

// ============================================================
// コンテナスタイル
// ============================================================

/** AWS Cloud: オレンジ枠 + 薄オレンジ背景 */
export const CLOUD_STYLE = { fill: '#fffbf5', stroke: '#f97316', labelColor: '#ea580c' }

/** VPC: 緑枠 + 白背景 */
export const VPC_STYLE = { fill: '#ffffff', stroke: '#22c55e', labelColor: '#16a34a' }

/** AZ: グレー実線 + 薄グレー背景 */
export const AZ_STYLE = { fill: '#f8fafc', stroke: '#cbd5e1', labelColor: '#64748b' }

/** Subnet tier 別 */
export const SUBNET_STYLES: Record<string, { fill: string; stroke: string; labelColor: string }> = {
  Public:   { fill: '#f0fdf4', stroke: '#22c55e', labelColor: '#16a34a' },
  Private:  { fill: '#eff6ff', stroke: '#3b82f6', labelColor: '#2563eb' },
  Isolated: { fill: '#faf5ff', stroke: '#a855f7', labelColor: '#7c3aed' },
}

// ============================================================
// アイコンスタイル
// ============================================================

/** アイコンフォールバック短縮ラベル（PNG がないタイプ用） */
export const ICON_LABELS: Partial<Record<NodeType, string>> = {
  'vpc-peering': 'Peer',
  'external-system': 'EXT',
  comment: '\u{1F4AC}',
}

/** アイコンフォールバック色 */
export const ICON_COLOR = '#ea580c'

/** NodeType → AWS サービス名マッピング */
export const SERVICE_NAMES: Partial<Record<NodeType, string>> = {
  ec2: 'Amazon EC2',
  alb: 'Elastic Load Balancing',
  rds: 'Amazon RDS',
  'nat-gateway': 'NAT Gateway',
  igw: 'Internet Gateway',
  ecs: 'Amazon ECS',
  eks: 'Amazon EKS',
  lambda: 'AWS Lambda',
  elasticache: 'Amazon ElastiCache',
  redshift: 'Amazon Redshift',
  route53: 'Amazon Route 53',
  cloudfront: 'Amazon CloudFront',
  'api-gateway': 'Amazon API Gateway',
  s3: 'Amazon S3',
  dynamodb: 'Amazon DynamoDB',
  sqs: 'Amazon SQS',
  sns: 'Amazon SNS',
  waf: 'AWS WAF',
  acm: 'AWS Certificate Manager',
  kms: 'AWS KMS',
  cloudtrail: 'AWS CloudTrail',
  cloudwatch: 'Amazon CloudWatch',
  'vpc-endpoint': 'VPC Endpoint',
  'vpc-peering': 'VPC Peering',
  'auto-scaling': 'Auto Scaling',
  'elastic-beanstalk': 'AWS Elastic Beanstalk',
  'external-system': 'External System',
}

// ============================================================
// Canvas 定数
// ============================================================

export const CONTAINER_TYPES = new Set(['aws-cloud', 'vpc', 'az', 'subnet'])

/** リサイズハンドルのサイズ */
export const HANDLE_SIZE = 8

/** スナップガイドライン: 位置が揃ったと判定する閾値（px） */
export const SNAP_THRESHOLD = 5

/** ミニマップ設定 */
export const MINIMAP_W = 200
export const MINIMAP_H = 140
export const MINIMAP_MARGIN = 12
