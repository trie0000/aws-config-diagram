# HANDOFF.md - セッション引き継ぎ

> 最終更新: 2026-02-14 セッション11 (Canvas UX改善 + edgeRouter v2.0.0)

## 現在の状態

**Canvas UX 大幅改善済み**。edgeRouter v2.0.0（障害物回避BFS）実装完了、スナップガイドライン（ドラッグ＋リサイズ）、タッチパッドズーム感度修正、矢印接続位置修正。次のステップは P1 エッジナッジ（重なった矢印の等間隔オフセット）。

## 完了済み（セッション11: Canvas UX改善）

### edgeRouter v2.0.0 — 障害物回避BFSルーティング（P0完了）

- [x] `edgeRouter.ts` v2.0.0: グリッドBFS 1回/エッジ、方向後決定（`determineSide()`）
  - BFS: center→center、Dijkstra的（折れ曲がりペナルティ付き）
  - 始点・終点ノードの障害物を一時的に解除して経路探索
  - `simplifyPath()` で折れ点のみ残す
  - `bestSides()` + `fallbackRoute()` でBFS失敗時のフォールバック
- [x] useMemo依存チェーン最適化: nodes→containers/icons→edges→routedEdges
  - `nodes` 配列を毎レンダー再生成していた問題を修正（パフォーマンス 2.6ms/scroll）
- [x] DiagramCanvasから重複関数定義を削除（nodeIconRect, sideCenter, bestSides → edgeRouterからimport）

### スナップガイドライン — PowerPoint風

- [x] アイコンドラッグ時: 隣接アイコンの中心とX/Y軸で揃うとスナップ（閾値5px）
  - `iconsRef` でuseMemoの外からアイコン一覧を参照
  - 各軸で最も近い候補1つだけにスナップ
- [x] コンテナリサイズ時: ドラッグ辺が他コンテナの辺（左/右/上/下）にスナップ
  - `containersRef` でコンテナ一覧を参照
  - e/w/n/sハンドル方向に応じて該当辺を比較
- [x] 赤い破線ガイドライン表示（`#f43f5e`, strokeWidth=0.8, dasharray=4 4）
- [x] mouseUp時にガイドラインクリア

### その他のUX修正

- [x] タッチパッドズーム感度: 固定factor(1.1/0.9) → deltaY比例(`1 + clampedDelta * 0.002`)
- [x] 矢印接続位置: `pullBackEndpoint` 削除。SVG marker `refX=8` で矢印先端がアイコン辺に密着
- [x] コンテナリサイズハンドル（8方向: nw/ne/sw/se/n/s/e/w）
- [x] ミニマップ（左上固定、表示範囲ドラッグ可能）
- [x] スクロールバー（縦横）
- [x] VPCフィルタ（チェックボックスで非表示切替）
- [x] Undo/Redo（`onCommitSnapshot` でドラッグ/リサイズ開始時にスナップショット保存）

### 変更ファイル（セッション11）

```
frontend/src/components/canvas/edgeRouter.ts     - v2.0.0 新規（BFS障害物回避ルーティング）
frontend/src/components/canvas/DiagramCanvas.tsx  - スナップガイドライン、ズーム感度、矢印修正
```

## 矢印ルーティング改善ロードマップ（LAYOUT_RESEARCH.md §5）

| 優先度 | 改善項目 | 状態 | 効果 |
|--------|---------|------|------|
| **P0** | 障害物回避（BFS） | ✅ 完了 | 矢印がアイコンを突き抜けなくなる |
| **P1** | エッジナッジ | 🔜 次 | 重なった矢印が区別できる |
| **P2** | 交差軽減 | 未着手 | フロー追跡が容易に |
| P3 | ポート最適化 | 未着手 | 曲がりが減る |

## 完了済み（セッション1-10）

<details>
<summary>展開</summary>

### セッション1-4: v4.2まで
- [x] v1〜v4.2: AWSConfigParser + レイアウトエンジン + Excel/PPTX出力
- [x] 4つのJSON（tabelog, realistic, sample, real）で動作確認

### セッション5: テスト環境 + 分析
- [x] AWS CLI テストスクリプト 13本、Config Snapshot取得（259リソース/80タイプ/378リレーション）
- [x] 競合分析 + Config JSON実データ分析

### セッション6-7: Web エディタ要件 + 技術スタック
- [x] React 19 + TypeScript + Vite + FastAPI(localhost) に確定

### セッション8-9: プロジェクトセットアップ + バックエンド
- [x] Vite + shadcn/ui セットアップ、FastAPI パイプライン実装

### セッション10: モックアップ v3 ライトテーマ UI
- [x] DiagramCanvas v2.0、App.tsx（P01/P02準拠）、useDiagram.ts
- [x] SG経由エッジ生成（0→14本）、メタデータ強化
</details>

## 次のアクション

1. **P1 エッジナッジ** — 同じ線分上の複数矢印を等間隔オフセット
2. **P2 交差軽減** — ルーティング後の交差をswapで削減
3. **ノード追加UI（P06）** — 外部システム/コメントノードの手動追加
4. **レイヤー管理（P08）** — Infrastructure/Security/External等の表示切替
5. **エクスポートダイアログ（P05）** — DiagramState込みの詳細エクスポート

## 技術メモ

- **edgeRouter パイプライン**: グリッドセル20px、障害物マージン1セル、BFS最大20000セル、折れ曲がりペナルティ2
- **SVG arrowhead**: `<marker refX=8>` で矢印先端がpath終点に密着。pullBackEndpoint不要
- **スナップ閾値**: `SNAP_THRESHOLD = 5`（SVG座標px）
- **useMemoチェーン**: nodes → containers/icons → sortedContainers → edges → routedEdges
- Vite: port 5173、FastAPI: port 8000
- テストデータ: `frontend/public/test_data.json`
