/**
 * The diary's repositories (module "diary" – docs/clinic-system/diary.md). Every function takes the clinic
 * explicitly; every write takes the actor and is audited.
 */
export * from "./appointments";
export * from "./availability";
export * from "./slots";
export * from "./waiting-list";
export { isClashError } from "./shared";
export * from "./settings";
