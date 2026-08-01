/** esphome components that accept `use_address`, in pick order. Leaf
 *  module so the pure decision tree and the YAML splice helpers can
 *  share it without pulling each other in. */
export const NETWORK_SECTIONS = ["wifi", "ethernet", "openthread"] as const;
export type NetworkSection = (typeof NETWORK_SECTIONS)[number];
