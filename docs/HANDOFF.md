# HANDOFF.md - セッション引き継ぎ

> 最終更新: 2026-02-13 セッション9 (バックエンドパイプライン完成)

## 現在の状態

**バックエンド API パイプライン完成**。Config JSON → DiagramState → レイアウト計算 → API レスポンスの一連が動作確認済み。Excel/PPTX エクスポートも API 経由で動作。フロントエンド API クライアントも作成済み。次は React SVG Canvas コンポーネントでの構成図描画。

## 完了済み（セッション1-4: v4.2まで）

- [x] v1: AWSConfigParser + 矩形ベース3スライド図生成
- [x] v2: AWS公式アイコンベース1スライド図生成
- [x] v4.0 Gateway Columnレイアウト
- [x] v4.1 サービス配置最適化（WAF/NAT/Peering境界配置）
- [x] v4.2 境界配置 + ハードコード矢印整理（JSON根拠のない矢印を全削除）
- [x] Excel (.xlsx) / PPTX 出力
- [x] 4つのJSON（tabelog, realistic, sample, real）で動作確認

## 完了済み（セッション5: テスト環境 + 分析）

- [x] AWS CLI テストスクリプト 13本作成 (`test/00a〜99`)
- [x] アカウントアップグレード（Free plan → 有料）
- [x] 全リソース構築（Phase 0a〜08: 46種類のサービス）
- [x] Config Snapshot 取得: **259リソース / 80タイプ / 378リレーション**
- [x] クリーンアップ完了（全リソース削除済み）
- [x] スクリプトバグ修正（CloudFront --tags, EB Name tag, Redshift node type, TGW wait）
- [x] 別AIの分析レポートの妥当性検証（3つの不正確さを特定）
- [x] `docs/COMPETITIVE_ANALYSIS.md` — 競合分析 & 差別化戦略
- [x] `docs/design/CONFIG_JSON_ANALYSIS.md` — Config JSON 実データ分析 & 実装ガイド

## テストデータ

| ファイル | 内容 |
|---------|------|
| `test/snapshots/snapshot.json` | 最終スナップショット (259リソース, 80タイプ) |
| `test/snapshots/cloudfront_raw.json` | CloudFront describe-distributions の生データ |

### カバレッジ: 45/46 (97%)

未取得: CloudFront（Config検出遅延）、ElastiCache（Config非サポート）

## 実データ分析の重要知見

詳細は `docs/design/CONFIG_JSON_ANALYSIS.md`。

### パーサー改修が必要な6項目

1. **relationships に resourceId がない場合がある** — resourceName のみ (8件/378件)
2. **VPC→Subnet は逆引きが必要** — Subnet側の "Is contained in Vpc" を走査
3. **SG ipRanges は文字列リスト** — `['0.0.0.0/0']` 形式（通常APIと異なる）
4. **ECS Service のネットワーク情報が空** — NetworkConfiguration={}, relationships=0
5. **EKS, TGW Attachment, Listener, TG は relationships=0** — configuration からのみ復元
6. **WAF→ALB は relationships で取得可能**（分析レポートの「不明」は誤り）

## v4.2 サービス配置マップ（前セッションから継続）

| 配置場所 | サービス |
|---------|---------|
| Gateway Column | WAF, ALB |
| VPC左端境界 | IGW (小アイコン 0.30in) |
| Public Subnet上端境界 | NAT Gateway (小アイコン) |
| Public Subnet内 | EC2 |
| Private Subnet内 | EC2, Lambda(VPC), ECS, EKS |
| Private Subnet右上 | ElasticBeanstalk (バッジ) |
| Isolated Subnet内 | RDS, ElastiCache, Redshift |
| VPC右端境界 | VPC Peering |
| VPC外左側 | Route53, CloudFront, API GW |
| Cloud内下部 | KMS, CloudTrail, CloudWatch, Lambda, DynamoDB, SQS, SNS, S3 |

## 完了済み（セッション6: Web エディタ要件定義）

- [x] Web エディタ機能要件ドキュメント受領・整形
- [x] `docs/design/WEB_EDITOR_SPEC.md` — Web エディタ機能要件仕様書（新規作成）
- [x] `docs/PRODUCT_VISION.md` — Phase 1.5（Web エディタ）追加、アーキテクチャ拡張
- [x] `docs/ROADMAP.md` — Phase 1.5 挿入、優先順位変更
- [x] AWSテスト環境の完全クリーンアップ確認（S3 EB バケット含む全リソース削除）

