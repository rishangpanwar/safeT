import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, toHex, getAddress } from "viem";

describe("TouristHealthRegistry (ERC-5192 soulbound permits)", async function () {
  const { viem } = await network.connect();
  const [owner, stranger] = await viem.getWalletClients();

  const tokenId = BigInt(keccak256(toHex("A1234567||salt"))); // stands in for SHA-256(NationalID || Salt)
  const soul = getAddress(`0x${keccak256(toHex(tokenId)).slice(-40)}`);
  const clinicalHash = keccak256(toHex("B+||diabetes||penicillin||contacts||pepper"));
  const farFuture = 2n ** 40n;

  async function deployWithPermit() {
    const registry = await viem.deployContract("TouristHealthRegistry");
    await registry.write.issuePermit([soul, tokenId, clinicalHash, farFuture]);
    return registry;
  }

  it("mints a locked permit and anchors only the clinical hash", async function () {
    const registry = await deployWithPermit();
    assert.equal(getAddress(await registry.read.ownerOf([tokenId])), soul);
    assert.equal(await registry.read.locked([tokenId]), true);
    assert.equal(await registry.read.verifyClinicalHash([tokenId, clinicalHash]), true);
    assert.equal(await registry.read.verifyClinicalHash([tokenId, keccak256(toHex("tampered"))]), false);
    assert.equal(await registry.read.supportsInterface(["0xb45a3c0e"]), true);
  });

  it("reverts every transfer and approval", async function () {
    const registry = await deployWithPermit();
    await viem.assertions.revertWithCustomError(registry.write.approve([stranger.account.address, tokenId]), registry, "Soulbound");
    await viem.assertions.revertWithCustomError(registry.write.setApprovalForAll([stranger.account.address, true]), registry, "Soulbound");
    await viem.assertions.revertWithCustomError(
      registry.write.transferFrom([soul, stranger.account.address, tokenId], { account: owner.account }),
      registry,
      "Soulbound",
    );
  });

  it("only the issuing authority can mint or update", async function () {
    const registry = await deployWithPermit();
    const asStranger = await viem.getContractAt("TouristHealthRegistry", registry.address, { client: { wallet: stranger } });
    await viem.assertions.revertWithCustomError(
      asStranger.write.issuePermit([stranger.account.address, 7n, clinicalHash, farFuture]),
      registry,
      "OwnableUnauthorizedAccount",
    );
    await viem.assertions.emitWithArgs(registry.write.updateSafetyStatus([tokenId, 2]), registry, "SafetyStatusUpdated", [tokenId, 2]);
  });

  it("revocation burns the permit", async function () {
    const registry = await deployWithPermit();
    await registry.write.revokePermit([tokenId]);
    assert.equal(await registry.read.verifyClinicalHash([tokenId, clinicalHash]), false);
  });
});
