# edgeRouter v10: 決定的直交ルーティング

## 方針転換
力学シミュレーション（v9）を廃止。決定的アルゴリズムに切り替え。

## ユーザー要件（優先順位順）

1. **距離順に処理**: アイコン間距離が短い矢印から先にルーティング
2. **法線出発**: アイコンの辺から法線方向に出す。角には繋げない
3. **障害物回避**: 自アイコン・相手アイコン・途中のアイコンの中を通らない
4. **最小折り曲がり**: 折り曲がり数が最小の経路を選ぶ
5. **最短距離**: 同じ折り曲がり数なら最短距離
6. **重複禁止**: 異なる矢印は交差OK、重なりNG
7. **等間隔ポート**: 同じ辺に繋がる矢印は等間隔に配置
8. **最少交差**: 複数経路候補がある場合、他の経路との交差が最少のものを選ぶ
9. **ポート順入替OK**: 交差が減るなら同じ辺の接続線の順番を入れ替えてよい

## アルゴリズム設計

### Phase 0: 準備
- アイコン矩形を収集（`collectIconRects`既存）
- 障害物グリッドを構築（`buildObstacleGrid`既存を活用）
- エッジをアイコン間距離でソート（短い順）

### Phase 1: 辺決定（Side Assignment）
各エッジに対して src/dst のどの辺から出るかを決定。
- `bestSides()` 既存関数を使用（水平/垂直ギャップ比較）
- この段階ではまだポート位置は未定（辺の中央を仮定）

### Phase 2: 最短直交パス探索（BFS）
距離が短いエッジから順にBFSでパスを探索:
- **コスト関数**: `距離 + 折り曲がり数 × BEND_PENALTY`
  - 折り曲がりペナルティ大（最優先で最小化）
  - 距離は自然にBFSのステップ数
- **障害物**: 全アイコン矩形（src/dstの出発グリッドセルは除外）
- **重複セグメント検出**: 既にルーティング済みの経路が通るセグメント（方向付き）を記録。同一方向の同一セグメントは通行禁止（交差はOK、重複はNG）
- 既存の `runBFS` を改修して使う

### Phase 3: ポート均等配置（Spread Ports）
同じアイコンの同じ辺に接続するエッジ群を等間隔に配置:
- 辺ごとにグルーピング
- 辺の長さを接続数+1で割って等間隔にポート位置を計算
- waypointsの始点/終点をポート位置にシフト

### Phase 4: ポート順最適化（交差削減）
同じ辺のポート順を入れ替えて交差を最小化:
- 各辺について、そこに繋がる接続線の相手先の位置を比較
- 相手が左にあるものほど辺の左側に、上にあるものほど上側に配置
  （自然順 = 交差最小）
- 単純なソートで実現可能（隣接エッジの出口方向でソート）

## ファイル構成

```
edgeRouter.ts              — オーケストレータ（routeAllEdges書き換え）
edgeRouter.types.ts        — 型定義（変更なし）
edgeRouter.bfs.ts          — グリッド+BFS（重複セグメント禁止を追加）
edgeRouter.force.ts        — 削除（力学シミュレーション廃止）
edgeRouter.postprocess.ts  — spreadPorts + ポート順最適化
```

## routeAllEdges 新パイプライン

```typescript
export function routeAllEdges(nodes, edges): RoutedEdge[] {
  // 0. 準備
  const icons = collectIconRects(nodes)
  const grid = buildObstacleGrid(icons, nodes)
  const sortedEdges = sortByIconDistance(edges, nodes)  // 短い順

  // 1. 辺決定
  // bestSides() で各エッジの srcSide/dstSide を決定

  // 2. BFS パス探索（距離順に、重複セグメント禁止）
  const usedSegments = new Set<string>()  // "x1,y1,x2,y2" 方向付き
  for (const edge of sortedEdges) {
    const path = runBFS(grid, srcPt, dstPt, srcDir, dstDir, usedSegments)
    recordSegments(path, usedSegments)
  }

  // 3. ポート均等配置
  spreadPorts(routed, icons)

  // 4. ポート順最適化
  optimizePortOrder(routed, icons)

  return routed
}
```

## 変更範囲

| ファイル | 変更内容 |
|---------|---------|
| `edgeRouter.ts` | routeAllEdges を新パイプラインに書き換え |
| `edgeRouter.bfs.ts` | usedSegments による重複禁止を追加 |
| `edgeRouter.postprocess.ts` | spreadPorts + optimizePortOrder を実装 |
| `edgeRouter.force.ts` | **削除** |
| `DiagramCanvas.tsx` | Sim ビューア関連コード削除、force.ts の import 削除 |
| `edgeRouter.types.ts` | 変更なし |

## Sim ビューアについて
力学シミュレーションを廃止するため、Simビューアも削除する。
決定的アルゴリズムにはステップの概念がないため不要。
