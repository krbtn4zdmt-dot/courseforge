// Fixed disclaimers for sensitive-domain courses. Code adds them to lessons (task 1.5)
// so the wording is always present and consistent; the Lesson Writer doesn't write its own.
import type { SensitiveDomain } from "./schemas";

export const SENSITIVE_DISCLAIMERS: Record<SensitiveDomain, string> = {
  medical:
    "This lesson is for general education only and is not medical advice. Talk to a qualified health professional about your own situation.",
  legal:
    "This lesson is for general education only and is not legal advice. Laws vary by place and change over time; consult a qualified lawyer about your situation.",
  financial:
    "This lesson is for general education only and is not financial advice. Consider speaking with a qualified financial adviser before making decisions.",
  safety:
    "This lesson is for general education only. Follow official safety guidance and get proper training and supervision before trying anything hands-on.",
};
