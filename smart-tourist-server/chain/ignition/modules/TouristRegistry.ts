    import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const TouristRegistryModule = buildModule("TouristRegistryModule", (m) => {
  const touristRegistry = m.contract("TouristRegistry", []);
  return { touristRegistry };
});

export default TouristRegistryModule;