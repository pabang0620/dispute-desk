#!/usr/bin/env bash
# One-shot: create a captured sandbox payment, then file a buyer dispute on it through the sandbox web UI.
# Usage: ./new_dispute.sh INR 41.37 Desk_Lamp     (use a unique amount, the UI picks the payment row by amount)
#        ./new_dispute.sh SNAD 66.12 Wool_Blanket
# Run inside the buyer pool wrapper (one account per run): payment, lookup and filing use the same buyer.
# Run one at a time: parallel buyer logins fail (the login page stays, no error is shown).
# Needs: pip install playwright && playwright install chromium; PAYPAL_* and SANDBOX_BUYER_* in .env
set -euo pipefail
cd "$(dirname "$0")"
kind="$1"; amt="$2"; item="${3:-Demo_Item}"
python3 make_payments.py "$amt:$item"
# The buyer dashboard often does not list a fresh payment, so look up the buyer txn id on the activity page first.
txn=$(python3 find_buyer_txn.py "$amt" | sed -n 's/^BUYER_TXN //p' || true)
python3 file_dispute_ui.py "$kind" "${txn:-auto}" "$amt"
