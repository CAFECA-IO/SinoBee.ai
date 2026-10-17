import { config } from "./config";

/** PAYMENT_MODE=mock: local fake checkout and card binding (never in production builds) */
export const mockAllowed = () => config.payments.mode === "mock" && process.env.NODE_ENV !== "production";
