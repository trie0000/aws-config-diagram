# AWS 構成図レイアウト最適化 調査レポート

Perplexity API による調査結果と、それに基づく layout_engine.py v2 の設計判断をまとめる。

- 調査日: 2026-02-14
- 調査ツール: Perplexity API (sonar-pro)
- 対象: ネットワーク構成図における見やすいレイアウトのベストプラクティス

---

## 1. 調査クエリ

> Best practices for AWS network architecture diagram layout: icon placement,
> arrow routing, visual hierarchy. How to arrange VPC, subnets, EC2, RDS, ALB,
> IGW etc. for maximum readability. Include academic or industry references for
> graph layout algorithms used in network diagrams.

---

## 2. 調査結果サマリー

### 2.1 データフロー方向（左→右）

AWS 公式リファレンスアーキテクチャおよび業界標準では、ネットワーク構成図のデータフローは **左から右** 方向が推奨される。

- ユーザー/外部 → エッジサービス → ロードバランサ → コンピュート → データストア
- 西洋圏の読書方向（左→右）と一致し、直感的に理解しやすい
- AWS 公式アーキテクチャ図の大半がこのパターンを採用

**配置の優先順位（左→右）:**

```
外部ユーザー → WAF/CloudFront/Route53 → IGW → ALB → EC2/ECS → RDS/ElastiCache
```

### 2.2 階層的ネスト構造

AWS リソースの論理的な包含関係を視覚的に表現する:

```
AWS Cloud
  └── VPC (10.0.0.0/16)
        ├── AZ-a
        │     ├── Public Subnet  → Nginx, ALB
        │     ├── Private Subnet → App Server
        │     └── DB Subnet      → RDS
        └── AZ-c
              ├── Public Subnet  → Nginx
              ├── Private Subnet → App Server
              └── DB Subnet      → RDS (Standby)
```

- **VPC**: 大きな矩形コンテナ
- **AZ**: VPC 内部に縦方向にスタック（名前順ソート）
- **Subnet**: AZ 内部にデータフロー順（Public→Private→Isolated）で横並び

### 2.3 VPC 境界サービスの配置

- **IGW**: VPC の左端境界線上に配置。VPC への入口/出口を視覚的に表現
- **NAT Gateway**: IGW の右隣（Private Subnet からの外部通信経路を示す）
- **VPC Peering / Endpoint**: VPC 上部の水平サービス行に配置

### 2.4 VPC 外サービスの配置

3 つの領域に分類:

| 領域 | 配置位置 | サービス例 |
|------|---------|-----------|
| エッジサービス | VPC 左側（縦並び） | Route53, CloudFront, WAF, API Gateway |
| データサービス | VPC 下部（横並び） | Lambda, DynamoDB, SQS, SNS, S3 |
| サポートサービス | VPC 右側（縦並び） | KMS, CloudTrail, CloudWatch |

- エッジサービスは VPC の縦方向中央にセンタリング
- データフロー方向（左→右）と一致する配置

### 2.5 Subnet 内リソースの配置

- **接続関係に基づくフロー配置**: トポロジカルソートで入次数 0 のノードから順に左上配置
- 接続元→接続先の方向で並べることで矢印が自然に左→右に流れる
- グリッドレイアウト（最大 3 列）で整列感を維持

### 2.6 矢印の最適化

- **直交ルーティング（Manhattan routing）**: 水平・垂直のみ。斜め線を使わない
- **矢印の交差最小化**: ノード配置順を接続関係で決めることで間接的に達成
- **アイコン間隔の確保**: 矢印の経路用に 24px のギャップを確保

### 2.7 参考となるグラフレイアウトアルゴリズム

| アルゴリズム | 用途 | 本プロジェクトでの採用 |
|-------------|------|---------------------|
| Sugiyama (層状レイアウト) | DAG の層別配置、エッジ交差最小化 | 部分採用（データフロー順の層概念） |
| Topological Sort (BFS) | 入次数ベースのノード順序決定 | 採用（Subnet 内フロー配置） |
| Force-directed | 一般的なグラフの自動配置 | 不採用（構造が階層的なので不適） |

