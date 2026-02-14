# エッジルーティング設計書

## 基本ルール（最重要）

### 出口方向の一致ルール

**線がノードのある辺から出発するなら、最初のセグメントはその辺の法線方向に進まなければならない。**

```
✅ 正しい: 下辺から出発 → 最初のセグメントは下方向
   ┌───┐
   │   │
   └─┬─┘
     │  ← 下向き
     └──→

❌ 間違い: 上辺から出発 → 最初のセグメントが下方向
   ──┬───
     │ icon │  ← 上辺の座標なのに下に行っている
   ──┴───
```

| 出発辺 | 最初のセグメント | 座標の変化 |
|--------|-----------------|-----------|
| right  | →（右向き）      | x 増加    |
| left   | ←（左向き）      | x 減少    |
| bottom | ↓（下向き）      | y 増加    |
| top    | ↑（上向き）      | y 減少    |

### 出入り分離ルール

**同じ辺に出る矢印（src）と入る矢印（dst）がある場合、接続位置を分けなければならない。**

```
✅ 正しい: 出る線と入る線が別の位置
   ┌──────┐
   │      ├──→  出る（srcSide=right）
   │ icon │
   │      ◄──┤  入る（dstSide=right）
   └──────┘

❌ 間違い: 出る線と入る線が同じ位置で重なる
   ┌──────┐
   │      ├──→
   │ icon ├◄──  ← 同じ座標で重なっている
   └──────┘
```

`spreadPorts`（edgeRouter.postprocess.ts）が同じノード・同じ辺に接続するエッジを辺に沿って均等に分散する。グルーピングは `nodeId:side` で行い、アイコン辺の中央60%（`PORT_RANGE_RATIO=0.6`）を使用範囲として等間隔に配置する。座標は辺の中心から絶対値で設定される。

### 到着方向のルール

到着辺と最後のセグメントの向きは対応する。

| 到着辺 | 最後のセグメント | 意味 |
|--------|-----------------|------|
| top    | ↓（下向き）      | 上から到着 |
| bottom | ↑（上向き）      | 下から到着 |
| left   | →（右向き）      | 左から到着 |
| right  | ←（左向き）      | 右から到着 |

### アイコン貫通禁止ルール

**エッジの線は、自分の始点/終点ノード以外のアイコンの上を通ってはならない。**

```
✅ 正しい: アイコンの外側を迂回する
   ┌───┐
   │ A │
   └───┘
 │         ← アイコンの左外を通る
 │  ┌───┐
 │  │ B │  ← B のアイコンの上は通らない
 │  └───┘
 │
 └──→ C

❌ 間違い: 第三者のアイコンの上を線が通る
   ┌───┐
   │ A │
   └───┘
   │  ┌───┐
   │──│ B │──  ← B のアイコンに線が重なっている
      └───┘
```

`deflectFromIcons`（edgeRouter.postprocess.ts）が全エッジの全セグメントをチェックし、第三者ノードのアイコン矩形を貫通（または境界から2px以内を通過）するセグメントを検出して、アイコンの外側8pxを迂回するウェイポイントを挿入する。自分のsrc/dstノードは除外する。


## ノード種別

### アイコンノード（EC2, ALB, RDS, NAT GW 等）

- `nodeIconRect()` が返す矩形はノード中央のアイコン領域（ノード全体の 65% サイズ、上部寄せ）
- `sideCenter(node, side)` はこのアイコン矩形の辺中央を返す
- BFS は中心→中心でルーティングし、`determineSide()` で最初/最後のグリッド方向から接続辺を決定

### コンテナノード（aws-cloud, vpc, az, subnet）

- `nodeIconRect()` が返す矩形はノード全体（position + size）
- BFS のグリッド方向からの辺決定は不安定（矩形が大きいため中心→中心の方向がルートの出口方向と一致しにくい）
- **`directionToTarget()` で接続辺を決定**: ターゲット中心がソース矩形の外にある方向のうち最も近い辺を選択


## パイプライン

### 1. BFS ルーティング（edgeRouter.ts → edgeRouter.bfs.ts）

```
各エッジについて:
  1. ソース/ターゲットの障害物を一時解除
  2. 中心→中心で BFS 探索（折れ曲がりペナルティ付き Dijkstra）
  3. determineSide() / directionToTarget() で srcSide, dstSide を決定
  4. sideCenter() で始点/終点のピクセル座標を取得
  5. simplifyPath() でグリッドパス → 折れ点のみのウェイポイント列に
  6. 障害物を復元
```

