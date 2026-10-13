/** Fields agents must never see or fill. Detection by type, autocomplete, and name patterns. */

const NAME_PATTERN =
  /(pass(word|code|wd)?|pwd|otp|one[-_ ]?time|2fa|mfa|totp|cvv|cvc|csc|card[-_ ]?(num|number|no)?|ccnum|cc[-_ ]?(num|exp)|iban|routing|ssn|social[-_ ]?security|secret|pin)\b/i;

const SENSITIVE_AUTOCOMPLETE = /^(cc-|one-time-code|current-password|new-password)/i;

export function isSensitiveField(el: Element): boolean {
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (type === 'password') return true;
  const ac = (el.getAttribute('autocomplete') ?? '').trim().toLowerCase();
  if (ac.split(/\s+/).some((tok) => SENSITIVE_AUTOCOMPLETE.test(tok))) return true;
  const hints = [el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('data-testid')];
  for (const h of hints) {
    if (h && NAME_PATTERN.test(h.replace(/([a-z])([A-Z])/g, '$1_$2'))) return true;
  }
  return false;
}
