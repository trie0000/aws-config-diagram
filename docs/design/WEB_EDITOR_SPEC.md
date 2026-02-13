# Web Editor 機能要件仕様書

> 作成日: 2026-02-13

## 全体設計思想

**基本原則**: 「AWS Config JSONから自動生成した要素」と「ユーザが手動で追加/編集した要素」を **明確に区別して保持** する。これにより、JSONの再インポート時にユーザの修正を壊さない。

---

## 軸1: ノード（リソース/要素）のデータモデル

### 1.1 AWS Config由来のリソース

```json
{
  "id": "node-vpc-001",
  "source": "aws-config",
  "awsResourceId": "vpc-0abc123",
  "awsResourceType": "AWS::EC2::VPC",
  "awsAccountId": "123456789012",
  "awsRegion": "ap-northeast-1",
  "configData": {},

  "label": "本番VPC",
  "labelOriginal": "vpc-0abc123",
  "icon": "vpc",
  "position": { "x": 100, "y": 200 },
  "size": { "width": 800, "height": 600 },
  "style": {
    "fillColor": "#E8F5E9",
    "borderColor": "#4CAF50",
    "borderWidth": 2,
    "opacity": 1.0,
    "fontSize": 12
  },

  "parentId": null,
  "childrenIds": ["node-az-001", "node-az-002"],
  "zIndex": 10,
  "layerId": "layer-infrastructure",

  "isLocked": false,
  "isHidden": false,
  "isCollapsed": false,
  "isUserModified": false,

  "complianceStatus": "COMPLIANT",
  "complianceRules": [
    { "ruleId": "vpc-flow-logs-enabled", "status": "COMPLIANT" }
  ],

  "tags": { "Environment": "Production", "Team": "Platform" },
  "createdAt": "2026-02-13T10:00:00Z",
  "updatedAt": "2026-02-13T12:00:00Z",
  "createdBy": "system",
  "updatedBy": "user:trie"
}
```

### 1.2 ユーザ手動追加の要素（AWS外）

```json
{
  "id": "node-external-001",
  "source": "user-manual",
  "resourceType": "external",
  "subType": "on-premise-server",

  "label": "社内Active Directory",
  "description": "既存オンプレのADサーバ。VPN経由で接続",
  "icon": "server-onprem",
  "customIconUrl": null,
  "position": { "x": -200, "y": 300 },
  "size": { "width": 120, "height": 80 },
  "style": {},

  "parentId": null,
  "layerId": "layer-external",
  "isLocked": false,

  "externalMetadata": {
    "ipAddress": "10.0.0.50",
    "owner": "情報システム部",
    "sla": "99.9%",
    "protocol": "LDAPS (636)"
  },

  "createdBy": "user:trie",
  "updatedAt": "2026-02-13T12:00:00Z"
}
```

---

## 軸2: エッジ（接続線/矢印）のデータモデル

```json
{
  "id": "edge-001",
  "source": "aws-config",

  "sourceNodeId": "node-elb-001",
  "targetNodeId": "node-ec2-001",
  "sourcePort": "bottom",
  "targetPort": "top",

  "connectionType": "security-group",
  "protocol": "HTTPS",
  "port": "443",
  "direction": "ingress",
  "cidr": "0.0.0.0/0",

  "label": "HTTPS:443",
  "style": {
    "lineColor": "#FF0000",
    "lineWidth": 2,
    "lineStyle": "solid",
    "arrowHead": "classic",
    "arrowTail": "none",
    "curvature": 0,
    "waypoints": []
  },
  "layerId": "layer-security",
  "zIndex": 5,

  "riskLevel": "high",
  "riskReason": "SSH port open to internet",

  "isLocked": false,
  "isHidden": false,
  "isUserModified": true,

  "createdBy": "system",
  "updatedBy": "user:trie"
}
```

**接続ポイント**: `sourcePort` / `targetPort` は `top` / `bottom` / `left` / `right` / `auto` から選択。

**リスク自動判定**: `0.0.0.0/0` + SSH(22) = `high`、`0.0.0.0/0` + HTTPS(443) = `medium` 等。

---

## 軸3: コメント/アノテーション

```json
{
  "id": "comment-001",
  "type": "comment",

  "anchor": {
    "type": "node",
    "targetId": "node-ec2-001",
    "targetLabel": "本番Web Server"
  },

  "content": "次回メンテ時にインスタンスタイプをm5.xlargeに変更予定",
  "author": "user:trie",
  "createdAt": "2026-02-13T14:00:00Z",
  "updatedAt": "2026-02-13T14:00:00Z",

  "parentCommentId": null,
  "resolved": false,
  "resolvedBy": null,
  "resolvedAt": null,

  "position": { "x": 350, "y": 180 },
  "isVisible": true,
  "priority": "normal",
  "color": "#FFC107"
}
```

**コメント種別**: `comment` / `annotation` / `warning` / `todo`

**アンカータイプ**: `node` / `edge` / `zone` / `point`（フリー配置）

**スレッド対応**: `parentCommentId` で返信チェーンを構成。`resolved` フラグで解決済みマーク。

---

