/**
 * The comms module's repositories (owned by the comms builder). Tenant explicit everywhere, every write audited,
 * message and letter text encrypted. Rules: ../context.ts and docs/clinic-system/contract.md §4.
 */
export * from "./consent";
export * from "./contacts";
export * from "./letters";
export * from "./messages";
export * from "./rules";
export * from "./schedule";
export * from "./settings";
export * from "./templates";
