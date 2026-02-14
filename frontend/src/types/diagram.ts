/**
 * diagram.ts: DiagramState 型定義
 *
 * AWS Config パーサー出力 + ユーザー編集状態を保持する中間データモデル。
 * Python 側の DiagramState と同期すること。
 *
 * 設計原則:
 * - source: 'aws-config' | 'user-manual' で出所を明確に区別
 * - isUserModified: true の場合、JSON再インポート時に上書きしない
 * - Figma方式フラットマップ: Record<string, DiagramNode>
 */

/** リソースの出所 */
export type DiagramSource = 'aws-config' | 'user-manual'

/** ピクセル座標 */
export interface Position {
  x: number
  y: number
}

/** ピクセルサイズ */
export interface Size {
  width: number
  height: number
}

/** ノード種別 */
export type NodeType =
  | 'aws-cloud'
  | 'vpc'
  | 'subnet'
  | 'az'
  | 'ec2'
  | 'alb'
  | 'rds'
  | 'nat-gateway'
  | 'igw'
  | 'ecs'
  | 'eks'
  | 'lambda'
  | 'elasticache'
  | 'redshift'
  | 'route53'
  | 'cloudfront'
  | 'api-gateway'
  | 's3'
  | 'dynamodb'
  | 'sqs'
  | 'sns'
  | 'waf'
  | 'acm'
  | 'kms'
  | 'cloudtrail'
  | 'cloudwatch'
  | 'vpc-endpoint'
  | 'vpc-peering'
  | 'auto-scaling'
  | 'elastic-beanstalk'
  | 'external-system'
  | 'comment'

/** 構成図ノード（リソース/要素） */
export interface DiagramNode {
  id: string
  type: NodeType
  label: string
  source: DiagramSource
  isUserModified: boolean

  /** 座標・サイズ（LayoutEngine が計算、ユーザーがドラッグで変更可能） */
  position: Position
  size: Size

  /** 親ノード ID（VPC→Subnet→EC2 のような階層） */
  parentId: string | null

  /** AWS Config 由来のメタデータ */
  metadata: Record<string, unknown>
}

/** エッジ種別 */
export type EdgeType = 'containment' | 'connection' | 'data-flow' | 'user-defined'

/** 構成図エッジ（接続線） */
export interface DiagramEdge {
  id: string
  type: EdgeType
  source: DiagramSource
  sourceNodeId: string
  targetNodeId: string
  label: string | null
  isUserModified: boolean
  metadata: Record<string, unknown>
}

/** 構成図全体の状態 */
export interface DiagramState {
  /** 図のメタデータ */
  meta: {
    title: string
    createdAt: string
    updatedAt: string
    configSnapshotId: string | null
  }

  /** ノード（フラットマップ） */
  nodes: Record<string, DiagramNode>

  /** エッジ */
  edges: Record<string, DiagramEdge>
}
