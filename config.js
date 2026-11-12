// What a visitor's key may spend and for how long. Pollen is per visitor.
// One law costs a small model well under a thousandth of a Pollen.
export const BUDGET = 0.3;
export const EXPIRY_DAYS = 1;

// The app's publishable App Key (pk_...), sent as client_id so the consent screen names the app and usage is
// attributed. Its redirect URI must be this page's address exactly. Empty until the key exists.
export const APP_KEY = "pk_Hu8lBTEZAIUpRT88";

// Models offered first, all free for every visitor (paid_only is false on gen.pollinations.ai/v1/models).
export const DEFAULT_MODELS = [
    "z-ai/glm-5.3-flash",
    "deepseek/deepseek-v4.1-flash",
    "minimax/minimax-m3.1-flash",
    "openai/gpt-5.4-nano",
];