#### determineSide (アイコンノード用)
BFS パスの最初/最後のグリッドセル間の方向から接続辺を決定する。

```
src の場合: グリッドが右に行く(dx>0) → srcSide='right'
dst の場合: グリッドが右に行く(dx>0) → dstSide='left'（右から到着=左辺に接続）
```

#### directionToTarget (コンテナノード用)
ターゲット中心が srcRect の各辺の外にあるかを判定し、最も近い辺を返す。

```
例: srcRect=(100,100,400,300), dstCenter=(50,250)
  distLeft  = 50 - 100 = -50  → 左辺の外 → candidate: left, dist=50
  distRight = 50 - 500 = -450 → 右辺の内 → 候補外
  distTop   = 250 - 100 = 150 → 上辺の内 → 候補外
  distBottom= 250 - 400 = -150 → 下辺の外 → candidate: bottom, dist=150
  → 最小距離 = left (50) ✅
```

### 2. 後処理パイプライン

```
reduceCrossings → nudgeEdges → spreadPorts → deflectFromIcons → enforceEdgeRules
```

#### reduceCrossings（edgeRouter.postprocess.ts）
交差に関与するエッジを交差ペナルティ付き BFS で再ルーティング。交差数が減る場合のみ採用。

**注意**: 再ルーティング時もコンテナノードは `directionToTarget()` で辺を決定する。

#### nudgeEdges（edgeRouter.postprocess.ts）
同一線上を通る複数エッジのセグメントを等間隔にオフセット（NUDGE_STEP=10px）。

### 3. spreadPorts（edgeRouter.postprocess.ts）

enforceEdgeRules で辺座標が確定した後に、同じノード・同じ辺に接続する**全エッジ**（出る線・入る線を区別しない）の接続点を均等に分散する。

**重要ルール**:
- **1本でもスキップしない**: 1本の場合も辺の中央に配置する（enforceEdgeRulesが非中央座標を設定する場合があるため）
- **src/dst を区別しない**: 同じノードの同じ辺に接続する出る線と入る線は同一グループとして扱う

**グルーピング**: `nodeId:side`（例: `node-i-xxx:bottom`）。nodeId に `:` を含むケース（AWS ARN）があるため、最後の `:` で分割する。src/dst 両方が同じキーで同一グループに入る。

**配置ルール**:
```
PORT_RANGE_RATIO = 0.6（辺の中央60%を使用）
usableRange = iconEdgeLength × PORT_RANGE_RATIO
offset[rank] = (rank / (count - 1) - 0.5) × usableRange
absPos = edgeCenter + offset
```

- 1本: 辺の中央（offset = 0）
- 2本: 中央から ±usableRange/2（例: EC2 w=41.6 → ±12.48px）
- 3本: 中央 + ±usableRange/2

座標は絶対値で設定（相対オフセットではない）。端点だけを移動し、隣接WPは動かさず中継WPを挿入して直交性を維持する（BFSの障害物回避経路を破壊しない）。

**ソート**: ターゲットノードの座標（辺に沿った方向）で昇順ソートし、交差を防ぐ。

### 5. アイコン貫通防止（edgeRouter.postprocess.ts: deflectFromIcons）

spreadPorts の後に実行。全エッジの全セグメントを走査し、第三者ノード（src/dst以外）のアイコン矩形との交差を検出する。

**検出**: `segmentIntersectsRect` にバッファ2pxを設定し、アイコン境界ぴったりの線も検出する。

**迂回**: 貫通セグメントを検出した場合、アイコンの外側 MARGIN=8px を通る4つの中継ウェイポイントを挿入してコの字に迂回する。
- 垂直セグメント: アイコンの左右どちらか近い方に迂回
- 水平セグメント: アイコンの上下どちらか近い方に迂回

**再帰チェック**: 挿入した迂回セグメント自体が別のアイコンを貫通する可能性があるため、同じインデックスで再チェックする（maxIter=200で無限ループ防止）。

### 6. enforceEdgeRules（edgeRouter.ts）— 最終ルール適用

パイプラインの**最後**に実行。上流（BFS〜deflectFromIcons）が生成したウェイポイント列に対して、R0〜R3の全ルールを最終適用する「最終防衛線」。

