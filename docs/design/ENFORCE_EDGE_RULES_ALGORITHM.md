# enforceEdgeRules アルゴリズム設計書

## 目的

パイプライン上流（BFS → reduceCrossings → nudgeEdges → spreadPorts → deflectFromIcons）が生成したウェイポイント列に対して、EDGE_ROUTING.md のルールを最終適用する。

## 守るべきルール

### R0: 直交保証（不変条件）
全セグメントは水平（dy==0）または垂直（dx==0）でなければならない。斜め線は禁止。
enforceEdgeRules が座標を変更したり WP を挿入する際、この不変条件を絶対に破ってはならない。

**具体的な保証方法**:
- スナップ: 1軸のみ変更（辺に垂直な座標を辺面値に固定）
- 直交揃え: 1軸のみ変更（平行軸を前後の点に合わせる）
- 中継点挿入: 斜めになる箇所に L字の角を挿入して2つの直交セグメントに分解
- escape/approach 挿入: escapePt は法線方向のみ移動、joinPt は L字角

### R1: 出口方向の一致
線がノードの辺Xから出発するなら、**辺から法線方向に離れる最初の動き**はその辺の法線方向でなければならない。

| srcSide | 法線方向 | 座標の変化 |
|---------|---------|-----------|
| right   | →       | x増加     |
| left    | ←       | x減少     |
| bottom  | ↓       | y増加     |
| top     | ↑       | y減少     |

**注意**: spreadPorts による辺面上の移動（法線方向の変位ゼロ）は法線方向の動きではないためスキップする。

### R2: 到着方向の一致
線がノードの辺Yに到着するなら、**辺の法線方向から到着する最後の動き**はその辺に向かう方向でなければならない。

| dstSide | 法線方向 | 座標の変化 |
|---------|---------|-----------|
| top     | ↓（上から到着）| y減少→y |
| bottom  | ↑（下から到着）| y増加→y |
| left    | →（左から到着）| x減少→x |
| right   | ←（右から到着）| x増加→x |

### R3: 矢印マーカー方向の一致
SVG の `markerEnd` + `orient="auto"` は**最終セグメント（wp[last-1]→wp[last]）の方向**に矢印三角を回転する。
したがって、**最終セグメント自体**が dstSide の法線方向を向いていなければ矢印が間違った方向を向く。

**R2 は「法線方向に離れる最後の点」で検査するが、その点と wp[last] の間に辺面上の中継WP（spreadPorts挿入）が残っていると、最終セグメントが辺面平行になり矢印がズレる。**

```
例: ...→(250,300)→(250,400)→(270,400)  dstSide='bottom'
lastNormalIdx=0番目の(250,300) → R2 OK（上から到着）
しかし最終セグメント (250,400)→(270,400) は水平 → 矢印が水平右向き → NG
```

**対策: enforceEnd の最後に「最終セグメント法線方向保証」を実行する。**

```
ensureFinalSegment:
  last = wp.length - 1
  if last < 2: return  // 2点パスは最終セグメント=唯一のセグメント、6a/6bで対処済み

  法線軸変位 = |wp[last][normalAxis] - wp[last-1][normalAxis]|
  if 法線軸変位 > 1: return  // 最終セグメントは既に法線方向 → OK

  // 最終セグメントが辺面平行
  // → wp[last-1]（辺面上の中継WP）を除去し、L字中継で最終セグメントを法線方向にする

  1. wp[last-1] を除去
  2. last = wp.length - 1  // 更新
  3. if last < 1: return    // 安全チェック
  4. wp[last-1]→wp[last] が斜めか検査:
     dx = |wp[last-1].x - wp[last].x|
     dy = |wp[last-1].y - wp[last].y|
     if dx > 1 && dy > 1:
       // 斜め → L字中継点を wp[last] の直前に挿入
       - normalAxis='y': 中継 = { x: wp[last].x, y: wp[last-1].y }
       - normalAxis='x': 中継 = { x: wp[last-1].x, y: wp[last].y }
       wp.splice(last, 0, 中継)
```

**トレース例**:
```
入力: (250,300)→(250,400)→(270,400)  dstSide='bottom', normalAxis='y'
last=2, 法線軸変位=|400-400|=0 → 辺面平行 → 修正が必要

1. wp[1]=(250,400) を除去 → (250,300)→(270,400)
2. last=1
3. last >= 1 → OK
4. dx=|250-270|=20, dy=|300-400|=100 → 両方>1 → 斜め
   中継 = { x: 270, y: 300 }
   splice(1, 0, 中継) → (250,300)→(270,300)→(270,400)

最終セグメント: (270,300)→(270,400) = 垂直下向き → R3 OK ✅
R0: (250,300)→(270,300) 水平 ✅, (270,300)→(270,400) 垂直 ✅
曲がり数: 変更前2回 → 変更後1回 → 曲がり減少 ✅
```

