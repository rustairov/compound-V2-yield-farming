import 'dotenv/config';
import { Network } from 'alchemy-sdk';
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

const { ALCHEMY_API_KEY, PRIVATE_KEY } = process.env;

const config: HardhatUserConfig = {
  mocha: {
    timeout: 60000
  },
  solidity: {
    version: '0.8.15',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
      //viaIR: true,
    },
  },
  networks: {
    hardhat: {
      //allowUnlimitedContractSize: true,
      forking: {
        url: `https://${Network.ARB_MAINNET}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
      }
    },
    [Network.ARB_MAINNET]: {
      url: `https://${Network.ARB_MAINNET}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      accounts: [PRIVATE_KEY!]
    },
  }
};

export default config;
