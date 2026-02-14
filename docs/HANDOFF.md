# HANDOFF.md - セッション引き継ぎ

> 最終更新: 2026-02-14 セッション18 (enforceEdgeRules v6.5.0 — アルゴリズム全面再設計)

## 現在の状態

**edgeRouter v6.5.0 完了**。enforceEdgeRules を設計書ベースで全面再実装:
1. R0（直交保証）、R1（出口方向）、R2（到着方向）、R3（矢印マーカー方向）の4ルールを最終適用
2. srcSide/dstSide を変更しない設計（辺を固定してパスを修正）
3. コンテナ専用分岐を廃止（アイコンと同じロジック）
4. テスト結果: tabelog(11エッジ) 11/11、snapshot(16エッジ) 16/16 全パス

## 完了済み（セッション18: enforceEdgeRules v6.5.0）

### enforceEdgeRules 全面再設計

- [x] アルゴリズム設計書作成 (`docs/design/ENFORCE_EDGE_RULES_ALGORITHM.md`)
  - R0〜R3の定義、firstNormalIdx/lastNormalIdxの探索、6a/6b分岐、ensureFinalSegment
- [x] ユーザーによる厳密レビュー（斜め線、矢印方向、重なり、ポート分散、曲がり最小化等）
- [x] enforceEdgeRules 実装
  - `sideFromNeighbor` による辺再決定を廃止
  - コンテナ専用L字再構築を廃止
  - firstNormalIdx でspreadPorts中継WPをスキップ
  - R1/R2違反時はescape/approach挿入（法線方向20px離脱→L字合流）
  - ensureFinalSegment でR3保証（辺面平行の中継WPを除去→L字再構築）
  - enforceEnd 6b の合流元探索を k>=1 に制限（enforceStart保護）
- [x] ブラウザ検証: tabelog 11/11、snapshot 16/16 全パス
- [x] EDGE_ROUTING.md 更新（パイプライン順序、enforceEdgeRulesセクション）
- [x] ENFORCE_EDGE_RULES_ALGORITHM.md に 6b の k>=1 制約を追記

### 変更ファイル（セッション18）

```
frontend/src/components/canvas/edgeRouter.ts              - enforceEdgeRules 全面再実装 (v6.5.0)
docs/design/ENFORCE_EDGE_RULES_ALGORITHM.md               - 新規: アルゴリズム設計書
docs/design/EDGE_ROUTING.md                               - パイプライン順序更新 + enforceEdgeRulesセクション
docs/HANDOFF.md                                           - セッション18更新
```

## 完了済み（セッション17: deflectFromIcons）

- [x] spreadPorts の中継WP挿入方式
- [x] deflectFromIcons 新規実装
- [x] segmentIntersectsRect buffer追加

## edgeRouter パイプライン（v6.5.0）

```
1. BFS ルーティング (edgeRouter.bfs.ts)
   - 障害物グリッド構築 → 各エッジで BFS → determineSide → simplifyPath
2. 交差削減 (edgeRouter.postprocess.ts)
   - reduceCrossings — 交差ペナルティ付き BFS で再ルーティング
3. エッジナッジ (edgeRouter.postprocess.ts)
   - nudgeEdges — 重なったセグメントを等間隔にオフセット
4. ポート分散 (edgeRouter.postprocess.ts)
   - spreadPorts — nodeId:side でグルーピング、辺中央60%に均等配置
5. アイコン貫通防止 (edgeRouter.postprocess.ts)
   - deflectFromIcons — 第三者アイコンを貫通するセグメントを迂回
6. enforceEdgeRules (edgeRouter.ts) — 最終防衛線
   - R0直交 + R1出口方向 + R2到着方向 + R3矢印マーカー方向
   - 設計書: docs/design/ENFORCE_EDGE_RULES_ALGORITHM.md
7. 描画 (EdgeLine.tsx)
   - routedEdge.waypoints をそのまま SVG path に変換（ルール適用なし）
```

## ファイル構成（エッジルーティング関連）

