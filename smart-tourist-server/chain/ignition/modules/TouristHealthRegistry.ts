import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("TouristHealthRegistryModule", (m) => {
  const registry = m.contract("TouristHealthRegistry");
  return { registry };
});
