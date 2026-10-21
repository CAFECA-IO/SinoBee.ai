#!/usr/bin/env python3
"""Merge the /admin strings (2026-10 rework) into src/messages/{zh-TW,en}.json. Idempotent: run it after editing."""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

def L(zh, en):
    return (zh, en)

ACTIONS = {
    "ai_catalog_sync": L("同步供應商模型清單", "synced vendor model lists"),
    "ai_ollama_delete": L("刪除 Ollama 模型", "deleted an Ollama model"),
    "ai_ollama_pull": L("下載 Ollama 模型", "pulled an Ollama model"),
    "ai_prices_lookup": L("用 AI 查詢模型價格", "looked up model prices with AI"),
    "ai_tiers": L("修改模型等級", "changed the model tiers"),
    "crowd_checklist_publish": L("發布審核清單新版本", "published a new checklist version"),
    "crowd_dispute": L("裁決眾籌爭議", "decided a crowdfunding dispute"),
    "crowd_screening_confirm": L("確認提案審核結果", "confirmed a screening result"),
    "crowd_screening_rerun": L("請 AI 重審提案", "asked the AI to screen again"),
    "llm_hold_expired": L("結清逾時的模型用量", "settled expired model holds"),
    "llm_vendor_pause": L("暫停供應商", "paused a vendor"),
    "llm_vendor_resume": L("恢復供應商", "resumed a vendor"),
    "owner_bootstrap": L("成為超級管理者", "became super admin"),
    "owner_claim_fail": L("認領碼輸入錯誤", "entered a wrong claim code"),
    "payment_mismatch": L("付款金額不符", "payment amount mismatch"),
    "payment_refund": L("退款", "refunded a payment"),
    "payments_export": L("匯出付款 CSV", "exported payments as CSV"),
    "plan_update": L("修改方案", "changed a plan"),
    "plan_create": L("新增方案", "added a plan"),
    "pricing_settings": L("修改匯率與緩衝係數", "changed FX rate and buffer"),
    "price_update": L("修改模型價格", "changed a model price"),
    "price_create": L("新增模型", "added a model"),
    "role_grant": L("授予管理者", "granted admin"),
    "role_revoke": L("撤銷管理者", "revoked admin"),
    "role_transfer": L("移轉超級管理者", "transferred super admin"),
    "settings_update": L("修改設定", "changed a setting"),
    "settings_clear": L("清除設定", "cleared a setting"),
    "settings_generated": L("自動產生密鑰", "generated secrets"),
    "settings_import_env": L("從 .env 匯入設定", "imported settings from .env"),
    "settings_rotate": L("更換技能簽章金鑰", "rotated the skill signing key"),
    "skill_approve": L("通過技能", "approved a skill"),
    "skill_reject": L("退回技能", "sent back a skill"),
    "skill_revoke": L("撤銷技能", "revoked a skill"),
    "skill_behavior_pass": L("記錄評鑑技能行為測試通過", "recorded an evaluator behavior test pass"),
    "skill_behavior_fail": L("記錄評鑑技能行為測試未通過", "recorded an evaluator behavior test failure"),
    "tool_approve": L("通過工具", "approved a tool"),
    "tool_reject": L("退回工具", "sent back a tool"),
    "publisher_verify": L("驗證發布者", "verified a publisher"),
    "publisher_unverify": L("取消發布者驗證", "unverified a publisher"),
    "report_takedown": L("下架被檢舉的內容", "took down reported content"),
    "report_dismiss": L("不處理檢舉", "dismissed a report"),
    "user_disable": L("停用帳號", "disabled an account"),
    "user_enable": L("恢復帳號", "re-enabled an account"),
    "device_refresh_reuse": L("偵測到重複使用的裝置更新權杖", "saw a reused device refresh token"),
}