## 変更ファイル（セッション6）

```
docs/design/WEB_EDITOR_SPEC.md   - Web エディタ機能要件仕様書（新規）
docs/PRODUCT_VISION.md           - Phase 1.5 追加、モジュール構成・技術スタック更新
docs/ROADMAP.md                  - Phase 1.5 挿入、優先順位変更
docs/HANDOFF.md                  - 更新
```

## 変更ファイル（セッション5）

```
test/00a_setup_budget.sh〜test/99_cleanup.sh  - テストスクリプト13本
test/env.sh, test/resource_ids.sh             - 共通設定・リソースID
test/snapshots/snapshot.json                  - Config Snapshot
test/snapshots/cloudfront_raw.json            - CloudFront生データ
docs/COMPETITIVE_ANALYSIS.md                  - 競合分析（新規）
docs/design/CONFIG_JSON_ANALYSIS.md           - Config JSON分析（新規）
```

## 完了済み（セッション7: 技術スタック確定 + 全ドキュメント更新）

### 技術選定の経緯

1. 初期案: Vanilla JS + FastAPI → 見た目に考慮するならReactが良い
2. フルTS案: React + TypeScript (バックエンドなし) → Excel/PPTX出力が課題
3. **確定案: React + TypeScript (Vite) + ローカル FastAPI**
   - 外部サーバー通信なし（localhost完結）がプロダクトの肝
   - Jupyter Notebook / VS Code と同じパターン（ブラウザUI + ローカルサーバー）
   - Excel/PPTX出力は既存Python 4,000行をそのまま流用
   - パーサーも既存Python 2,400行をそのまま流用

### ライセンス確認済み

全ライブラリ MIT or BSD。商用利用に制約なし。
React, TypeScript, Vite, shadcn/ui, FastAPI, uvicorn, Pydantic, openpyxl, python-pptx, lxml

### 更新ファイル

- [x] `docs/design/CODING_STANDARDS.md` — React+TS+FastAPI構成に全面書き直し
  - TypeScript/React コーディング規約（コンポーネント設計、hooks、SVG描画）
  - フロントエンドディレクトリ構成（components/, hooks/, types/, services/）
  - アーキテクチャ原則（localhost通信ルール、責務分離）
  - ライセンス一覧
  - 起動方法（開発時: ターミナル2つ、将来: ワンコマンド）
- [x] `CLAUDE.md` — React+TS+FastAPI構成に全面書き直し
  - ファイル構成（frontend/ 追加、web/ をバックエンドに特化）
  - 実行環境（Node.js, Vite, React, Tailwind 追加）
  - アーキテクチャ図（localhost通信図）
  - 設計原則に「localhost完結」を追加
- [x] `docs/PRODUCT_VISION.md` — 技術スタック表・モジュール構成を更新
  - React + TypeScript + Vite に変更
  - 競合比較に「データ保護: ローカル完結」行を追加
- [x] `docs/ROADMAP.md` — Phase 1.5 セクションを更新
  - 技術スタック表を追加
  - アーキテクチャ図を React + FastAPI 構成に更新
  - DiagramState 型定義を TypeScript に変更
  - タスクに「Vite プロジェクトセットアップ」を追加

## 変更ファイル（セッション7）

```
docs/design/CODING_STANDARDS.md  - React+TS+FastAPI構成に全面書き直し
CLAUDE.md                        - React+TS+FastAPI構成に全面書き直し
docs/PRODUCT_VISION.md           - 技術スタック・モジュール構成更新
docs/ROADMAP.md                  - Phase 1.5 技術スタック・アーキテクチャ更新
docs/HANDOFF.md                  - 更新
```

## 完了済み（セッション8: プロジェクトセットアップ + push）

