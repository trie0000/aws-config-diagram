# HANDOFF.md - セッション引き継ぎ

> 最終更新: 2026-02-15 セッション25 (edgeRouter v15.1.0 全面書き直し完了 + ブラウザ検証済み)

## 現在の状態

**edgeRouter v15.1.0 グリーディ直交ルーティング — アイコン貫通ゼロ確認済み**。
v12.0のBFS+後処理パイプラインを完全廃止し、距離順グリーディ方式に全面書き直し。

### ブラウザ検証結果

| データセット | エッジ数 | hits(貫通) | 最大bends | 最大cross |
|---|---|---|---|---|
| realistic_aws_config | 9 | **全0** | 3 | 4 |
| tabelog_aws_config | 9 | **全0** | 3 | 4 |

全エッジでアイコン貫通ゼロを確認。crossが4のエッジ(dge-0001)は長距離の right→bottom パスで、既存の短距離パスと複数交差するが、16通りの辺パターン中で最良。

### v12.0→v15.1.0 主要変更点

| 項目 | v12.0 | v15.1.0 |
|------|-------|---------|
| アルゴリズム | BFS候補生成+評価 | **距離順グリーディ(16辺パターン×5候補)** |
| 辺決定 | bestSides()事前決定 | **全16通り(4×4)を全探索** |
| ポート配置 | spreadPorts後処理 | **PortTracker(中央→外側に順次分散)** |
| アイコン回避 | deflectFromIcons後処理 | **候補選択時にhitsで判定** |
| 重なり判定 | UsedSegments | **不要（ポートずらしで解消）** |
| 後処理 | spreadPorts + deflectFromIcons | **なし（全てルーティングループ内）** |
| 候補パス | Z字7比率×5ナッジ=35候補 | **直線+L字2+Z字2=最大5候補** |
| 選択基準 | Rule6>Rule10>Rule7 | **hits→bends→cross→len** |

## 完了済み（セッション25: v15.1.0 全面書き直し）

### 要件

ユーザーから段階的に以下の指示:
1. 「距離が短い接続線から順番に処理」「その時にどの辺から出すのが最適か計算できるやろ」
2. 「事前にカウントせんでいい。ポートは分散しろ。中央から埋まっていく」
3. 「再帰の処理は入れるな。PCが壊れる」
4. 「アイコン貫通なし→曲がり少→交差少→距離短」（厳密優先順位）
5. 「top→top、bottom→bottomが一番折り曲がりが少ないケースがあるやろ」→ 全16通り
6. 「重なりは見なくていい」→ UsedSegments不使用

### 変更内容

- [x] `edgeRouter.ts`: v15.1.0 全面書き直し
  - 距離順ソート→全16辺パターン試行→PortTracker
  - spreadPorts/deflectFromIconsのimport完全削除
  - PORT_GAP=12
- [x] `edgeRouter.bfs.ts`: v15.0.0 全面書き直し
  - routeBetween/findBlockingObstacle/pathClearAll 削除
  - generateCandidatePaths(): 直線/L字2/Z字2 → PathCandidate[]
  - countBends/countCrossings/pathLength エクスポート
- [x] `edgeRouter.postprocess.ts`: **未import**（ファイルは残存）
- [x] ブラウザ検証: realistic + tabelog 両方 hits=0 確認
- [x] console.log デバッグ出力を削除済み

### 変更ファイル

```
frontend/src/components/canvas/edgeRouter.ts              - v15.1.0 グリーディルーティング
frontend/src/components/canvas/edgeRouter.bfs.ts           - v15.0.0 候補パス生成
frontend/src/components/canvas/edgeRouter.postprocess.ts   - 未import（残存）
frontend/vite.config.ts                                    - （前セッションから変更あり）
layout_engine.py                                           - NATGW境界配置（前セッション復元）
diagram_state.py                                           - NATGW親ノード割り当て（前セッション復元）
docs/HANDOFF.md                                            - セッション25更新
```

## edgeRouter パイプライン（v15.1.0）

```
Phase 0: 準備
  collectIconRects → iconMap
  edges を距離順ソート（短い順）
  obstacles = 全アイコンのRect配列

Phase 1: 各エッジ処理（距離順ループ）
  for edge of sortedEdges:
    for (srcSide, dstSide) of 16通り:
      srcOffset = portTracker.peekOffset(srcId, srcSide)  ← countを増やさない
      dstOffset = portTracker.peekOffset(dstId, dstSide)
      srcPt = sidePoint(srcIcon, srcSide, srcOffset)
      dstPt = sidePoint(dstIcon, dstSide, dstOffset)
      candidates = generateCandidatePaths(srcPt, srcSide, dstPt, dstSide, obstacles)
        → 直線(条件付き) + L字×2 + Z字×2 = 最大5候補
        → 各候補に hits (障害物貫通数, stem除外) 付き
      for each candidate:
        score = (hits, bends, cross, len)  ← 辞書順比較
        if better → update best
    portTracker.commitOffset(srcId, bestSrcSide)  ← ここでcount+1
    portTracker.commitOffset(dstId, bestDstSide)
    existingPaths.push(bestPath)  ← 後続の交差判定用
```

