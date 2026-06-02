export const OCR_PROMPT = `You are reading a screenshot of an Indian digital payment confirmation (Google Pay, PhonePe, Paytm, BHIM/UPI, or a bank app).
Return ONLY a JSON object, no markdown, with exactly these keys:
{"amount": number|null, "currency": string, "txn_id": string|null, "date": string|null, "confidence": number, "notes": string}
Rules:
- "amount": the actual amount PAID/transferred in this transaction as a number (no currency symbol, no commas). If several numbers appear (balance, cashback, fee), return the transaction amount that was paid.
- "currency": e.g. "INR".
- "txn_id": the UPI transaction id / reference no / UTR if visible, else null.
- "date": transaction date as shown (string) or null.
- "confidence": 0..1, your confidence in the amount.
- "notes": short note; if the amount is unreadable, set "amount": null and explain why here.
Return null for any field you cannot read. Output the JSON object and nothing else.`;
