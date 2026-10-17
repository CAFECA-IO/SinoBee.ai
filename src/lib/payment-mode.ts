import { config } from "./config";
import { oenConfigured } from "./oen";

/** PAYMENT_MODE=mock: local fake card binding and charges (never in production builds) */
export const mockAllowed = () => config.payments.mode === "mock" && process.env.NODE_ENV !== "production";

/**
 * Test mode without Oen test credentials: the built-in test gateway takes over. Cards are "bound" on a SinoBee test
 * page and charges are simulated, so the whole flow works and nothing reaches a bank.
 */
export const builtInTestGateway = () => config.testMode && !oenConfigured(true);

/** Card bindings and charges are simulated (development mock, or the built-in test gateway) */
export const simulatedPayments = () => mockAllowed() || builtInTestGateway();

/** A card bound through a simulator (its charges are simulated too, whatever the mode is now) */
export const simulatedCard = (card: { bindingId: string }) => card.bindingId.startsWith("mock_");