---

## 3. 設計判断と実装

### 3.1 layout_engine.py v1 → v2 の変更点

| 項目 | v1 | v2 |
|------|-----|-----|
| 全体方向 | 特になし（グリッド配置） | 左→右データフロー |
| Subnet 内配置 | 出現順グリッド | トポロジカルソート → グリッド |
| VPC 内サービス | 上部に均等配置 | データフロー順 + IGW を境界配置 |
| VPC 外サービス | 左上に均等配置 | 3 領域分類（エッジ/データ/サポート） |
| アイコン間隔 | 16px | 24px（矢印余地確保） |
| AZ 間隔 | 16px | 24px |
| Subnet 間隔 | 16px | 20px |
| Subnet tier 順 | 名前順 | Public → Private → Isolated |

### 3.2 ノード分類ルール

```python
# エッジサービス（VPC 左側に縦配置）
edge_types = {"route53", "cloudfront", "api-gateway", "waf", "acm"}

# データサービス（VPC 下部に横配置）
data_types = {"lambda", "dynamodb", "sqs", "sns", "s3"}

# サポートサービス（VPC 右側に縦配置）
support_types = {"kms", "cloudtrail", "cloudwatch"}
```

### 3.3 データフロー順序定数

```python
# VPC 外エッジサービス
EDGE_SERVICE_ORDER = {"waf": 0, "cloudfront": 1, "route53": 2, "api-gateway": 3}

# VPC 内サービス
VPC_SERVICE_ORDER = {
    "igw": 0, "nat-gateway": 1, "alb": 2,
    "vpc-endpoint": 3, "vpc-peering": 4,
    "auto-scaling": 5, "elastic-beanstalk": 6,
    "ecs": 7, "eks": 8, "elasticache": 9, "redshift": 10,
}
```

### 3.4 v2.1 微調整

ブラウザでの動作確認後に以下を調整:

- `VPC_SERVICE_GAP`: 72px → 100px（VPC 内サービスのラベル重なり防止）
- VPC 幅計算: サービス行の幅も考慮するように拡張
- サービス行高さ: +16px → +28px（ラベル用余白追加）

---

## 4. 動作確認結果

tabelog_many_services.json（32 ノード / 21 エッジ）でテスト:

- WAF が VPC 左側に配置
- IGW が VPC 左端境界に配置
- NAT → ALB → Peering → ElastiCache → RDS が VPC 上部にデータフロー順配置
- Public → Private App → Private DB Subnet が左→右配置
- Lambda, S3 が VPC 下部に配置
- 矢印が直交ルーティングで描画
- ノード間のラベル重なりなし

---

## 5. 矢印ルーティング品質の改善調査（第2回）

- 調査日: 2026-02-15
- 背景: v2 のレイアウトでは矢印が無関係なアイコンを突き抜けたり、矢印同士が重なって区別できない問題が発生

### 5.1 現状の問題点

| 問題 | 原因 | 影響 |
|------|------|------|
| 矢印がアイコンを突き抜ける | Z字/L字の単純ルートで障害物を考慮しない | どこに繋がっているか不明 |
| 矢印同士の重なり | 同じ線分上に複数エッジがオフセットなく重なる | 何本あるか・行先が不明 |
| 矢印の交差 | ルート経路の最適化なし | フローの追跡が困難 |

### 5.2 調査結果: 3段階パイプライン

調査の結果、以下の3段階パイプラインが実用的であることが判明。
目標: <100ノード / <50エッジ で 100ms 以内。

#### Stage 1: 障害物回避ルーティング（Obstacle-Aware Routing）

**2つのアプローチが候補:**

**(A) グリッドベース BFS（軽量、推奨）**

