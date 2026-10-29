/**
 * Whether the landing pages accept document requests (AX_DOCUMENT_REQUEST_ENABLED=true, #899).
 * Off by default: like the result mail, it is turned on only after the internal review of mail
 * to respondents, with the owner's approval. A link already mailed opens either way.
 */
export function axDocumentRequestEnabled(value = process.env.AX_DOCUMENT_REQUEST_ENABLED): boolean {
  return value?.trim().toLowerCase() === 'true';
}