- [x] `frontend/`: Vite + React 19 + TypeScript 5.x プロジェクト作成
- [x] Tailwind CSS v4 + shadcn/ui セットアップ
- [x] `frontend/vite.config.ts`: @/ エイリアス、localhost:8000 プロキシ設定
- [x] `frontend/src/types/diagram.ts`: DiagramState 型定義（ノード/エッジ/メタ）
- [x] `frontend/src/App.tsx`: 初期シェル（ツールバー + Canvas プレースホルダー）
- [x] ディレクトリ構成: components/{canvas,panels,toolbar}/, hooks/, types/, services/
- [x] `web/app.py`: FastAPI スケルトン（localhost専用、CORS設定、/api/health）
- [x] `web/routes/`: ルート分割用ディレクトリ
- [x] venv 再作成（インタプリタパス修正）+ FastAPI/uvicorn/pydantic インストール
- [x] `requirements.txt` 更新（fastapi, uvicorn, pydantic 追加）
- [x] `.gitignore` 更新（frontend/node_modules/, frontend/dist/, .env, uploads/ 追加）
- [x] git commit & push 完了（2コミット: docs + project setup）

### 変更ファイル

```
.gitignore                           - frontend/node_modules等を追加
requirements.txt                     - fastapi, uvicorn, pydantic 追加
frontend/                            - Vite+React+TS プロジェクト（新規）
frontend/src/types/diagram.ts        - DiagramState 型定義（新規）
frontend/src/App.tsx                 - 初期シェル
web/__init__.py                      - バックエンドパッケージ（新規）
web/app.py                           - FastAPI スケルトン（新規）
web/routes/__init__.py               - ルートパッケージ（新規）
```

## 完了済み（セッション9: バックエンドパイプライン実装）

- [x] `diagram_state.py`: Pydantic v2 モデル + DiagramStateConverter
  - DiagramNode, DiagramEdge, DiagramMeta, DiagramState
  - AWSConfigParser → DiagramState 変換（30+リソースタイプ対応）
  - camelCase JSON 出力（TypeScript 互換）
  - テスト: 66ノード、24タイプ（実データ 259リソースから生成）
- [x] `layout_engine.py`: ピクセル座標レイアウトエンジン
  - VPC > AZ > Subnet > Resource の4階層ネスト配置
  - Subnet tier 別列配置（Public/Private/Isolated）
  - VPC外サービス配置（edge/data/support 3カテゴリ）
  - コンテンツ駆動サイズ計算
  - テスト: 全66ノードの座標・サイズ計算成功
- [x] `web/app.py`: FastAPI エンドポイント実装
  - POST /api/parse: Config JSON → DiagramState（レイアウト計算済み）
  - POST /api/export/xlsx: Excel ダウンロード
  - POST /api/export/pptx: PowerPoint ダウンロード
  - 全3エンドポイント curl テスト通過
- [x] `frontend/src/services/api.ts`: TypeScript API クライアント
  - parseConfigFile(), exportDiagram(), healthCheck()
  - Blob ダウンロード対応、Content-Disposition ファイル名解析
- [x] UI 画面設計ドキュメント
  - `docs/design/UI_SCREEN_DESIGN.md`: 26機能、13画面、ワイヤーフレーム
  - `docs/design/CHATGPT_UI_PROMPTS.md`: ChatGPT UI モックアップ生成プロンプト11本

### 変更ファイル

```
diagram_state.py                        - DiagramState Pydantic モデル + 変換器（新規）
layout_engine.py                        - ピクセル座標レイアウトエンジン（新規）
web/app.py                              - FastAPI エンドポイント実装（大幅更新）
frontend/src/services/api.ts            - TypeScript API クライアント（新規）
docs/design/UI_SCREEN_DESIGN.md         - UI 画面設計（新規）
docs/design/CHATGPT_UI_PROMPTS.md       - ChatGPT プロンプト集（新規）
docs/HANDOFF.md                         - 更新
```

## 次のアクション

1. **React SVG Canvas コンポーネント** — DiagramState を SVG で描画
   - VPC/AZ/Subnet の階層矩形
   - リソースアイコン（AWS 公式 SVG）
   - ズーム・パン・選択
2. **ドラッグ&ドロップ** — リソース移動、位置保存
3. **リソース詳細パネル** — クリックで AWS Config メタデータ表示
4. **Edges 実装** — get_service_connections() が 0 件を返す問題の調査
5. **既存パーサー改修** — CONFIG_JSON_ANALYSIS.md の知見を反映
6. **Phase 2 開発** — VPCE データフロー矢印、SG 要約マトリクス
7. **Phase 3 開発** — 差分比較（差別化の核）

## 未解決の問題

- CloudFrontがConfigスナップショットに含まれない（30分以上待っても検出されず）
- ECS ServiceのNetworkConfigurationが空（VPC内配置が推論不能）