## 軸4: レイヤー管理

```json
{
  "layers": [
    {
      "id": "layer-infrastructure",
      "name": "インフラ構成",
      "order": 0,
      "isVisible": true,
      "isLocked": false,
      "opacity": 1.0,
      "color": "#4CAF50",
      "description": "VPC/AZ/Subnet/リソースの基本構成"
    },
    {
      "id": "layer-security",
      "name": "セキュリティフロー",
      "order": 1,
      "isVisible": true,
      "isLocked": false,
      "opacity": 0.8,
      "color": "#F44336",
      "description": "SGルール、トラフィックフロー、開放ポート"
    },
    {
      "id": "layer-external",
      "name": "外部システム",
      "order": 2,
      "isVisible": true,
      "isLocked": false,
      "opacity": 1.0,
      "color": "#9C27B0",
      "description": "オンプレ、SaaS、他クラウド等のAWS外要素"
    },
    {
      "id": "layer-compliance",
      "name": "コンプライアンス",
      "order": 3,
      "isVisible": false,
      "isLocked": true,
      "opacity": 0.6,
      "color": "#FF9800",
      "description": "Config Rules準拠/非準拠のオーバーレイ"
    },
    {
      "id": "layer-annotations",
      "name": "注釈・コメント",
      "order": 4,
      "isVisible": true,
      "isLocked": false,
      "opacity": 1.0,
      "color": "#2196F3",
      "description": "ユーザのコメント、TODO、メモ"
    }
  ]
}
```

---

## 軸5: バージョン管理 & 変更履歴

### 5.1 図全体のスナップショット

```json
{
  "versions": [
    {
      "versionId": "v-003",
      "label": "2026年2月監査用",
      "sourceConfigHash": "sha256:abc...",
      "createdAt": "2026-02-13T15:00:00Z",
      "createdBy": "user:trie",
      "snapshotData": {},
      "changesSummary": {
        "nodesAdded": 2,
        "nodesRemoved": 0,
        "nodesModified": 5,
        "edgesAdded": 3,
        "commentsAdded": 1
      }
    }
  ]
}
```

### 5.2 操作ログ（Undo/Redo + 監査証跡）

```json
{
  "operationLog": [
    {
      "operationId": "op-001",
      "timestamp": "2026-02-13T14:30:00Z",
      "userId": "user:trie",
      "type": "move",
      "targetType": "node",
      "targetId": "node-ec2-001",
      "before": { "position": { "x": 100, "y": 200 } },
      "after": { "position": { "x": 150, "y": 250 } },
      "isUndoable": true
    }
  ]
}
```

**操作タイプ**: `create` / `update` / `delete` / `move` / `restyle` / `reorder`

---

## 軸6: 図全体のメタデータ（ドキュメントレベル）

```json
{
  "diagramMeta": {
    "id": "diagram-001",
    "title": "本番環境ネットワーク構成図",
    "description": "AWS東京リージョンの本番VPC構成。2026年2月監査用",
    "projectId": "project-audit-2026Q1",

    "sourceConfigs": [
      {
        "filename": "config-prod-20260213.json",
        "uploadedAt": "2026-02-13T10:00:00Z",
        "uploadedBy": "user:trie",
        "awsAccountId": "123456789012",
        "awsRegion": "ap-northeast-1",
        "configHash": "sha256:abc...",
        "resourceCount": 47
      }
    ],

    "canvas": {
      "width": 3000,
      "height": 2000,
      "backgroundColor": "#FFFFFF",
      "gridSize": 20,
      "gridVisible": true,
      "snapToGrid": true,
      "zoom": 1.0,
      "panOffset": { "x": 0, "y": 0 }
    },

    "iconSet": "aws-2024",
    "language": "ja",

    "owner": "user:trie",
    "sharing": {
      "visibility": "team",
      "collaborators": [
        {
          "userId": "user:tanaka",
          "role": "editor",
          "addedAt": "2026-02-13T11:00:00Z"
        }
      ],
      "shareLink": null,
      "sharePassword": null
    },

    "exportPresets": [
      {
        "name": "監査報告書用",
        "format": "pptx",
        "layers": ["layer-infrastructure", "layer-security", "layer-compliance"],
        "includeComments": false,
        "includeComplianceHighlight": true,
        "language": "ja"
      },
      {
        "name": "チーム共有用",
        "format": "png",
        "layers": ["layer-infrastructure", "layer-external"],
        "resolution": "2x",
        "transparent": false
      }
    ],

    "createdAt": "2026-02-13T10:00:00Z",
    "updatedAt": "2026-02-13T15:00:00Z"
  }
}
```

---

## 軸7: 追加提案（4要件への拡張 + 新規機能）

### ユーザー4要件への追加

