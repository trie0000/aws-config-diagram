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
reduceCrossings → nudgeEdges → enforceEdgeRules → spreadPorts
```

#### reduceCrossings（edgeRouter.postprocess.ts）
交差に関与するエッジを交差ペナルティ付き BFS で再ルーティング。交差数が減る場合のみ採用。

**注意**: 再ルーティング時もコンテナノードは `directionToTarget()` で辺を決定する。

#### nudgeEdges（edgeRouter.postprocess.ts）
同一線上を通る複数エッジのセグメントを等間隔にオフセット（NUDGE_STEP=10px）。

### 3. enforceEdgeRules（edgeRouter.ts）

nudgeEdges の完了後に、全エッジに対して3ルールを最終適用する。

#### 前処理: removeDuplicateWaypoints
連続する重複ウェイポイント（距離1px以内）を除去する。`simplifyPath` が始点/終点に同一座標を生成する場合がある。

#### enforceStart（始点修正）

**アイコンノード:**
1. 最初のセグメント方向 (dx, dy) を確認（wp[0]==wp[1] の場合は次の異なる点を探す）
2. 方向から正しい srcSide を逆算（右に行く → right、下に行く → bottom 等）
3. **逆方向検出**: 始点座標が辺Aにあるのに correctSide が辺B（反対辺）の場合、パスがアイコンを突き抜けている。パスの2番目以降の方向変化から本来の進行方向を推測し、L字パスに再構築する。
   - 例: bottom辺から出て上に行く(correctSide='top') → 2番目のセグメントが左に行く → `left`辺から出るL字パスに再構築
4. 逆方向でない場合: 辺に垂直な座標を辺面に固定、辺に平行な座標（spreadPorts オフセット）は保持
5. 2番目のウェイポイントも辺方向に揃える

**コンテナノード:**
1. `directionToTarget()` で正しい出口辺を決定
2. `sideCenter()` で出口座標を取得
3. ウェイポイント全体を L 字パスに再構築: `[出口点, 中継点, 終点]`

#### enforceEnd（終点修正）

**アイコンノード:**
1. 最後のセグメント方向から到着辺を逆算（pEnd==pPrev の場合はさらに前の異なる点を探す）
2. **逆方向検出**: 終点座標が辺Aにあるのに correctSide が辺B（反対辺）の場合、パスの末尾近くの折れ点から本来の到着方向を推測し、L字パスに再構築する。
3. 逆方向でない場合: 辺に垂直な座標を辺面に固定
4. `wp[last-1]` が始点 (index 0) の場合は上書きしない（enforceStart の修正を保護）

**コンテナノード:**
1. `directionToTarget()` で到着辺を決定
2. L 字パスに再構築: `[始点, 中継点, 到着点]`

### 4. spreadPorts（edgeRouter.postprocess.ts）

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

座標は絶対値で設定（相対オフセットではない）。隣接するウェイポイントが同一座標だった場合は連動して移動させる。

**ソート**: ターゲットノードの座標（辺に沿った方向）で昇順ソートし、交差を防ぐ。

### 5. 描画（EdgeLine.tsx）

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

### 2点ウェイポイントの enforceEnd 競合
ウェイポイントが2点のみの場合、`enforceEnd` が `wp[last-1]`（= wp[0]）を変更すると `enforceStart` の修正が上書きされる。`enforceEnd` は `last-1 == 0` の場合 `wp[0]` を変更しないことで保護する。

### BFS のアイコン突き抜けパス
BFS が中心→中心で探索するため、小さいアイコンノードでは始点がbottom辺にあるのにパスがアイコンを上方向に突き抜けるケースがある。`enforceStart`/`enforceEnd` の逆方向検出がこれを捕捉し、パスの2番目以降の方向変化から本来の進行方向を推測してL字パスに再構築する。

### BFS グリッド解像度
GRID_SIZE=20px のため、アイコン矩形の正確な辺座標とグリッドセル座標にずれがある。簡略化後のウェイポイントは `sideCenter()` の座標に置換されるが、中間折れ点はグリッド座標のまま。


## ファイル構成

| ファイル | 責務 |
|---------|------|
| `edgeRouter.types.ts` | 型定義、定数、共有ユーティリティ（nodeIconRect, sideCenter, bestSides, directionToTarget, pointsToPath） |
| `edgeRouter.bfs.ts` | グリッド構築、BFS 探索、determineSide、simplifyPath、fallbackRoute |
| `edgeRouter.postprocess.ts` | reduceCrossings, spreadPorts, nudgeEdges |
| `edgeRouter.ts` | オーケストレータ（routeAllEdges）、enforceEdgeRules、re-export |
| `EdgeLine.tsx` | 描画コンポーネント（描画のみ、ルール適用なし） |
| `DiagramCanvas.tsx` | SVG defs（矢印マーカー定義）、全体描画 |
