export function buildClassifyPrompt(
  lenders: { id: string; name: string }[],
  email: { subject: string; snippet: string },
): string {
  const list = lenders.map((l) => `- ${l.id}: ${l.name}`).join("\n");
  return [
    "You classify an email as being from one of these lenders/banks, or none.",
    "Lenders (id: name):",
    list,
    "",
    `Email subject: ${email.subject}`,
    `Email snippet: ${email.snippet}`,
    "",
    'Respond with JSON only: {"lender_id": "<one of the ids above, or \\"none\\">", "confidence": <0..1>}.',
  ].join("\n");
}

export function buildExtractPrompt(
  lenderName: string,
  messages: { id: string; date: string; body: string }[],
): string {
  const blocks = messages
    .map((m) => `--- message_id: ${m.id} (date: ${m.date}) ---\n${m.body}`)
    .join("\n\n");
  return [
    `These are the latest email(s) in a thread with the lender "${lenderName}".`,
    "Extract the list of OPEN pending items (things still to be done or awaited).",
    "Be concise and factual, matching short status-note style (e.g. \"NACH to be revised to new EMI - submitted\").",
    "",
    "Respond with JSON only in exactly this shape:",
    "{",
    '  "items": [',
    '    { "item": string, "status": string, "last_update_date": string|null,',
    '      "direction": "awaiting_lender" | "action_on_us" | "unclear", "source_message_id": string }',
    "  ],",
    '  "last_contact_date": string|null',
    "}",
    "Use the message_id values shown below for source_message_id. If there are no open items, return an empty items array.",
    "",
    blocks,
  ].join("\n");
}
