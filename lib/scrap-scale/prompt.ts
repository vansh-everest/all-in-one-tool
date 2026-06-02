export const OCR_PROMPT = `You are reading a file that contains Indian digital payment confirmations or receipts (Google Pay, PhonePe, Paytm, BHIM/UPI, bank apps, or bank transfer receipts).

The file may be a single screenshot, several screenshots, or a PDF with one or more pages. It may show ONE payment or SEVERAL separate payments.

Return ONLY a JSON object, no markdown, with exactly these keys:
{"payments":[{"amount":number,"currency":string,"txn_id":string|null,"date":string|null}],"confidence":number,"notes":string}

Rules:
- Add ONE entry to "payments" for EACH distinct, successful/confirmed payment you can see (one per screenshot or per page if they are separate payments).
- "amount": the amount actually PAID/transferred, as a plain number — no currency symbol, no commas, no thousands separators. Ignore account balances, cashback, fees, reward points, and "amount to pay" UI hints. Use the confirmed transaction amount.
- "currency": e.g. "INR".
- "txn_id": the UPI transaction id / UTR / reference number if visible, else null.
- "date": the transaction date as shown (string) or null.
- "confidence": 0..1 — your overall confidence.
- "notes": short note. If you cannot read any amount, return {"payments":[],"confidence":0,"notes":"<reason>"}.

Output the JSON object and nothing else.`;