**enforceStart 側の R3 対策は不要。** `markerEnd` は終端のみに配置されるため、始点側の最初のセグメント方向は矢印マーカーに影響しない。

## パイプライン順序

```
BFS → reduceCrossings → nudgeEdges → spreadPorts → deflectFromIcons → enforceEdgeRules
```

**最後に実行する。** 理由:
- spreadPorts/deflectFromIcons の後にルール検査・修正する必要がある
- enforceEdgeRules は上流の変形に対する「最終防衛線」

## スコープと責務分担

| ルール | 担当 | enforceEdgeRules の関与 |
|--------|------|----------------------|
| R0 直交保証 | BFS + enforceEdgeRules | 座標変更/WP挿入時に不変条件を維持 |
| R1 出口方向 | enforceEdgeRules | 端点スナップ + 方向矯正 |
| R2 到着方向 | enforceEdgeRules | 端点スナップ + 方向矯正 |
| R3 矢印マーカー | enforceEdgeRules | ensureFinalSegment |
| 出入り分離 | spreadPorts | enforceEdgeRules は関与しない |
| 交差削減 | reduceCrossings | enforceEdgeRules は関与しない |
| セグメント重なり防止 | nudgeEdges | enforceEdgeRules は関与しない |
| アイコン貫通防止 | deflectFromIcons | enforceEdgeRules は関与しない |

### enforceEdgeRules が上流の重なり防止を破壊しないか

**結論: 端点付近では破壊しうる。ただし実害は限定的。**

- **6a 直交揃え**: firstNormalIdx の平行軸を前の点に揃える。nudgeEdges が端点付近のセグメントをオフセットしていた場合、その座標を上書きする可能性がある。ただし nudgeEdges は `wp[si]` と `wp[si+1]` の両端をオフセットするので、直交揃えで崩れるケースは限定的。
- **6b escape/approach 挿入**: 新セグメント（ESCAPE_LEN=20px）が他エッジの既存セグメントと重なる可能性はゼロではない。ただしR1/R2違反時のみ発動する稀なケースであり、固定の20px離脱で重なりが起きる確率は低い。
- **ensureFinalSegment**: wp[last-1] の平行軸を wp[last] に合わせる。端点直近の1セグメントのみの変更で影響範囲は小さい。

**重なり防止は nudgeEdges の責務であり、enforceEdgeRules がこれを完全に保証する必要はない。** enforceEdgeRules が生成するセグメントは端点付近の短い区間に限定されるため、重なりが起きても視覚的な影響は小さい。重なりが頻発する場合は、enforceEdgeRules 後に nudgeEdges を再実行することで対処可能（現時点では実装しない）。

### 曲がりの最小化

**enforceEdgeRules は曲がりを積極的に最小化する機構を持たない。** BFS が曲がりペナルティ付きで最短パスを選んでおり、enforceEdgeRules はその結果を尊重する。

各操作が曲がりに与える影響:
- **6a 直交揃え**: 曲がり増加なし。中継点挿入は斜め→L字の分解であり見た目上の曲がり数は不変。
- **6b escape/approach**: 最大2曲がり追加。ただしR1/R2違反の矯正に必要な最小限。
- **ensureFinalSegment**: 辺面上の中継WPを除去しL字中継に置換。曲がり数は同じか減少。

**6b は元パスの中間部分（wp[1..k-1]）を捨てる。** これはBFSの障害物回避パスを失う可能性がある。wp[k] はなるべく firstNormalIdx に近い点を選び、元のパスを最大限保持すべき。ただし R1/R2違反自体が稀なケースなので、実害は限定的。

## 核心方針

**enforceEdgeRules は srcSide/dstSide を変更しない。**

理由:
- BFS の `determineSide()` がグリッドの出口方向から適切な辺を決定済み
- コンテナは `directionToTarget()` がターゲット位置から適切な辺を決定済み
- `reduceCrossings` も再ルーティング時に同じロジックで辺を再決定済み
- これらの辺決定はパスの大域的な方向に基づいており、信頼できる

**問題は「辺の決定」ではなく「辺に対してパスの端が合っていない」こと。enforceEdgeRules は辺を固定してパスを修正する。**

## コンテナノードの扱い

