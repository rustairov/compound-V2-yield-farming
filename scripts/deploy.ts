import { ethers } from 'hardhat';

async function main() {

  const CompoundV2YieldFarm = await ethers.getContractFactory('CompoundV2YieldFarm');
  const contract = await CompoundV2YieldFarm.deploy(
      '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
      '0xE592427A0AEce92De3Edee1F18E0157C05861564'
  );

  await contract.deployed();

  console.log(`Deployed to ${contract.address}`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