| ファイル | 責務 |
|---------|------|
| `edgeRouter.types.ts` | 型定義、定数、共有ユーティリティ |
| `edgeRouter.bfs.ts` | グリッド構築、BFS 探索、determineSide、simplifyPath |
| `edgeRouter.postprocess.ts` | reduceCrossings, spreadPorts, nudgeEdges, deflectFromIcons |
| `edgeRouter.ts` | オーケストレータ（routeAllEdges）、enforceEdgeRules |
| `EdgeLine.tsx` | 描画コンポーネント（描画のみ） |

## 次のアクション

1. **ノード追加UI（P06）** — 外部システム/コメントノードの手動追加
2. **レイヤー管理（P08）** — Infrastructure/Security/External等の表示切替
3. **エクスポートダイアログ（P05）** — DiagramState込みの詳細エクスポート

## 技術メモ

- **enforceEdgeRules v6.5.0**: srcSide/dstSideを変更しない。firstNormalIdx/lastNormalIdxで辺面上のspreadPorts中継WPをスキップ。R1/R2違反時はescape/approach（20px離脱→L字合流）。ensureFinalSegmentでR3保証。enforceEnd 6bはk>=1でenforceStart保護
- **deflectFromIcons**: spreadPorts後に実行。全セグメント×全アイコンで交差チェック。DETECT=2px（境界ぎりぎりも検出）、MARGIN=8px（迂回距離）。src/dstノードは除外
- **spreadPorts v2.1**: nodeId:side グルーピング + 絶対座標配置。PORT_RANGE_RATIO=0.6 で辺中央60%を使用。nodeIdに`:` を含むARN対応のため `lastIndexOf(':')` で分割。**1本でもスキップせず中央配置**。src/dstを区別せず同一グループ。**端点のみ移動、中継WP挿入で直交性維持**
- **edgeRouter パイプライン**: グリッドセル20px、障害物マージン1セル、BFS最大20000セル
- **SVG arrowhead**: `<marker refX=8>` で矢印先端がpath終点に密着
- **Vite HMR制限**: edgeRouter.ts の変更は HMR で反映されない。`rm -rf node_modules/.vite` + Vite再起動が必要
- **Vite worktree注意**: worktreeで作業時は `cd worktree/frontend && npm run dev` でViteを起動すること。main repo の frontend から起動すると worktree のコード変更が反映されない
- Vite: port 5173、FastAPI: port 8000

## 完了済み（セッション1-17）

<details>
<summary>展開</summary>

### セッション1-4: v4.2まで
- [x] v1〜v4.2: AWSConfigParser + レイアウトエンジン + Excel/PPTX出力

### セッション5: テスト環境 + 分析
- [x] AWS CLI テストスクリプト、Config Snapshot取得

### セッション6-9: Web エディタ
- [x] React 19 + TypeScript + Vite + FastAPI(localhost) セットアップ

### セッション10: モックアップ v3
- [x] DiagramCanvas v2.0、SG経由エッジ生成

### セッション11: Canvas UX改善
- [x] edgeRouter v2.0.0（BFS障害物回避）、スナップガイドライン、ズーム感度修正

### セッション12-13: エッジルーティング改善
- [x] edgeRouter v4.1.0 → v6.1.0: 交差削減、ポート分散、エッジナッジ
- [x] モジュール分割（types/bfs/postprocess/orchestrator）
- [x] enforceEdgeRules（重複WP除去 + 始点/終点修正）
- [x] EdgeLine.tsx 簡素化（描画のみ）
- [x] NAT GW 境界配置、強調矢印拡大

### セッション14: enforceEdgeRules 逆方向検出
- [x] edgeRouter v6.2.0: enforceStart/enforceEnd に逆方向検出追加
- [x] PORT_SPREAD 12→8 + PORT_MAX_RATIO clamp

### セッション15-16: spreadPorts v2
- [x] spreadPorts v2: nodeId:side グルーピング + 絶対座標配置
- [x] spreadPorts v2.1: 1本中央配置 + src/dst統合

### セッション17: deflectFromIcons
- [x] deflectFromIcons 新規実装（アイコン貫通防止）
- [x] spreadPorts 中継WP挿入方式
- [x] segmentIntersectsRect buffer追加
</details>