## 接続線ルール（v15.1.0 準拠）

1. 距離が短い矢印から先にルーティング
2. アイコンの辺から法線方向にSTEM_LEN(20px)まっすぐ出す
3. アイコン貫通なし（**最優先**）
4. 折り曲がり数が最小
5. 他の線との交差が最小
6. 距離が最短

**選択基準**: hits(貫通) → bends(曲がり) → cross(交差) → len(距離) の辞書順

## ファイル構成（エッジルーティング関連）

| ファイル | 責務 | 状態 |
|---------|------|------|
| `edgeRouter.ts` | オーケストレータ: 距離順ループ+16辺パターン+PortTracker | v15.1.0 |
| `edgeRouter.bfs.ts` | 候補パス生成: generateCandidatePaths + スコアリングユーティリティ | v15.0.0 |
| `edgeRouter.types.ts` | 型定義(Side, Point, RoutedEdge), nodeIconRect, bestSides等 | v12.0.0（変更なし） |
| `edgeRouter.postprocess.ts` | spreadPorts/deflectFromIcons | **未import（残存）** |
| `EdgeLine.tsx` | 描画コンポーネント（waypoints→SVG path） | 変更なし |

## NATGW境界配置（前セッションから復元）

layout_engine.py と diagram_state.py に前セッション(commit ff70e76)の変更を復元済み:
- NATGW は public subnet の右境界上に配置
- NATGW は subnet の子ノードとして登録（VPC直下ではない）
- **注意**: バックエンドがメインリポジトリから起動されている場合、この変更は反映されない

## 次のアクション

1. **edgeRouter.postprocess.ts の削除検討** — 未importだが残存。削除するか判断
2. **NATGW位置の確認** — バックエンドをworktreeから起動して位置を検証
3. **コミット** — v15.1.0 の変更をコミット
4. **ノード追加UI（P06）** — 外部システム/コメントノードの手動追加
5. **レイヤー管理（P08）** — Infrastructure/Security/External等の表示切替

## 技術メモ

- **PortTracker**: peekOffset(カウント不変)とcommitOffset(カウント+1)の分離。中央→±gap→±2gap...の順で振り分け。
- **PORT_GAP=12**: 6から増加。アイコン辺(48px)に対して最大4本程度。
- **16辺パターン×5候補=80評価/エッジ**: 定数時間、再帰なし、CPU安全。
- **UsedSegments**: edgeRouter.bfs.ts にクラスは残存（export）しているが、edgeRouter.ts からは使用していない。
- **Vite HMR制限**: edgeRouter.ts の変更は HMR で反映されない。`rm -rf node_modules/.vite` + Vite再起動が必要。
- **Vite worktree注意**: worktreeで作業時は worktreeの `frontend/` からViteを起動すること。
- Vite: port 5173 (strictPort)、FastAPI: port 8000

## 完了済み（セッション1-24）

<details>
<summary>展開</summary>

### セッション24: edgeRouter v12.0 全面書き直し
- [x] edgeRouter v12.0: ピクセル座標ベース直交ルーティング
- [x] pathClearのstem除外、spreadPortsのstem連動、deflectFromIconsのstemスキップ
- [x] ブラウザ検証OK

### セッション23: edgeRouter v11.0 + ルール検証
- [x] edgeRouter v11.0: 候補パス型ルーティング
- [x] ルール準拠検証 → Rule 2/3/4 違反発見

### セッション22: edgeRouter v9.0 仕様準拠
- [x] edgeRouter.force.ts: 中間点配置→シミュレーション→抽出
- [x] 後処理完全削除

### セッション21: シミュレーションアニメーション
- [x] simulateStep/simulateFinalize API追加

### セッション20: edgeRouter v8.0 Force-Directed
- [x] edgeRouter.force.ts 新規作成

### セッション19: edgeRouter v7.0 Side-First
- [x] determineSidesForEdge() + sideToDir()

### セッション18: enforceEdgeRules v6.5.0
- [x] enforceEdgeRules 全面再設計

### セッション1-17
- [x] AWSConfigParser + レイアウト + Excel/PPTX
- [x] React 19 + TypeScript + Vite + FastAPI
- [x] DiagramCanvas + edgeRouter BFS
- [x] spreadPorts v2 + deflectFromIcons
</details>
