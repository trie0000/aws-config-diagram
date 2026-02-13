#!/bin/bash
# env.sh - 共通変数・ヘルパー関数
# 全スクリプトの先頭で source する

set -euo pipefail

export AWS_REGION="ap-northeast-1"
export AWS_DEFAULT_REGION="ap-northeast-1"
export PREFIX="diagtest"
export VPC_CIDR="10.0.0.0/16"

# アカウントID取得
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "UNKNOWN")
if [ "$ACCOUNT_ID" = "UNKNOWN" ]; then
    echo "ERROR: AWS CLI認証が設定されていません。aws configure を実行してください。"
    exit 1
fi

echo "=== AWS Account: $ACCOUNT_ID, Region: $AWS_REGION ==="

# リソースIDファイル
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export RESOURCE_IDS_FILE="${SCRIPT_DIR}/resource_ids.sh"

# リソースIDファイル初期化（存在しなければ作成）
if [ ! -f "$RESOURCE_IDS_FILE" ]; then
    echo "#!/bin/bash" > "$RESOURCE_IDS_FILE"
    echo "# Auto-generated resource IDs - $(date)" >> "$RESOURCE_IDS_FILE"
fi

# 既存のリソースIDを読み込み
source "$RESOURCE_IDS_FILE"

# リソースID保存関数
save_id() {
    local key=$1
    local val=$2
    echo "export ${key}=\"${val}\"" >> "$RESOURCE_IDS_FILE"
    export "${key}=${val}"
    echo "  Saved: ${key}=${val}"
}

# タグ付きで待機メッセージ表示
wait_msg() {
    echo "  Waiting: $1 ..."
}

# コスト上限（USD）
export COST_LIMIT=100

# コストチェック関数 - $100を超えていたらスクリプトを停止
check_cost() {
    local current_cost
    current_cost=$(aws ce get-cost-and-usage \
        --time-period "Start=$(date +%Y-%m-01),End=$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d '+1 day' +%Y-%m-%d)" \
        --granularity MONTHLY \
        --metrics "UnblendedCost" \
        --query 'ResultsByTime[0].Total.UnblendedCost.Amount' \
        --output text 2>/dev/null || echo "0")

    # 小数点以下を整数に変換して比較
    local cost_int
    cost_int=$(echo "$current_cost" | awk '{printf "%d", $1}')

    echo "  Cost check: \$${current_cost} / \$${COST_LIMIT} limit"

    if [ "$cost_int" -ge "$COST_LIMIT" ]; then
        echo ""
        echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
        echo "  COST LIMIT EXCEEDED: \$${current_cost} >= \$${COST_LIMIT}"
        echo "  環境構築を自動停止します。"
        echo "  99_cleanup.sh を実行してリソースを削除してください。"
        echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
        exit 1
    fi
}

# 各スクリプトの先頭で自動的にコストチェック（00a_setup_budget.sh 自身は除く）
CALLING_SCRIPT="$(basename "${BASH_SOURCE[1]:-none}" 2>/dev/null || echo "none")"
if [[ "$CALLING_SCRIPT" != "00a_setup_budget.sh" ]] && [[ "$CALLING_SCRIPT" != "99_cleanup.sh" ]] && [[ "$CALLING_SCRIPT" != "none" ]]; then
    echo "--- Cost Check ---"
    check_cost
fi

echo "=== Environment loaded ==="