**アイコンノードと同じロジックを使う。コンテナ専用の分岐・L字再構築は行わない。**

理由:
- BFS + directionToTarget が srcSide/dstSide を正しく決定済み
- simplifyPath が端点を sideCenter() の座標に設定済み
- L字再構築はBFSの障害物回避パスを完全に破棄してしまう

## アルゴリズム詳細

### 前処理
```
removeDuplicateWaypoints(r)  // 連続する同一座標（1px以内）を除去
```

### enforceStart(r, srcNode)

**目的**: wp[0] が srcSide の辺面上にあり、辺から法線方向に離れる最初の動きが正しい方向を向くようにする。

**入力**: r.waypoints, r.srcSide（読み取りのみ、変更しない）

```
手順:
  1. srcRect = nodeIconRect(srcNode)

  2. wp[0] を srcSide の辺面にスナップ
     - top:    wp[0] = { x: clamp(wp[0].x, rect.x, rect.x+rect.w), y: rect.y }
     - bottom: wp[0] = { x: clamp(wp[0].x, rect.x, rect.x+rect.w), y: rect.y+rect.h }
     - left:   wp[0] = { x: rect.x, y: clamp(wp[0].y, rect.y, rect.y+rect.h) }
     - right:  wp[0] = { x: rect.x+rect.w, y: clamp(wp[0].y, rect.y, rect.y+rect.h) }

  3. 法線軸を特定:
     - top/bottom → y軸（normalAxis='y'）
     - left/right → x軸（normalAxis='x'）

  4. 「法線方向に離れる最初の点」を探す:
     normalValue = wp[0] の法線軸の値
     for i = 1 to wp.length-1:
       if |wp[i][normalAxis] - normalValue| > 1:
         firstNormalIdx = i
         break
     見つからない場合 → パスが辺面と平行にしか動かない → 何もしない（return）

  5. R1検査: wp[firstNormalIdx] が法線方向側にあるか？
     - bottom: wp[firstNormalIdx].y > normalValue ?
     - top:    wp[firstNormalIdx].y < normalValue ?
     - right:  wp[firstNormalIdx].x > normalValue ?
     - left:   wp[firstNormalIdx].x < normalValue ?

  6a. R1を満たす場合:
     wp[firstNormalIdx] の平行軸座標を直前の点に揃える
     （法線方向のセグメントを純粋な垂直/水平にする）:

     prevPt = wp[firstNormalIdx - 1]
     - normalAxis='y' の場合: wp[firstNormalIdx].x = prevPt.x
     - normalAxis='x' の場合: wp[firstNormalIdx].y = prevPt.y

     ただし、この変更で wp[firstNormalIdx]→wp[firstNormalIdx+1] が斜めになるリスクがある。
     対策: firstNormalIdx+1 が存在し、かつ次セグメントが斜め
     （2軸とも変化: |dx|>1 かつ |dy|>1）になる場合、
     wp[firstNormalIdx] と wp[firstNormalIdx+1] の間に中継点を挿入:
     - normalAxis='y' の場合（firstNormalIdxで垂直→次は水平に転換すべき）:
       中継点 = { x: wp[firstNormalIdx].x, y: wp[firstNormalIdx+1].y }
       ※ ただし中継点がwp[firstNormalIdx+1]と同一なら挿入不要
     - normalAxis='x' の場合:
       中継点 = { x: wp[firstNormalIdx+1].x, y: wp[firstNormalIdx].y }

     → 完了

  6b. R1を満たさない場合（パスが反対方向に行こうとしている）:
     法線方向に離脱する「エスケープ」パスを構築する。

     ESCAPE_LEN = 20px
     escapePt = wp[0] + 法線方向 × ESCAPE_LEN
       - bottom: { x: wp[0].x, y: wp[0].y + ESCAPE_LEN }
       - top:    { x: wp[0].x, y: wp[0].y - ESCAPE_LEN }
       - right:  { x: wp[0].x + ESCAPE_LEN, y: wp[0].y }
       - left:   { x: wp[0].x - ESCAPE_LEN, y: wp[0].y }

     「合流先」を探す:
     接続先 = wp[firstNormalIdx]（法線方向に初めて離れる点、ただし反対方向なのでその先の有意な点）
     実装上は wp 全体を見て、escapePt から直交L字で接続できる最初の点 wp[k] を探す。
     具体的には: k = firstNormalIdx から wp.length-1 まで走査し、
       escapePt と wp[k] が少なくとも1軸で値が近い（L字で繋がる）点を採用。

     見つからない場合: k = wp.length - 1（終点）を使う。

     joinPt = L字の角:
     - normalAxis='y': { x: wp[k].x, y: escapePt.y }
     - normalAxis='x': { x: escapePt.x, y: wp[k].y }

     wp[1..k-1] を [escapePt, joinPt] に置換:
     新 waypoints = [wp[0], escapePt, joinPt, wp[k], wp[k+1], ...]

     ※ joinPt == escapePt の場合（同軸）は joinPt を省略
     ※ joinPt == wp[k] の場合（同軸）は joinPt を省略
```

