#!/bin/bash
# 00a_setup_budget.sh - AWS Budgets コストアラート設定（$100上限）
# 全リソース構築前に最初に実行する
source "$(dirname "$0")/env.sh"

echo ""
echo "=========================================="
echo " Phase 0a: Cost Control Setup (Budget \$100)"
echo "=========================================="

BUDGET_NAME="${PREFIX}-cost-limit"
BUDGET_AMOUNT="100"

# --- メールアドレス確認 ---
# Budget超過時のメール通知先
NOTIFY_EMAIL="${BUDGET_NOTIFY_EMAIL:-}"
if [ -z "$NOTIFY_EMAIL" ]; then
    echo "WARNING: BUDGET_NOTIFY_EMAIL が設定されていません。"
    echo "  通知メールを受け取るには env.sh に以下を追加してください:"
    echo "  export BUDGET_NOTIFY_EMAIL=\"your-email@example.com\""
    echo ""
    echo "  メール通知なしで続行します（CLIでのコスト確認は可能）。"
fi

# --- 既存Budget確認 ---
EXISTING=$(aws budgets describe-budgets --account-id "$ACCOUNT_ID" \
    --query "Budgets[?BudgetName=='${BUDGET_NAME}'].BudgetName" \
    --output text 2>/dev/null || echo "")

if [ -n "$EXISTING" ] && [ "$EXISTING" != "None" ]; then
    echo "Budget '$BUDGET_NAME' already exists. Updating..."
    aws budgets delete-budget --account-id "$ACCOUNT_ID" --budget-name "$BUDGET_NAME" 2>/dev/null || true
fi

# --- Budget作成 ---
echo "Creating Budget: $BUDGET_NAME (limit: \$${BUDGET_AMOUNT})"

# 通知設定
if [ -n "$NOTIFY_EMAIL" ]; then
    NOTIFICATION_JSON='[
        {
            "Notification": {
                "NotificationType": "ACTUAL",
                "ComparisonOperator": "GREATER_THAN",
                "Threshold": 50,
                "ThresholdType": "PERCENTAGE"
            },
            "Subscribers": [{"SubscriptionType": "EMAIL", "Address": "'$NOTIFY_EMAIL'"}]
        },
        {
            "Notification": {
                "NotificationType": "ACTUAL",
                "ComparisonOperator": "GREATER_THAN",
                "Threshold": 80,
                "ThresholdType": "PERCENTAGE"
            },
            "Subscribers": [{"SubscriptionType": "EMAIL", "Address": "'$NOTIFY_EMAIL'"}]
        },
        {
            "Notification": {
                "NotificationType": "ACTUAL",
                "ComparisonOperator": "GREATER_THAN",
                "Threshold": 100,
                "ThresholdType": "PERCENTAGE"
            },
            "Subscribers": [{"SubscriptionType": "EMAIL", "Address": "'$NOTIFY_EMAIL'"}]
        }
    ]'
else
    NOTIFICATION_JSON='[]'
fi

# 今月のBudget作成
CURRENT_YEAR=$(date +%Y)
CURRENT_MONTH=$(date +%m)

cat > /tmp/budget.json << BUDGET
{
    "BudgetName": "${BUDGET_NAME}",
    "BudgetLimit": {
        "Amount": "${BUDGET_AMOUNT}",
        "Unit": "USD"
    },
    "BudgetType": "COST",
    "TimeUnit": "MONTHLY",
    "TimePeriod": {
        "Start": "${CURRENT_YEAR}-${CURRENT_MONTH}-01T00:00:00Z",
        "End": "2087-06-15T00:00:00Z"
    }
}
BUDGET

aws budgets create-budget --account-id "$ACCOUNT_ID" \
    --budget file:///tmp/budget.json \
    --notifications-with-subscribers "$NOTIFICATION_JSON"

echo "  Budget created: \$${BUDGET_AMOUNT}/month"
if [ -n "$NOTIFY_EMAIL" ]; then
    echo "  Notifications: 50%, 80%, 100% → $NOTIFY_EMAIL"
fi

# --- 現在のコスト確認 ---
echo ""
echo "--- Current Month Cost ---"
CURRENT_COST=$(aws ce get-cost-and-usage \
    --time-period "Start=$(date +%Y-%m-01),End=$(date +%Y-%m-%d)" \
    --granularity MONTHLY \
    --metrics "UnblendedCost" \
    --query 'ResultsByTime[0].Total.UnblendedCost.Amount' \
    --output text 2>/dev/null || echo "N/A")
echo "  Current cost this month: \$${CURRENT_COST}"
echo "  Budget limit: \$${BUDGET_AMOUNT}"

save_id BUDGET_NAME "$BUDGET_NAME"
save_id BUDGET_AMOUNT "$BUDGET_AMOUNT"

echo ""
echo "=== Phase 0a Complete ==="
echo "  Budget: $BUDGET_NAME (\$${BUDGET_AMOUNT})"
echo "  各スクリプト実行前にコストチェック関数が自動実行されます"
