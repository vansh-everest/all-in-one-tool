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
    "Extract EVERY open/pending task, request or action mentioned — be inclusive, not conservative.",
    "Count as a task any of: an explicit request (\"please do X\", \"task: X\", \"close the task: X\",",
    "\"please complete the following task of X\", \"kindly arrange X\", \"need X\"), a pending",
    "document/NOC/NDC/letter/confirmation, a follow-up, anything awaiting a reply, or anything not yet done.",
    "Pull out the specific thing to do as the item. Examples:",
    "  \"Please close the task : jump\" -> item: \"close the task: jump\"",
    "  \"please complete the following task of Chola NDC - Glance part 3\" -> item: \"Chola NDC - Glance part 3\"",
    "Keep each item concise and factual (e.g. \"NACH to be revised to new EMI - submitted\").",
    "Only return an empty items array if the email genuinely contains no task, request or pending item at all.",
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
