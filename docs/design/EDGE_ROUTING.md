# エッジルーティング アルゴリズム仕様書 v12.0

## 概要

アイコン間の接続線を、水平・垂直セグメントのみで構成される直交パスとしてルーティングする。
グリッドも力学シミュレーションも使わず、ピクセル座標上で候補パスを生成・評価する決定的アルゴリズム。

## 接続線のルール

1. 距離が短い矢印から先にルーティング
2. アイコンの辺から法線ベクトル方向に出る（角には繋げない）
3. 矢印は自身のアイコン・相手のアイコン・途中のアイコンの中を通らない
4. アイコンの縁も通してはいけない
5. 接続線は水平か垂直のいずれかで、斜めは使わない
6. 折り曲がりの数が最小になる経路を選ぶ
7. 同じ曲がり数なら一番距離が短い経路を選ぶ
8. 異なる経路の矢印は交差はOKだが、重なりはNG
9. 同じアイコンの辺に繋がる経路は最低限の間隔(4px)が空いていればOK（等間隔不要）
10. 複数経路がある場合、他の経路との交差が最も少ない経路を選ぶ
11. 交差が減る場合、同じアイコンの辺に繋がる接続線の順番は入れ替えてよい

### ルール優先順位（評価順）

ルール6 > ルール10 > ルール7 の順。
つまり: 曲がり最小 → 交差最少 → 距離最短。

## パイプライン

```
Phase 0: 準備
  collectIconRects → iconMap
  エッジを距離順ソート（ルール1）

Phase 1: 各エッジのルーティング（edgeRouter.bfs.ts）
  bestSides() → srcSide, dstSide
  sideCenterPt() → srcPt, dstPt
  obstacles = 全アイコン（src/dst 含む）
  findOrthogonalPath() → waypoints
  recordUsedSegments() → usedSegs に登録

Phase 2: ポート分散（edgeRouter.postprocess.ts: spreadPorts）
  同一アイコン辺のポートが近すぎたら分散（ルール9）
  交差が減るならポート順を入れ替え（ルール11）
  端点移動時、stem点も連動スライド（ルール2保証）

Phase 3: アイコン貫通防止（edgeRouter.postprocess.ts: deflectFromIcons）
  全アイコン（src/dst 含む）を貫通するセグメントを迂回
  ただしstemセグメント（最初と最後の法線方向セグメント）はスキップ
```

## Phase 1: パス探索（findOrthogonalPath）

### 用語

- **接続点（srcPt / dstPt）**: アイコン辺面の中央座標。パスの始点・終点。
- **ステム（stem）**: 接続点から法線方向に STEM_LEN(20px) 延伸した点。ここが実質的なルーティングの起点・終点。
- **障害物**: 全アイコン矩形（src/dst 含む）。MARGIN(12px) の余白を含めて判定する。

### パス構造

```
srcPt → srcStem → (中間経路) → dstStem → dstPt
```

srcPt→srcStem と dstStem→dstPt は必ず法線方向の直線（ルール2）。
中間経路は水平・垂直セグメントのみ（ルール5）。

**重要**: pathClear ではstemセグメント（srcPt→srcStem, dstStem→dstPt）をチェック対象から除外する。
stemは必ずアイコン辺面から法線方向に延びるため、自ノードのアイコン内を通過するが、
これは接続の構造上不可避であり、ルール3/4の例外とする。
チェック対象は srcStem→...→dstStem の中間経路のみ。

### 候補生成

曲がり数が少ない順に候補を生成する:

1. **直線**（0曲がり）: srcStem と dstStem が同一軸上の場合のみ
2. **L字**（1曲がり）: 水平→垂直、垂直→水平 の2通り
3. **Z字**（2曲がり）: 7比率 × 5ナッジ = 35通り
   - 比率: [0.5, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9]（中間チャネルの位置）
   - ナッジ: [0, ±NUDGE(16), ±2×NUDGE(32)]（重なり回避用のオフセット）
4. **迂回**（3+曲がり）: 障害物の4角(+MARGIN) を経由点として L字×L字 で結合
   - 角座標を ±NUDGE ずらした候補も追加

最大候補数: MAX_CANDIDATES(200)

### 評価

2パスで評価する:

**第1パス（厳格）**: 障害物クリア AND 重なりなし → 曲がり最小 → 交差最少 → 距離最短

```
for each candidate:
  if !pathClear(中間経路, obstacles, MARGIN=12): skip
  if pathOverlaps(usedSegs): skip
  score = (bends, crossings, distance) ← 辞書順で最小を選択
```

**第2パス（フォールバック）**: 第1パスで見つからない場合。重なりを許容するが最小化する。

```
for each candidate:
  if !pathClear(中間経路, obstacles, MARGIN=12): skip
  score = (overlapPx, bends, crossings, distance) ← 辞書順で最小を選択
```

**最終フォールバック**: 全候補が障害物と交差する場合、fallbackRoute で単純Z字を返す。

### 重なり検出（UsedSegments）

区間ベースで部分重なりを検出する。

- 水平セグメント: y座標でグルーピング。同じ y（±OVERLAP_TOL=4px）の区間同士で重なりを計算
- 垂直セグメント: x座標でグルーピング。同じ x（±OVERLAP_TOL=4px）の区間同士で重なりを計算
- `overlaps()`: 重なりが OVERLAP_TOL px を超えるか（boolean）
- `overlapLength()`: 重なり合計px数（フォールバック評価用）

### 障害物判定（pathClear）

中間経路の全セグメント（stemセグメントを除く）が全障害物矩形（±MARGIN=12px 拡張）と交差しないか確認。
境界ぴったり（`<=` / `>=`）は交差なしと判定する。

**v12.0の変更点**: src/dstのアイコンも障害物リストに含める。stemセグメントは検査対象外とすることで、
自ノードのstem部分は許容しつつ、中間経路がsrc/dstアイコンを貫通するのを防止する（ルール3/4）。

## Phase 2: ポート分散（spreadPorts）

### 目的

同じアイコンの同じ辺から出入りする複数エッジの接続点が重ならないようにする（ルール9）。

### アルゴリズム

1. 全エッジの端点を `nodeId:side` でグルーピング（src/dst 区別なし）
2. ターゲット座標でソート（辺に沿った自然順）
3. **Rule 11**: グループが 2〜6本なら全順列(N!)を試行し、交差が最も少ない順序を採用
4. 全ペアの間隔が MIN_PORT_GAP(4px) 以上なら何もしない
5. 間隔不足なら辺の中央 PORT_RANGE_RATIO(60%) の範囲に均等分散
6. **端点移動時、stem点（wp[1] or wp[last-1]）も連動スライドする**（ルール2保証）
   - srcのleft/right辺: wp[0].yとwp[1].yを同じ値にスライド
   - srcのtop/bottom辺: wp[0].xとwp[1].xを同じ値にスライド
   - dstも同様にwp[last]とwp[last-1]を連動

### stem連動スライドの詳細

spreadPorts で端点を辺に沿ってスライドさせる際、stem点も同方向に同量スライドする。

```
例: srcSide=right, 端点(x+w, cy)→(x+w, cy+10) にスライド
  → wp[0] = (x+w, cy+10)
  → wp[1] = (x+w+20, cy+10)   ← stem点もy方向に+10
  → wp[0]→wp[1] は水平 = 法線方向（right）を維持
```

これにより:
- ルール2: 法線方向のstemセグメントが常に保持される
- ルール3/4: stemセグメントがself-nodeの縁に沿うことがない
- ルール5: 斜めセグメントが発生しない（ensureOrthogonal不要）

**stem連動後の斜め修復**: wp[1]→wp[2]（またはwp[last-2]→wp[last-1]）が斜めになる可能性がある。
これは wp[2]の座標をstem方向の軸に合わせて修正する:
- left/right辺（水平stem）: wp[2].yをwp[1].yに合わせる必要はない。
  wp[1]→wp[2]が斜めなら、中継点 {x: wp[2].x, y: wp[1].y} を挿入。
- top/bottom辺（垂直stem）: wp[1]→wp[2]が斜めなら、中継点 {x: wp[1].x, y: wp[2].y} を挿入。

### 定数

| 定数 | 値 | 意味 |
|------|-----|------|
| MIN_PORT_GAP | 4px | これ未満なら分散が必要 |
| PORT_RANGE_RATIO | 0.6 | 辺長の60%を使用 |

## Phase 3: アイコン貫通防止（deflectFromIcons）