### enforceEnd(r, dstNode)

**目的**: wp[last] が dstSide の辺面上にあり、辺の法線方向から到着する最後の動きが正しい方向を向くようにする。

**入力**: r.waypoints, r.dstSide（読み取りのみ、変更しない）

```
手順:
  1. dstRect = nodeIconRect(dstNode)

  2. wp[last] を dstSide の辺面にスナップ（enforceStart と同じロジック）

  3. 法線軸を特定（enforceStart と同じ）

  4. 「法線方向から到着する最後の点」を探す（逆方向に走査）:
     normalValue = wp[last] の法線軸の値
     for i = last-1 downto 0:
       if |wp[i][normalAxis] - normalValue| > 1:
         lastNormalIdx = i
         break
     見つからない場合 → 何もしない（return）

  5. R2検査: wp[lastNormalIdx] が法線方向の反対側（=到着方向）にあるか？
     - top:    wp[lastNormalIdx].y < normalValue ?（上にある = 上から到着 = ↓）
     - bottom: wp[lastNormalIdx].y > normalValue ?（下にある = 下から到着 = ↑）
     - left:   wp[lastNormalIdx].x < normalValue ?（左にある = 左から到着 = →）
     - right:  wp[lastNormalIdx].x > normalValue ?（右にある = 右から到着 = ←）

  6a. R2を満たす場合:
     wp[lastNormalIdx] の平行軸座標を直後の点に揃える
     （法線方向のセグメントを純粋な垂直/水平にする）:

     nextPt = wp[lastNormalIdx + 1]
     - normalAxis='y' の場合: wp[lastNormalIdx].x = nextPt.x
     - normalAxis='x' の場合: wp[lastNormalIdx].y = nextPt.y

     ただし lastNormalIdx == 0 の場合は wp[0] を保護（enforceStart の修正を壊さない）。

     また、この変更で wp[lastNormalIdx-1]→wp[lastNormalIdx] が斜めになるリスクがある。
     対策: lastNormalIdx-1 >= 0 で、lastNormalIdx-1 != 0（wp[0]保護）かつ
     前セグメントが斜め（2軸とも変化）になる場合、
     wp[lastNormalIdx-1] と wp[lastNormalIdx] の間に中継点を挿入:
     - normalAxis='y' の場合:
       中継点 = { x: wp[lastNormalIdx].x, y: wp[lastNormalIdx-1].y }
     - normalAxis='x' の場合:
       中継点 = { x: wp[lastNormalIdx-1].x, y: wp[lastNormalIdx].y }

     → 完了

  6b. R2を満たさない場合:
     法線方向からの「アプローチ」パスを構築する。

     APPROACH_LEN = 20px
     approachPt = wp[last] + 到着方向 × APPROACH_LEN
       - top:    { x: wp[last].x, y: wp[last].y - APPROACH_LEN }
       - bottom: { x: wp[last].x, y: wp[last].y + APPROACH_LEN }
       - left:   { x: wp[last].x - APPROACH_LEN, y: wp[last].y }
       - right:  { x: wp[last].x + APPROACH_LEN, y: wp[last].y }

     「合流元」を探す（逆方向に走査）:
     k = lastNormalIdx から 1 まで走査し、approachPt から直交L字で接続できる点を探す。
     見つからない場合: k = 1（wp[1]）を使う。
     **重要: k >= 1 を保証する（wp[0]〜wp[1] は enforceStart が修正済みのため保護する）。**

     joinPt = L字の角（enforceStart と対称）

     wp[k+1..last-1] を [joinPt, approachPt] に置換:
     新 waypoints = [..., wp[k], joinPt, approachPt, wp[last]]
```

### 後処理
```
removeDuplicateWaypoints(r)  // 挿入で生じた重複を除去
```

## パイプラインでの実行順

```
for each RoutedEdge r:
  removeDuplicateWaypoints(r)
  enforceStart(r, srcNode)
  enforceEnd(r, dstNode)
  removeDuplicateWaypoints(r)
```

## エッジケース

