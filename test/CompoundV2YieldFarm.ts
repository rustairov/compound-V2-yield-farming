import { time, loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { abi as SwapRouterABI } from '@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json';
import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import ERC20 from '../abis/ERC20.json';
import Comptroller from '../abis/Comptroller.json';
import Pool from '../abis/CompoundV2Pool.json';

describe('CompoundV2YieldFarm', () => {

  let owner: any;
  let another: any;
  let uniswapRouter: any;
  let uniswapPool: any;
  let comptroller: any;
  let wNativeToken: any;
  let depositToken: any;
  let swapToken: any;
  let collateralToken: any;
  let borrowToken: any;
  let rewardToken: any;
  let contract: any;

  before(async () => {
    [owner, another] = await ethers.getSigners();

    console.log('Owner', owner.address);

    uniswapRouter = new ethers.Contract('0xE592427A0AEce92De3Edee1F18E0157C05861564', SwapRouterABI, owner);
    uniswapPool = new ethers.Contract('0xA961F0473dA4864C5eD28e00FcC53a3AAb056c1b', IUniswapV3PoolABI, owner); // ETH / DAI

    comptroller = new ethers.Contract('0x77401FF895BDe043d40aae58F98de5698682c12a', Comptroller, owner);

    wNativeToken = new ethers.Contract('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', ERC20, owner); // WETH
    depositToken = new ethers.Contract('0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', ERC20, owner); // DAI
    swapToken = new ethers.Contract('0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', ERC20, owner); // USDC
    collateralToken = new ethers.Contract('0xDe39Adfb2025D2aA51f6fD967e7C1753215f1905', Pool, owner);  // P_DAI
    borrowToken = new ethers.Contract('0x2Bf852e22C92Fd790f4AE54A76536c8C4217786b', Pool, owner);  // P_USDC
    rewardToken = new ethers.Contract('0x6F620EC89B8479e97A6985792d0c64F237566746', ERC20, owner); // WPC

    const CompoundV2YieldFarm = await ethers.getContractFactory('CompoundV2YieldFarm');
    contract = await CompoundV2YieldFarm.deploy(
        '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
        uniswapRouter.address
    );
  });

  describe('Swapping BASE_TOKEN for DEPOSIT_TOKEN...', async () => {
    it('Swaps BASE_TOKEN for DEPOSIT_TOKEN', async () => {
      const [token0, token1, fee] = await Promise.all([
        uniswapPool.token0(),
        uniswapPool.token1(),
        uniswapPool.fee()
      ]);

      const nativeBalanceBefore = await ethers.provider.getBalance(owner.address);
      const depositTokenBalanceBefore = await depositToken.connect(owner).balanceOf(owner.address);

      const amount = ethers.utils.parseUnits('1', 'ether');
      const data = uniswapRouter.interface.encodeFunctionData('exactInputSingle', [{
        tokenIn: wNativeToken.address,
        tokenOut: depositToken.address,
        fee: fee,
        recipient: owner.address,
        deadline: Math.floor(Date.now() / 1000),
        amountIn: amount,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      }]);

      const tx = await owner.sendTransaction({
        to: uniswapRouter.address,
        from: owner.address,
        data: data,
        value: amount,
        //gasLimit: 250000,
        gasLimit: ethers.utils.hexlify(1000000),
      });

      const receipt = await tx.wait();

      //console.log(receipt);

      const nativeBalanceAfter = await ethers.provider.getBalance(owner.address);
      const depositTokenBalanceAfter = await depositToken.balanceOf(owner.address);

      console.table({
        nativeBalanceBefore: ethers.utils.formatUnits(nativeBalanceBefore, 'ether'),
        nativeBalanceAfter: ethers.utils.formatUnits(nativeBalanceAfter, 'ether'),
        depositTokenBalanceBefore: ethers.utils.formatUnits(depositTokenBalanceBefore, 'ether'),
        depositTokenBalanceAfter: ethers.utils.formatUnits(depositTokenBalanceAfter, 'ether')
      });

      expect(depositTokenBalanceBefore).to.be.below(depositTokenBalanceAfter);
    });
  });

  describe('Contract test...', async () => {
    it('Test same pool', async () => {

      const amount = '300';
      const decimals = 'ether';

      const nativeBalanceBefore = await ethers.provider.getBalance(owner.address);
      const depositTokenBalanceBefore = await depositToken.connect(owner).balanceOf(owner.address);
      const rewardTokenBalanceBefore =  await rewardToken.connect(owner).balanceOf(owner.address);

      //await depositToken.connect(owner).transfer(contract.address, depositTokenBalanceBefore);
      await depositToken.connect(owner).transfer(contract.address, ethers.utils.parseUnits('300', decimals));


      //await contract.enterMarkets(
      //    comptroller.address, // comptroller
      //    collateralToken.address // cToken1
      //);

      await contract.deposit(
          depositToken.address, // DAI
          collateralToken.address, // cToken1
          ethers.utils.parseUnits(amount, decimals),
          30
      );

      await time.increase(20);

      //await contract.withdraw(ethers.utils.parseUnits(amount, decimals));
      await contract.withdraw();

      await contract.claim(
          comptroller.address, // comptroller
          rewardToken.address, // WPC
          'claimWpc(address)'
      );

      const nativeBalanceAfter = await ethers.provider.getBalance(owner.address);
      const depositTokenBalanceAfter = await depositToken.balanceOf(owner.address);
      const rewardTokenBalanceAfter =  await rewardToken.connect(owner).balanceOf(owner.address);

      console.table({
        nativeBalanceBefore: ethers.utils.formatUnits(nativeBalanceBefore, 'ether'),
        nativeBalanceAfter: ethers.utils.formatUnits(nativeBalanceAfter, 'ether'),
        depositTokenBalanceBefore: ethers.utils.formatUnits(depositTokenBalanceBefore, 'ether'),
        depositTokenBalanceAfter: ethers.utils.formatUnits(depositTokenBalanceAfter, 'ether'),
        rewardTokenBalanceBefore: ethers.utils.formatUnits(rewardTokenBalanceBefore, 'ether'),
        rewardTokenBalanceAfter: ethers.utils.formatUnits(rewardTokenBalanceAfter, 'ether')
      });

      expect(rewardTokenBalanceBefore).to.be.below(rewardTokenBalanceAfter);
    });


    it('Test different pool', async () => {

      const amount = '10';
      const decimals = 'ether';

      const nativeBalanceBefore = await ethers.provider.getBalance(owner.address);
      const depositTokenBalanceBefore = await depositToken.connect(owner).balanceOf(owner.address);
      const rewardTokenBalanceBefore =  await rewardToken.connect(owner).balanceOf(owner.address);

      await depositToken.connect(owner).transfer(contract.address, ethers.utils.parseUnits(amount, decimals));

      await contract.depositWithSwap(
          depositToken.address, // DAI
          collateralToken.address, // cToken1
          ethers.utils.parseUnits(amount, decimals),
          30,
          swapToken.address, // USDC
          borrowToken.address, // cToken2
          100 // fee
      );

      await time.increase(20);

      await contract.withdraw();

      await contract.claim(
          comptroller.address, // comptroller
          rewardToken.address, // WPC
          'claimWpc(address)'
      );

      const nativeBalanceAfter = await ethers.provider.getBalance(owner.address);
      const depositTokenBalanceAfter = await depositToken.balanceOf(owner.address);
      const rewardTokenBalanceAfter =  await rewardToken.connect(owner).balanceOf(owner.address);

      console.table({
        nativeBalanceBefore: ethers.utils.formatUnits(nativeBalanceBefore, 'ether'),
        nativeBalanceAfter: ethers.utils.formatUnits(nativeBalanceAfter, 'ether'),
        depositTokenBalanceBefore: ethers.utils.formatUnits(depositTokenBalanceBefore, 'ether'),
        depositTokenBalanceAfter: ethers.utils.formatUnits(depositTokenBalanceAfter, 'ether'),
        rewardTokenBalanceBefore: ethers.utils.formatUnits(rewardTokenBalanceBefore, 'ether'),
        rewardTokenBalanceAfter: ethers.utils.formatUnits(rewardTokenBalanceAfter, 'ether')
      });

      expect(rewardTokenBalanceBefore).to.be.below(rewardTokenBalanceAfter);
    });
  });
});