- ノードの矩形を障害物としてグリッド上にマーク
- BFS で始点→終点の最短直交パスを探索
- 4方向（上下左右）のみ移動
- 計算量: O(grid_cells) ≈ O((diagram_size/gridSize)²)
- gridSize=40px で 1000セル程度 → **5ms/エッジ**

```
1. グリッドセルサイズを決定（例: 40px）
2. 全ノードの矩形をグリッド上にマーク（occupied cells）
3. 始点・終点のセルを算出
4. BFS で4方向探索（occupied でないセルのみ通過）
5. パスを再構成 → 連続する同方向セルをマージして折れ線に簡略化
```

**(B) 直交 Visibility Graph + A*（高品質）**

- ノードの角 + 延長線の交差点で Visibility Graph を構築
- A* で最短パス探索（Manhattan distance ヒューリスティック）
- 折れ曲がりペナルティ付き（曲がりが少ない経路を優先）
- 計算量: O(n² log n) per edge（n=ノード数）
- libavoid（Dunnart, Inkscape で使用）の手法

#### Stage 2: エッジナッジング（Edge Nudging / Parallel Offset）

同じ線分上を通る複数エッジを等間隔にオフセットする:

```
1. 全エッジのルート済みパスからセグメント（水平/垂直区間）を抽出
2. セグメントの方向 + 位置でグループ化（例: 同じ Y 座標の水平セグメント）
3. 同グループ内のエッジをインデックスで等間隔オフセット:
   offset = (rank - (count-1)/2) * offset_step
4. 水平セグメント → Y方向にオフセット
   垂直セグメント → X方向にオフセット
5. offset_step = 6〜8px（strokeWidth の 4〜5 倍）
```

**効果**: 重なっていた矢印が束になって並走し、各矢印が個別に見える。

#### Stage 3: 交差軽減（Crossing Reduction）

ルーティング後に残る交差を減らすヒューリスティック:

```
1. エッジを始点からの角度でソート
2. 隣接するエッジペアのセグメント交差を検出
3. 交差している場合、チャネル内の順序を入れ替え（swap）
4. 繰り返し（最大 数回で収束）
```

計算量: O(E²) で E<50 なら 30ms 以内。

### 5.3 推奨する実装方針

| 優先度 | 改善項目 | 実装方法 | 効果 |
|--------|---------|---------|------|
| **P0** | 障害物回避 | グリッドBFS | 矢印がアイコンを突き抜けなくなる |
| **P1** | エッジナッジ | セグメント分類 + オフセット | 重なった矢印が区別できる |
| **P2** | 交差軽減 | ソート + swap | フロー追跡が容易に |
| P3 | ポート最適化 | 接続辺の再割当て | 曲がりが減る |

**実装場所**: DiagramCanvas.tsx の `orthogonalRoute()` を置き換え。
全エッジのルーティングを一括で行うパイプラインに変更する必要がある
（現在は個別にルーティングしているため、他エッジとの干渉を考慮できない）。

### 5.4 参考アルゴリズム・ツール

| 名前 | 種類 | 特徴 |
|------|------|------|
| libavoid | C++ ライブラリ | Orthogonal Visibility Graph + 障害物回避。Inkscape で採用 |
| yFiles OrthogonalEdgeRouter | 商用 | パスファインディング + 単調制約 + インクリメンタルスコープ |
| Sugiyama | アルゴリズム | DAG 層状レイアウト。エッジ交差最小化（Phase 3: crossing reduction） |
| A* with bend penalty | アルゴリズム | 折れ曲がりにコスト付与 → 少ない曲がりのパスを優先 |

---

## 6. その他の改善候補

- **動的アイコンサイズ**: ノード数に応じたアイコンサイズの自動調整
- **マルチ VPC 対応**: 複数 VPC 間のピアリング接続の視覚化
- **Sugiyama 層状レイアウトのフル実装**: 現在は部分採用。エッジ交差の数値的最小化は未実装