### 目的

spreadPorts によるポート移動後、中間経路のセグメントがアイコンを貫通する可能性がある。
これを検出・修復する。

### v12.0の変更点

**src/dst ノードも検出対象に含める**。ただし stemセグメントはスキップする。

stemセグメントの判定:
- エッジの最初の2点 (wp[0]→wp[1]) はsrcのstemセグメント → スキップ
- エッジの最後の2点 (wp[last-1]→wp[last]) はdstのstemセグメント → スキップ
- それ以外のセグメントは全アイコン（src/dst含む）に対してチェック

### アルゴリズム

1. 全アイコンノードの矩形を収集
2. 各エッジのセグメントを走査（stemセグメント si=0, si=last-1 をスキップ）
3. 全アイコンとの交差を検出（buffer=DETECT=2px で境界上も検出）
4. 交差発見時:
   - 垂直セグメント → アイコンの左右どちらか(MARGIN=8px) に迂回WP 4点挿入
   - 水平セグメント → アイコンの上下どちらか(MARGIN=8px) に迂回WP 4点挿入
5. 迂回挿入後、同じインデックスで再チェック（新セグメントも貫通する可能性）
6. 無限ループ防止: maxIter=200

## 定数一覧

| 定数 | ファイル | 値 | 意味 |
|------|---------|-----|------|
| MARGIN | edgeRouter.bfs.ts | 12px | pathClear の障害物回避マージン |
| STEM_LEN | edgeRouter.bfs.ts | 20px | 法線方向のステム長 |
| MAX_CANDIDATES | edgeRouter.bfs.ts | 200 | 候補パスの最大数 |
| OVERLAP_TOL | edgeRouter.bfs.ts | 4px | 重なり検出の許容幅 |
| NUDGE | edgeRouter.bfs.ts | 16px | Z字/迂回パスのナッジ幅 |
| MIN_PORT_GAP | edgeRouter.postprocess.ts | 4px | ポート間の最低間隔 |
| PORT_RANGE_RATIO | edgeRouter.postprocess.ts | 0.6 | ポート分散の使用範囲 |
| MARGIN (deflect) | edgeRouter.postprocess.ts | 8px | 迂回マージン |
| DETECT | edgeRouter.postprocess.ts | 2px | 境界検出バッファ |

## ファイル構成

| ファイル | 責務 |
|---------|------|
| `edgeRouter.types.ts` | 型定義、定数、bestSides、nodeIconRect |
| `edgeRouter.bfs.ts` | 候補パス生成・評価、UsedSegments、findOrthogonalPath |
| `edgeRouter.postprocess.ts` | spreadPorts、deflectFromIcons、optimizePortOrder |
| `edgeRouter.ts` | オーケストレータ（routeAllEdges） |
| `EdgeLine.tsx` | 描画（waypoints → SVG path） |

## 描画

### 矢印マーカー

| id | サイズ | 用途 |
|----|-------|------|
| `arrowhead` | 8×6 px | 通常表示 |
| `arrowhead-lg` | 16×12 px | ハイライト表示 |

### 線のスタイル

| type | stroke | dash | 用途 |
|------|--------|------|------|
| `data-flow` | `#94a3b8` (slate-400) | 実線 | SG ルールベース通信パス |
| その他 | `#cbd5e1` (slate-300) | `6 3` 破線 | 関連接続 |

| 状態 | strokeWidth |
|------|------------|
| 通常 | 1.5 px |
| ハイライト | 3.5 px |

## v11.0 → v12.0 変更点まとめ

| 項目 | v11.0 | v12.0 | 理由 |
|------|-------|-------|------|
| obstacles | src/dst除外 | **全アイコン含む** | ルール3/4: self-node貫通防止 |
| pathClear対象 | パス全体 | **stemセグメント除外** | stemは構造上自ノードを通過するため |
| spreadPorts端点移動 | 端点のみ移動+ensureOrthogonal | **stem点も連動スライド** | ルール2: 法線方向保証 |
| ensureOrthogonal | 中継WP挿入 | **stem連動+斜め修復** | ルール2/3/4: self-node縁通過防止 |
| deflectFromIcons | src/dst完全スキップ | **stemセグメントのみスキップ** | ルール3/4: self-node貫通検出 |