| # | ユーザー要件 | 追加すべき情報/機能 | 理由 |
|---|------------|-------------------|------|
| 1 | AWS外システム情報の追加 | テンプレートライブラリ（オンプレ、SaaS、他クラウドアイコン） | 毎回手書きは面倒。よく使う外部システムはワンクリック追加 |
| 1+ | | 外部システム専用メタデータ（IP、担当者、SLA、接続プロトコル） | 監査時に即答可能 |
| 1++ | | VPN/DirectConnect/PrivateLink接続線の視覚的区別 | 境界を越える通信の表現 |
| 2 | ユーザ修正内容の維持 | `isUserModified` フラグ（各ノード/エッジに付与） | JSON再インポート時にスキップorマージ選択UI |
| 2+ | | 位置ロック（`isLocked`）個別要素/レイヤー単位 | 苦労して配置したレイアウトが崩れるのを防止 |
| 2++ | | マージポリシー設定（再インポート時の衝突解決方針） | 「手動変更を常に優先」「AWSデータを優先」「差分を表示して選択」 |
| 3 | 親子関係の保持 | 折りたたみ/展開（`isCollapsed`） | 大規模環境で全展開すると見にくい |
| 3+ | | ネストレベル制限（VPC > AZ > Subnet > リソースの4階層） | 手動移動で親子関係が壊れないようバリデーション |
| 3++ | | グループ化（親子関係とは別の任意グルーピング） | 「Webサーバ群」「バッチ処理群」等の業務単位 |
| 4 | コメントの関連付け | コメントスレッド（返信、解決済みフラグ） | チーム議論を1箇所に |
| 4+ | | コメント種別（comment/todo/warning/question） | タスク管理的な使い方 |
| 4++ | | アンカー保持（対象削除後もコメント情報を残す） | 「以前あったEC2に関するコメント」が消えない |

### さらに追加すべき重要機能

| # | 機能 | データとして保持する内容 | なぜ必要か |
|---|------|----------------------|-----------|
| 5 | レイヤー管理 | レイヤーID、表示順、可視状態、ロック状態 | インフラ/セキュリティ/外部/コンプライアンスを切替表示 |
| 6 | Undo/Redo履歴 | 操作種別、対象、変更前後の値、タイムスタンプ、ユーザ | Web編集の基本。Figmaは全操作をログとして保持 |
| 7 | バージョンスナップショット | 全体JSONの時点スナップショット + ラベル + 変更サマリ | 「監査前の版」「修正後の版」の比較 |
| 8 | Diff表示用の差分データ | 2つのconfig.json間の追加/削除/変更リソースリスト | 「前回監査→今回」の差分を色分け表示 |
| 9 | グリッド＆スナップ設定 | グリッドサイズ、スナップON/OFF、整列ガイド | 整列された図 = 見やすい図 |
| 10 | エクスポートプリセット | フォーマット、対象レイヤー、言語、コメント含有可否 | 毎回設定し直さない |
| 11 | 共有・権限情報 | owner, collaborators, roles, share link | チームコラボの基盤 |
| 12 | カスタムプロパティ（タグ） | ユーザ定義のkey-valueペア | 「担当者」「予算コード」「移行ステータス」等 |
| 13 | テキストボックス/自由描画 | フリーテキスト、矩形、矢印などの図形要素 | 補足図形 |
| 14 | リンク/URL情報 | 各ノードに紐づくURL | AWSコンソールやドキュメントにワンクリック |

---

## MVP フェーズ定義

### Phase 1（Must）

- ノードデータモデル（`source` 区別、`position`、`style`、`parentId`）
- エッジデータモデル（接続情報、ポート、リスクレベル）
- 親子関係の保持（VPC > AZ > Subnet > Resource）
- 位置ロック（`isLocked`）
- `isUserModified` フラグ
- 基本的な Undo/Redo
- JSON全体の Export/Import

### Phase 2（Should）

- コメント（アンカー付き、スレッド対応）
- レイヤー管理（5レイヤー: インフラ/セキュリティ/外部/コンプライアンス/注釈）
- バージョンスナップショット
- 外部システムの追加（テンプレート付き）
- エクスポートプリセット

### Phase 3（Nice to have）

- リアルタイム共同編集（CRDT/WebSocket）
- Diff表示
- カスタムプロパティ
- 権限管理（viewer/editor/admin）
- リンク/URL埋め込み

---

## 技術的示唆

### データ構造の選択

Figmaの構造に倣い、**`Map<ObjectID, Map<Property, Value>>`** 形式が最もWeb編集に適している:

```
図全体 = {
  "node-001": { label: "VPC", x: 100, y: 200, parentId: null, ... },
  "node-002": { label: "AZ-1a", x: 110, y: 220, parentId: "node-001", ... },
  "edge-001": { source: "node-003", target: "node-004", port: "443", ... },
  "comment-001": { anchor: "node-003", content: "要修正", ... }
}
```

**メリット**:
- 同じプロパティの同時編集 → Last-Writer-Wins で解決（Figma方式）
- 異なるプロパティの同時編集 → 競合なし
- 親子関係は `parentId` リンクで表現（ツリー構造）
- 将来のCRDT対応が容易

### JSONフォーマットの保存先

| 環境 | ストレージ | 用途 |
|------|----------|------|
| ブラウザ | IndexedDB | オフライン対応、大容量OK |
| サーバ | Supabase PostgreSQL + JSONB | 全文検索可能 |
| エクスポート | 独自JSON形式 + PPTX + XLSX | ファイル出力 |
