// Fixed disclaimer text for sensitive-domain courses (CLAUDE.md content rules).
// Not server-only: the lesson page shows the same text (task 4.3).

export type DisclaimerDomain = "medical" | "legal" | "financial" | "safety";

export const DISCLAIMERS: Record<DisclaimerDomain, string> = {
  medical:
    "This lesson is for general education only and is not medical advice. Talk to a qualified health professional about your own situation.",
  legal:
    "This lesson is for general education only and is not legal advice. Laws vary by place and change over time; consult a qualified lawyer about your situation.",
  financial:
    "This lesson is for general education only and is not financial advice. Consider speaking with a qualified financial adviser before making decisions.",
  safety:
    "This lesson is for general education only. Follow official safety guidance and get hands-on training from a qualified instructor before trying anything risky.",
};