S = {
    "tab": {
        "overview": L("總覽", "Overview"), "review": L("內容審核", "Content review"), "reports": L("檢舉", "Reports"),
        "crowd": L("眾籌提案與爭議", "Crowdfunding"), "checklist": L("審核清單", "Screening checklist"), "users": L("用戶", "Users"),
        "payments": L("付款與退款", "Payments"), "plans": L("訂閱方案", "Plans"), "models": L("模型與定價", "Models & pricing"),
        "settings": L("系統設定", "Settings"), "audit": L("操作紀錄", "Audit log"), "storage": L("儲存狀態", "Storage"),
    },
    "nav": {"review": L("審核", "Review"), "business": L("用戶與營收", "Users & revenue"), "models": L("模型", "Models"), "system": L("系統", "System")},
    "wait": {"min": L("{n} 分鐘", "{n} min"), "hour": L("{n} 小時", "{n} h"), "day": L("{n} 天", "{n} days")},
    "ov": {
        "modeLive": L("正式模式", "Live"), "modeTest": L("測試模式開啟中", "Test mode on"),
        "blocking": L("上線前還有 {n} 項會擋住用戶", "{n} {n, plural, one {thing blocks} other {things block}} users before going live"),
        "adviceCount": L("另有 {n} 項建議", "plus {n} {n, plural, one {suggestion} other {suggestions}}"),
        "advice": L("上線建議 · {n}", "Suggestions before going live · {n}"), "show": L("顯示 / 收合", "show / hide"),
        "fixIt": L("前往設定", "Fix"), "metrics": L("營運指標", "Key numbers"),
        "revenue30": L("近 30 天收款", "Revenue, last 30 days"), "revenue30Sub": L("{n} 筆 · 退款 {refunds}（{r} 筆）", "{n} payments · refunds {refunds} ({r})"),
        "subs": L("訂閱中", "Active subscriptions"), "subsNone": L("目前沒有訂閱", "No subscriptions yet"),
        "relay": L("模型轉接（24 小時）", "Model relay, 24 h"), "calls": L("{n} 次", "{n} calls"), "relaySub": L("錯誤率 {err} · 成本 {cost}", "error rate {err} · cost {cost}"),
        "users": L("用戶", "Users"), "usersSub": L("近 7 天新增 {n}", "{n} new in 7 days"),
        "inbox": L("待處理 · {n}", "Waiting for you · {n}"), "inboxSort": L("等最久的在最上面", "longest wait first"),
        "inboxEmpty": L("目前沒有待處理的事。", "Nothing is waiting."), "inboxFilteredEmpty": L("這一類目前沒有待處理的事。", "Nothing of this kind is waiting."),
        "filter": {"all": L("全部", "All"), "review": L("審核", "Review"), "report": L("檢舉", "Reports"), "crowd": L("眾籌", "Crowdfunding"), "payment": L("付款", "Payments")},
        "kind": {"skill": L("技能", "Skill"), "tool": L("工具", "Tool"), "report": L("檢舉", "Report"), "screening": L("提案", "Proposal"), "dispute": L("爭議", "Dispute"), "payment": L("付款", "Payment")},
        "act": {"skill": L("審核", "Review"), "tool": L("審核", "Review"), "report": L("處理", "Handle"), "screening": L("確認", "Confirm"), "dispute": L("裁決", "Decide"), "payment": L("查看", "Open")},
        "detail": {
            "scanFindings": L("自動掃描發現 {n} 項，需要檢查", "{n} scan {n, plural, one {finding} other {findings}} to check"),
            "scanClean": L("掃描沒有發現問題", "Scan found nothing"),
            "report": {
                "task": L("任務被 @{who} 檢舉：{reason}", "Task reported by @{who}: {reason}"),
                "share": L("分享頁被 @{who} 檢舉：{reason}", "Share reported by @{who}: {reason}"),
                "tool": L("工具被 @{who} 檢舉：{reason}", "Tool reported by @{who}: {reason}"),
            },
            "aiApprove": L("AI 建議通過（{passed} / {total} 項符合），等待確認", "AI suggests approval ({passed} / {total}); waiting for you"),
            "aiReject": L("AI 建議退回（{passed} / {total} 項符合），等待確認", "AI suggests sending it back ({passed} / {total}); waiting for you"),
            "screeningBusy": L("AI 審核中", "AI screening in progress"),
            "dispute": L("驗收被否決且已無重做次數：{note}", "Acceptance rejected with no rework left: {note}"),
            "payment": {
                "SUBSCRIPTION": L("訂閱付款，Oen 還沒回報結果", "Subscription payment Oen has not reported back on"),
                "CROWD_PLEDGE": L("眾籌出資，Oen 還沒回報結果", "Crowdfunding pledge Oen has not reported back on"),
                "CROWD_PROPOSAL": L("提案費，Oen 還沒回報結果", "Proposal fee Oen has not reported back on"),
            },
        },
        "waiting": L("等待 {t}", "waiting {t}"), "more": L("另有 {n} 項", "{n} more"),
        "recent": L("最近的管理操作", "Recent admin actions"), "allAudit": L("全部操作紀錄", "Full audit log"),
        "adminNote": L("你是管理者：系統設定只有超級管理者能修改。", "You are an admin: only the super admin can change settings."),
        "check": {
            "payments": {"title": L("Oen 金流未設定", "Oen payments not set up"), "fix": L("缺網域名稱與 API Token，無法收款與綁卡。", "Without the domain and API token nobody can pay or bind a card.")},
            "paymentsLive": {"title": L("金流切到正式環境", "Switch payments to production"), "fix": L("測試完成後切換為 production（需先申請固定 IP 白名單）。", "Switch to production after testing (needs the server IP on Oen's allowlist).")},
            "modelKeys": {"title": L("模型 API 金鑰", "Model API keys"), "fix": L("沒有金鑰，訂閱用戶無法使用任何模型。", "Without a key, subscribers cannot use any model.")},
            "legal": {"title": L("統一編號與地址", "Tax ID and address"), "fix": L("會顯示在條款與政策頁。", "Shown in the terms and policies.")},
            "hubKey": {"title": L("技能簽章金鑰", "Skill signing key"), "fix": L("重新啟動網站會自動產生。", "Generated automatically when the site restarts.")},
            "boltchain": {"title": L("Boltchain 節點", "Boltchain node"), "fix": L("設定節點 RPC，或以 npm run swarm 啟動本機節點。", "Set a node RPC, or start a local node with npm run swarm.")},
            "signatures": {"title": L("要求裝置簽章", "Require device signatures"), "fix": L("用戶都更新 SinoBee 後開啟，模型轉接只接受簽章請求。", "Turn on once users have updated SinoBee; the relay then takes signed requests only.")},
        },
    },
    "rv": {
        "search": L("搜尋名稱或發布者", "Search name or publisher"), "list": L("審核清單", "Review queue"),
        "status": {"pending": L("待審", "Waiting"), "approved": L("已上架", "Approved"), "rejected": L("已退回", "Sent back")},
        "kind": {"all": L("技能與工具", "Skills & tools"), "skill": L("技能", "Skill"), "tool": L("工具", "Tool")},
        "empty": {"pending": L("沒有等待審核的版本。", "Nothing is waiting for review."), "approved": L("還沒有上架的版本。", "Nothing approved yet."), "rejected": L("沒有退回或撤銷的版本。", "Nothing sent back or revoked.")},
        "noMatch": L("沒有符合的版本。", "No version matches."), "pick": L("從左邊選一個版本。", "Pick a version on the left."),
        "findings": L("掃描發現 {n}", "{n} {n, plural, one {finding} other {findings}}"), "clean": L("掃描無異常", "scan clean"),
        "waiting": L("等待 {t}", "waiting {t}"), "revoked": L("已撤銷", "revoked"),
        "st": {"PENDING_REVIEW": L("待審", "Waiting"), "APPROVED": L("已上架", "Approved"), "REJECTED": L("已退回", "Sent back"), "REVOKED": L("已撤銷", "Revoked")},
        "openHub": L("在 Skill Hub 開啟", "Open in Skill Hub"), "openTool": L("開啟工具頁", "Open tool page"),
        "publisher": L("發布者", "Publisher"), "previous": L("上一版 {v}（{st}）", "previous {v} ({st})"), "firstVersion": L("第一個版本", "first version"),
        "submitted": L("送審", "submitted"), "lastNote": L("審核備註", "Review note"),
        "findingsTitle": L("自動掃描發現 {n} 項，請先看過再決定", "The scanner found {n} {n, plural, one {thing} other {things}}; read before deciding"),
        "rule": {
            "network-egress": L("對外連線", "network access"), "prompt-injection": L("提示注入", "prompt injection"), "secret": L("疑似密鑰", "possible secret"),
            "shell": L("執行指令", "shell command"), "warn": L("提示", "note"), "error": L("錯誤", "error"),
        },
        "views": L("檢視", "View"), "diffWith": L("與 {v} 的差異", "Changes since {v}"), "diffNone": L("內容", "Content"), "filesN": L("檔案 · {n}", "Files · {n}"),
        "file": {"added": L("新增", "added"), "removed": L("移除", "removed"), "changed": L("修改", "changed"), "same": L("相同", "same")},
        "noChange": L("與上一版內容相同。", "Same as the previous version."), "diffSummary": L("+{added} 行、−{removed} 行", "+{added} lines, −{removed} lines"), "skipped": L("{n} 行未變更", "{n} unchanged lines"),
        "decide": L("決定", "Decision"), "approve": L("通過並簽章", "Approve & sign"), "reject": L("退回給發布者", "Send back"),
        "ack": L("我已看過 {n} 項掃描發現，確認不構成風險", "I read the {n} scan {n, plural, one {finding} other {findings}} and they are not a risk"),
        "noteOptional": L("給發布者的備註（選填）", "Note to the publisher (optional)"),
        "rejectReason": L("退回原因（必填，發布者會收到）", "Why (required; the publisher receives it)"),
        "rejectPlaceholder": L("例如：scripts/upload.py 會把資料送到未說明的外部網址，請移除或在 SKILL.md 說明用途。", "e.g. scripts/upload.py sends data to an undisclosed address; remove it or explain it in SKILL.md."),
        "approveGo": L("通過並簽章", "Approve & sign"), "rejectGo": L("退回", "Send back"), "saving": L("送出中…", "Sending…"),
        "thenNext": L("送出後自動跳到下一筆", "then on to the next one"),
        "more": L("更多操作", "More"), "revokeHelp": L("撤銷後這個版本會列入撤銷清單，已安裝的 SinoBee 會停止使用它，並通知發布者。", "Revoking lists this version as revoked: installed SinoBee stops using it, and the publisher is told."),
        "revokeReason": L("撤銷原因（必填，發布者會收到）", "Why (required; the publisher receives it)"), "revoke": L("撤銷這個版本", "Revoke this version"),
        "revokeConfirm": L("撤銷後無法復原。確定撤銷？", "Revoking cannot be undone. Revoke?"),
        "closed": L("已於 {at} 處理。", "Decided on {at}."),
    },
    "us": {
        "filter": {"all": L("全部", "All"), "subscribed": L("訂閱中", "Subscribed"), "staff": L("管理團隊", "Staff"), "publishers": L("發布者", "Publishers"), "disabled": L("已停用", "Disabled")},
        "col": {"user": L("用戶", "User"), "plan": L("方案", "Plan"), "usage": L("30 天用量", "Usage, 30 days"), "payments": L("付款", "Payments"), "last": L("最後登入", "Last sign-in")},
        "disabled": L("已停用", "Disabled"), "pendingN": L("{n} 筆待確認", "{n} pending"), "failedN": L("{n} 筆失敗", "{n} failed"),
        "prev": L("上一頁", "Previous"), "next": L("下一頁", "Next"), "range": L("第 {from}–{to} 筆，共 {total} 筆", "{from}–{to} of {total}"),
        "close": L("關閉", "Close"), "joined": L("加入", "Joined"), "publisherId": L("發布者 {id}", "publisher {id}"),
        "subUsage": L("訂閱與用量", "Plan and usage"), "plan": L("方案", "Plan"), "freePlan": L("免費額度", "Free allowance"),
        "until": L("到 {d}", "until {d}"), "upcoming": L("另有 {n} 期已購", "{n} more paid"),
        "usage30": L("30 天用量", "Usage, 30 days"), "calls": L("{n} 次呼叫", "{n} calls"), "topModels": L("最常用模型", "Top models"),
        "payments": L("付款", "Payments"), "allPayments": L("在付款頁查看", "Open in Payments"),
        "published": L("發布的內容", "Published"), "skill": L("技能", "skill"), "tool": L("工具", "tool"),
        "permissions": L("權限", "Permissions"), "selfNote": L("這是你自己的帳號。", "This is your own account."),
        "grant": L("設為管理者", "Make admin"), "grantConfirm": L("管理者可以審核內容、處理付款與退款、停用帳號。確定？", "Admins can review content, refund payments and disable accounts. Continue?"),
        "disable": L("停用帳號", "Disable account"), "disableHelp": L("停用後無法登入，現有的登入與 API 權杖立即失效；可隨時恢復。", "A disabled user cannot sign in, and their sessions and API tokens stop working at once. You can undo it."),
        "disableReason": L("停用原因（寫入操作紀錄）", "Reason (kept in the audit log)"), "disableGo": L("停用", "Disable"),
        "disableConfirm": L("確定停用這個帳號？", "Disable this account?"), "enable": L("恢復帳號", "Re-enable"),
        "transfer": L("移轉超級管理者", "Transfer super admin"), "transferHelp": L("移轉後你會變成一般管理者。請輸入對方完整的帳號地址確認。", "You become an admin after the transfer. Type their full account address to confirm."),
    },
    "pay": {
        "summary": L("近 30 天收款 {amount}（{n} 筆）· 退款 {refunded}", "Last 30 days: {amount} ({n}) · refunds {refunded}"),
        "stale": L("{n} 筆付款超過 15 分鐘沒有結果", "{n} {n, plural, one {payment has} other {payments have}} had no result for over 15 minutes"),
        "staleRow": L("@{user} {amount}，{ago}前", "@{user} {amount}, {ago} ago"), "showPending": L("查看待確認", "Show pending"),
        "search": L("用戶、帳號、交易編號或任務", "User, account, transaction or task"),
        "period": L("期間", "Period"), "days": L("{n} 天", "{n} days"), "allTime": L("全部", "All time"), "csv": L("匯出 CSV", "Export CSV"),
        "none": L("沒有符合的付款。", "No payment matches."), "first100": L("只列出最新 100 筆；用搜尋或匯出 CSV 看更多。", "Showing the newest 100; search or export CSV for more."),
        "amountCol": L("金額（TWD）", "Amount (TWD)"), "close": L("關閉", "Close"),
        "transaction": L("Oen 交易", "Oen transaction"), "provider": L("通道", "Provider"), "card": L("付款卡", "Card"),
        "cancelled": L("已取消", "cancelled"), "task": L("任務", "Task"), "confirmedAt": L("確認時間", "Confirmed"),
        "refunded": L("已退款", "Refunded"), "error": L("錯誤", "Error"),
        "pendingTitle": L("尚未收到結果", "No result yet"), "pendingHelp": L("Oen 的付款通知沒有到；向 Oen 查詢會以交易紀錄為準更新狀態。", "Oen's notice has not arrived; asking Oen updates the status from its transaction record."),
        "refundTitle": L("退款", "Refund"), "refundRules": L("每筆交易只能退款一次；退款透過 Oen 退回原付款卡。", "One refund per transaction, back to the card through Oen."),
        "amount": L("金額（最多 NT${max}）", "Amount (up to NT${max})"), "reason": L("原因（寫入操作紀錄）", "Reason (kept in the audit log)"), "reasonPh": L("例如：用戶誤購", "e.g. bought by mistake"),
        "refundGo": L("退款 NT${amount}", "Refund NT${amount}"), "refundConfirm": L("透過 Oen 退款 NT${amount}？每筆交易只能退款一次。", "Refund NT${amount} through Oen? Each transaction can be refunded once."),
        "effectSub": L("退款後這一期訂閱立即取消，後續期間往前遞補；@{user} 沒有其他訂閱時改回免費額度。", "The period is cancelled at once and later periods move up; without another period @{user} falls back to the free allowance."),
        "effectPledge": L("出資退款以任務尚未使用的預算為上限。", "A pledge refund is capped by the task's unspent budget."),
        "effectOther": L("退款後無法再次退款。", "No second refund is possible."),
        "noRefund": L("這筆付款已無可退金額。", "Nothing left to refund."), "noRefundProposal": L("提案費不能從這裡退款（平台錯誤請在 Oen CRM 處理）。", "Proposal fees are not refunded here (handle a platform error in the Oen CRM)."),
    },
    "md": {
        "formula": L("公告價 = 原廠 USD × 匯率 {fx} × 緩衝 {buffer}", "Published price = vendor USD × FX {fx} × buffer {buffer}"),
        "addModel": L("新增模型", "Add model"), "close": L("關閉", "Close"),
        "unknownTitle": L("{n} 個提供中的模型不在供應商清單裡", "{n} offered {n, plural, one {model is} other {models are}} not in the vendor's list"),
        "noKeyTitle": L("{n} 個提供中的模型沒有 API 金鑰，呼叫會失敗", "{n} offered {n, plural, one {model has} other {models have}} no API key and would fail"),
        "addKeys": L("填入金鑰", "Add keys"),
        "tiersTitle": L("等級與備援順序", "Tiers and fallback order"),
        "tiersHelp": L("主要模型失敗時依箭頭順序改用下一個；網頁、程式等複雜工作不會分到 Haiku、Luna、Flash Lite、mini、nano 這一級。", "When a model fails the next one in line is used; complex work (pages, code) never gets the Haiku / Luna / Flash Lite / mini / nano class."),
        "auto": L("（自動：第一個有金鑰的上架模型）", "(automatic: the first offered model with a key)"),
        "issue": {"noKey": L("無金鑰", "no key"), "paused": L("供應商暫停", "vendor paused"), "unpriced": L("未定價", "not priced"), "withdrawn": L("已下架", "withdrawn"), "unknown": L("不在供應商清單", "not in vendor list")},
        "jobsLine": L("平台工作：{list}", "Platform jobs: {list}"), "editTiers": L("調整等級與平台工作", "Edit tiers and jobs"),
        "keyOk": L("金鑰已設定", "key set"), "local": L("本機模型，不需金鑰", "local, no key needed"), "offeredN": L("{n} / {all} 個提供中", "{n} of {all} offered"),
        "noModels": L("還沒有定價的模型。", "No priced model yet."), "ollamaNone": L("Ollama 的模型同步後會出現在這裡。", "Ollama models appear here once synced."),
        "model": L("模型", "Model"), "state": L("狀態", "State"), "upcoming": L("排定上架", "scheduled"), "offered": L("提供中", "offered"),
        "changeScheduled": L("已排定調價", "change scheduled"),
        "unitNote": L("價格為公告價，NT$ / 每 100 萬 tokens；滑過數字可看原廠 USD。點模型名稱修改。", "Published prices, NT$ per 1M tokens; hover a number for the vendor USD. Click a model to change it."),
        "vendorPaused": L("已暫停", "paused"),
        "history": L("價格紀錄", "Price history"), "scheduled": L("排定", "scheduled"), "currentPrice": L("目前", "current"),
        "usdLegend": L("原廠 USD / 每 100 萬 tokens", "Vendor USD per 1M tokens"),
        "impact": L("訂閱方案的毛利不受影響（公告價隨原廠價格調整）；同樣的額度能用的 tokens 會跟著改變。", "Plan margins do not change (published prices follow the vendor's); the tokens an allowance buys do."),
        "when": L("何時生效", "Takes effect"), "now": L("立即", "Now"), "at": L("指定時間", "At"),
        "saveNew": L("儲存新價格", "Save new price"), "withdrawConfirm": L("下架 {model}？使用中的 SinoBee 會改用其他模型。", "Withdraw {model}? SinoBee switches to other models."),
        "formulaEdit": L("修改匯率與緩衝係數", "Change FX rate and buffer"),
        "bufferNote": L("緩衝係數同時影響所有方案的毛利（以用滿額度估算時）與眾籌任務的 token 價格。", "The buffer moves every plan's worst-case margin and the token price of crowdfunded tasks."),
    },
    "pl": {
        "close": L("關閉", "Close"), "compare": L("方案比較", "Plans side by side"),
        "onSale": L("上架中", "On sale"), "offSale": L("未上架", "Not on sale"), "edit": L("編輯", "Edit"),
        "freeWho": L("登入即有", "for every signed-in user"), "perMonth": L("/ 月", "/ month"),
        "basisActual": L("依 {n} 期實際用量", "from {n} {n, plural, one {period} other {periods}} of real use"), "basisFull": L("尚無用量資料，以用滿額度估算", "no usage yet: assumes the whole allowance is used"),
        "profit": L("獲利 {p}%", "profit {p}%"), "loss": L("虧損 {p}%", "loss {p}%"), "noCost": L("幾乎沒有成本", "almost no cost"),
        "barLoss": L("虧損", "loss"), "barEven": L("打平", "break-even"), "barHealthy": L("健康（≥ 50%）", "healthy (≥ 50%)"),
        "worstCase": L("用滿額度時：{m}", "If the whole allowance is used: {m}"),
        "freeCost": L("每位使用者平均成本 {cost}（近 30 天 {n} 人）", "average cost per user {cost} ({n} users, 30 days)"),
        "freeCostFull": L("每人用滿時成本 {cost}", "cost per user who uses it all: {cost}"),
        "allowance": L("每 30 天可用", "Allowance per 30 days"), "about": L("約等於", "About"), "tokens": L("{n} tokens", "{n} tokens"), "tokensShort": L("約 tokens", "≈ tokens"),
        "cap6": L("每 6 小時最多", "Per 6 hours, at most"), "cap7": L("每 7 天最多", "Per 7 days, at most"),
        "subscribers": L("訂閱中", "Subscribers"), "people": L("{n} 人", "{n}"), "avgUse": L("平均用量", "Average use"),
        "fixLoss": L("讓 {plan} 不虧損", "Stop {plan} losing money"), "fixThin": L("提高 {plan} 的毛利", "Raise {plan}'s margin"),
        "sugMult": L("用量倍數 {from} → {to}", "Usage multiple {from} → {to}"),
        "sugMultHealthy": L("只影響這個方案：每 30 天可用 {from} → {to}，獲利 50%。", "This plan only: allowance {from} → {to}, 50% profit."),
        "sugMultEven": L("只影響這個方案：每 30 天可用 {from} → {to}，剛好打平。", "This plan only: allowance {from} → {to}, break-even."),
        "sugFee": L("月費 {from} → {to}", "Monthly fee {from} → {to}"),
        "sugFeeHelp": L("依實際平均用量，獲利 50%；可用額度維持不變。", "50% profit at today's average use; the allowance stays the same."),
        "sugBuffer": L("緩衝係數 {from} → {to}", "Buffer {from} → {to}"),
        "sugBufferHelp": L("所有模型的公告價與眾籌任務的 token 價格都提高 {pct}%。", "Every published price and crowdfunded token price rises {pct}%."),
        "toModels": L("到模型與定價調整", "Change in Models & pricing"),
        "applyTo": L("套用到 {plan}", "Apply to {plan}"),
        "applyConfirm": L("修改 {plan}？目前 {n} 位訂閱者從下一期開始適用。", "Change {plan}? Its {n} subscribers get it from their next period."),
        "applyFeeConfirm": L("調整 {plan} 的月費？已購買的期間不受影響。", "Change {plan}'s fee? Periods already bought are not affected."),
        "how": L("可用額度以公告價計；6 小時與 7 天上限由 30 天額度推算（÷ 4.8、再 ÷ 10）；tokens 以 {model} 的公告價換算（輸入：輸出 = 3：1）。毛利以「相對成本」表示：獲利 50% 代表收入是原廠成本的 1.5 倍。", "Allowances are at published prices; the 6-hour and 7-day caps follow from the 30-day allowance (÷ 4.8, then ÷ 10); tokens are counted at {model}'s published price (input:output = 3:1). Profit is relative to cost: 50% means revenue is 1.5× the vendor cost."),
        "headSub": L("緩衝係數 {buffer}", "Buffer {buffer}"), "bufferWhere": L("（在模型與定價修改）", "(set in Models & pricing)"),
        "losing": L("{n} 個上架方案正在虧損", "{n} {n, plural, one {plan on sale loses} other {plans on sale lose}} money"),
        "fee": L("月費（TWD）", "Monthly fee (TWD)"), "multiplier": L("用量倍數", "Usage multiple"),
        "multiplierHelp": L("每 30 天可用額度 = 月費 × 用量倍數", "Allowance per 30 days = fee × this"),
        "codeHelp": L("小寫英數，建立後不建議修改", "lowercase slug; avoid changing it later"),
        "marginFull": L("用滿額度時", "If all of it is used"),
        "ofPro": L("約 {plan} 的 1/{r}", "about 1/{r} of {plan}"), "setOfPro": L("設為 {plan} 的 1/{r}", "Set to 1/{r} of {plan}"),
    },
    "set": {
        "security": L("加密與備份", "Encryption & backup"), "securityHelp": L("設定加密金鑰的位置與指紋。", "Where the settings key lives, and its fingerprint."),
        "goLive": L("上線還差 {n} 項", "{n} {n, plural, one {thing} other {things}} left before going live"),
        "goLiveSub": L("完成 {done} / {total} · 紅色 {blocking} 項會擋住用戶", "{done} of {total} done · {blocking} in red block users"),
    },
    "cr": {
        "sub": L("審核中 {s} · 爭議 {d}", "{s} in screening · {d} disputed"),
        "disputes": L("待裁決的爭議", "Disputes to decide"), "noDisputes": L("沒有待裁決的爭議。", "No dispute is waiting."),
        "dispute": L("爭議", "Dispute"), "backers": L("{n} 位出資者", "{n} {n, plural, one {backer} other {backers}}"),
        "disputeHelp": L("出資者否決了成果，且重做次數已用完。判定通過：照常結算；判定不通過：全部經費（含已使用部分）依出資比例轉為出資者的平台點數。", "Backers rejected the result and no rework is left. Pass: settle as usual. Fail: the whole budget, spent part included, goes back to the backers as platform points."),
        "noScreening": L("沒有審核中的提案。", "No proposal is in screening."), "days": L("{n} 天", "{n} days"),
        "sentBackTag": L("已退回", "Sent back"), "recent": L("最近的審核結果", "Recent results"), "passed": L("通過", "Passed"), "rejected": L("退回", "Sent back"),
    },
    "rp": {
        "count": L("{n} 筆檢舉 · {targets} 個對象", "{n} reports · {targets} targets"), "none": L("沒有未處理的檢舉。", "No open report."),
        "type": {"task": L("任務", "Task"), "share": L("分享頁", "Share"), "tool": L("工具", "Tool")},
        "owner": L("擁有者 @{who}", "owner @{who}"), "gone": L("已不存在", "gone"), "times": L("被檢舉 {n} 次", "reported {n} times"),
        "effect": {
            "task": L("下架：募資中的眾籌會關閉（不扣款）；已在執行或完成的任務改為不公開。並通知提案者。", "Take down: a campaign still raising money closes (nobody is charged); a running or finished task is hidden from public listings. The owner is told."),
            "share": L("下架：分享內容永久刪除（無法復原），通知擁有者。", "Take down: the share is destroyed for good, the owner is told."),
            "tool": L("下架：工具從目錄移除，通知擁有者。", "Take down: the tool leaves the directory, the owner is told."),
        },
    },
    "au": {
        "count": L("共 {n} 筆", "{n} entries"), "all": L("全部", "All"),
        "area": {"review": L("審核", "Review"), "people": L("帳號與角色", "Accounts & roles"), "money": L("付款", "Payments"), "pricing": L("價格與方案", "Prices & plans"), "models": L("模型", "Models"), "crowd": L("眾籌與檢舉", "Crowdfunding & reports"), "settings": L("設定", "Settings")},
        "who": L("操作者（代稱或帳號）", "Who (handle or account)"), "go": L("篩選", "Filter"), "system": L("系統", "System"),
        "prev": L("上一頁", "Previous"), "next": L("下一頁", "Next"), "pageOf": L("第 {page} / {pages} 頁", "Page {page} of {pages}"),
        "action": ACTIONS,
    },
    "st": {
        "on": L("已啟用", "On"), "offShort": L("未啟用", "Off"), "offTitle": L("Boltchain 儲存尚未啟用", "Boltchain storage is off"),
        "setUp": L("前往設定", "Set up"), "noObjects": L("還沒有任何物件。", "No objects yet."),
    },
    "settings": {"custom": L("已自訂", "customised")},
}

CHECKLIST = {"allDims": L("全部", "All"), "find": L("搜尋題目", "Find an item"), "done": L("完成", "Done"), "edit": L("編輯", "Edit")}


def pick(tree, i):
    if isinstance(tree, tuple):
        return tree[i]
    return {k: pick(v, i) for k, v in tree.items()}


def merge(dst, src):
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            merge(dst[k], v)
        else:
            dst[k] = v


for i, name in enumerate(["zh-TW", "en"]):
    p = ROOT / "src/messages" / f"{name}.json"
    d = json.loads(p.read_text())
    # sections that were merged away
    for k in ["pending", "approved", "tools", "disputes", "screening", "prices", "ai"]:
        d["admin"]["tab"].pop(k, None)
    d["admin"]["nav"] = {}
    d["admin"].pop("overview", None)  # replaced by admin.ov
    merge(d["admin"], pick(S, i))
    merge(d["checklist"], pick(CHECKLIST, i))
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
    print("wrote", p.name)