**核心方針**: srcSide/dstSide を変更しない。辺を固定してパスを修正する。コンテナ専用分岐なし（アイコンと同じロジック）。

詳細アルゴリズム: `docs/design/ENFORCE_EDGE_RULES_ALGORITHM.md`

#### enforceStart（始点修正 — R0/R1）
1. wp[0] を srcSide の辺面にスナップ
2. 「法線方向に離れる最初の点」(firstNormalIdx) を探す（spreadPorts 中継WPをスキップ）
3. R1検査 → OK: 直交揃え / NG: escape パス構築（法線方向20px離脱→L字合流）

#### enforceEnd（終点修正 — R0/R2/R3）
1. wp[last] を dstSide の辺面にスナップ
2. 「法線方向から到着する最後の点」(lastNormalIdx) を逆方向走査
3. R2検査 → OK: 直交揃え / NG: approach パス構築
4. ensureFinalSegment: 最終セグメントが法線方向を向くことを保証（R3）

### 7. 描画（EdgeLine.tsx）

EdgeLine.tsx は描画のみ担当。ルール適用は一切行わない。`routedEdge.waypoints` をそのまま `pointsToPath` で SVG パスに変換する。


## 矢印マーカー

| id | サイズ | 用途 |
|----|-------|------|
| `arrowhead` | 8×6 px | 通常表示 |
| `arrowhead-lg` | 16×12 px | ハイライト表示（クリック選択時） |

- `markerUnits="userSpaceOnUse"`: ズームに依存しない固定サイズ
- `orient="auto"`: パスの進行方向に自動回転


## 線のスタイル

| type | stroke | dash | 用途 |
|------|--------|------|------|
| `data-flow` | `#94a3b8` (slate-400) | 実線 | SG ルールベースの通信パス |
| その他 | `#cbd5e1` (slate-300) | `6 3` 破線 | 関連接続 |

| 状態 | strokeWidth |
|------|------------|
| 通常 | 1.5 px |
| ハイライト | 3.5 px |


## 既知の問題と制約

### spreadPorts による辺ずれ
同じ辺に複数エッジが接続する場合、辺に沿って分散するため始点/終点が辺中央からオフセットされる。`PORT_RANGE_RATIO=0.6` により辺の両端20%は余白として確保されるため、アイコン端に線が接続することはない。

### simplifyPath による重複ウェイポイント
`simplifyPath` がグリッドパスを折れ点に簡略化する際、始点/終点が同一座標になることがある。`removeDuplicateWaypoints` で除去し、`enforceStart`/`enforceEnd` は次の異なる点を探して方向を判定する。

### enforceStart/enforceEnd の競合防止
`enforceEnd` の 6b（approach パス構築）は wp[0]〜wp[1] を保護して enforceStart の修正を壊さない。6a の直交揃えも lastNormalIdx==0 の場合は wp[0] を変更しない。

### BFS のアイコン突き抜けパス
BFS が中心→中心で探索するため、srcSide と実際のパス方向が逆になるケースがある。`enforceStart`/`enforceEnd` が R1/R2 違反を検出し、escape/approach パス（法線方向20px離脱→L字合流）で矯正する。

### BFS グリッド解像度
GRID_SIZE=20px のため、アイコン矩形の正確な辺座標とグリッドセル座標にずれがある。簡略化後のウェイポイントは `sideCenter()` の座標に置換されるが、中間折れ点はグリッド座標のまま。


## ファイル構成

| ファイル | 責務 |
|---------|------|
| `edgeRouter.types.ts` | 型定義、定数、共有ユーティリティ（nodeIconRect, sideCenter, bestSides, directionToTarget, pointsToPath） |
| `edgeRouter.bfs.ts` | グリッド構築、BFS 探索、determineSide、simplifyPath、fallbackRoute |
| `edgeRouter.postprocess.ts` | reduceCrossings, spreadPorts, nudgeEdges, deflectFromIcons |
| `edgeRouter.ts` | オーケストレータ（routeAllEdges）、enforceEdgeRules、re-export |
| `EdgeLine.tsx` | 描画コンポーネント（描画のみ、ルール適用なし） |
| `DiagramCanvas.tsx` | SVG defs（矢印マーカー定義）、全体描画 |