### EC1: 2点ウェイポイント（直線パス）
wp = [A, B]
- enforceStart: wp[0]をスナップ。firstNormalIdx=1。wp[1]の法線軸が異なれば検査。
- enforceEnd: wp[last]=wp[1]をスナップ。lastNormalIdx=0。
  - lastNormalIdx == 0 → wp[0]保護。直交揃えをスキップ。
- R1/R2が共に満たされるなら端点スナップのみ。
- R1/R2が満たされない場合、escape/approach挿入で3-4点になる。

### EC2: 辺面上で終始するパス
全WPが辺面と同じ法線軸の値を持つ場合（直線が辺に平行）。
- firstNormalIdx/lastNormalIdx が見つからない → 何もしない。
- これは異常ケース（始点と終点が同じ辺面上にある）で、BFSがそもそも生成しにくい。

### EC3: spreadPorts の中継WPが挿入されたケース
```
wp[0]=(310, 400) → wp[1]=(300, 400) → wp[2]=(300, 420) → ...
srcSide='bottom', normalValue=400
```
- wp[1]: |400 - 400| <= 1 → スキップ
- wp[2]: |420 - 400| > 1 → firstNormalIdx=2
- wp[2].y=420 > 400 → R1を満たす（下方向）
- 直交揃え: wp[2].x = wp[1].x = 300（変更なし）
- 結果: (310,400)→(300,400)→(300,420)→... **正しい。辺面上の移動→法線方向出発。**

### EC4: deflectFromIcons が始点付近で迂回WPを挿入したケース
```
wp[0]=(300, 400) → wp[1]=(300, 420) → wp[2]=(292, 420) → wp[3]=(292, 380) → ...
srcSide='bottom', normalValue=400
```
- wp[1]: |420 - 400| > 1 → firstNormalIdx=1
- wp[1].y=420 > 400 → R1を満たす（下方向）
- 直交揃え: wp[1].x = wp[0].x = 300（変更なし）
- 結果OK

### EC5: nudgeEdges が始点セグメントをオフセットしたケース
```
元: wp[0]=(300, 400) → wp[1]=(300, 500)
nudge: wp[0].x += 10, wp[1].x += 10
結果: wp[0]=(310, 400) → wp[1]=(310, 500)
srcSide='bottom', rect.x+rect.w の右端が320とする
```
- enforceStart: wp[0]をスナップ → (310, rect.y+rect.h) → y座標修正。x は clamp で OK。
- firstNormalIdx=1, wp[1].y=500 > normalValue → R1を満たす
- 結果OK

### EC6: コンテナ→アイコンのエッジ
```
srcType='subnet', srcSide='left'（directionToTargetで決定）
wp[0] = sideCenter(subnet, 'left')
```
- enforceStart: wp[0]をsubnet矩形のleft辺にスナップ（すでにそこにあるはず）
- firstNormalIdx を探す → 法線方向（x軸）に離れる点
- R1検査 → BFSのパスが左に向かっていればOK
- 結果OK（L字再構築なし）

### EC7: BFSパスの逆方向問題
BFSが中心→中心で探索し、結果としてパスがアイコンを突き抜ける方向に出るケース。
例: srcSide='bottom' だがBFSパスが上方向に出る。
- firstNormalIdx で法線方向（y軸）に離れる最初の点を見つける
- その点が normalValue より小さい（上方向）→ R1違反
- escape挿入: escapePt = (wp[0].x, wp[0].y + 20)
- L字で元パスの適切な点に合流
- 結果: 辺面→下20px→L字→元パス合流

## 検証方法

ブラウザコンソールで全エッジを自動検証:

```javascript
document.querySelectorAll('g[data-edge-id]').forEach(g => {
  const edgeId = g.dataset.edgeId
  const srcSide = g.dataset.srcSide
  const dstSide = g.dataset.dstSide
  const path = g.querySelector('path')
  if (!path) return
  const d = path.getAttribute('d')
  // パースして最初/最後のセグメント方向を検査
  // ... (具体的な検証ロジック)
})
```

## 現コードからの変更点まとめ

1. **srcSide/dstSide を変更しない** — `sideFromNeighbor` による辺再決定を廃止
2. **コンテナ分岐を廃止** — L字パス再構築を削除、アイコンと同じロジック
3. **法線方向の「最初の離脱点」で検査** — spreadPorts の中継WP（辺面上の移動）をスキップ
4. **R1/R2違反時はescape/approach挿入** — 辺→法線20px→L字→合流
5. **パイプライン順序は変更しない** — enforceEdgeRules は最後のまま
