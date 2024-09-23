require("@nomiclabs/hardhat-waffle");
require("dotenv").config();

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  networks: {
    aurora: {
      url: `https://mainnet.aurora.dev`,
      accounts: [process.env.privateKey],
    },
    fantom: {
      url: `https://rpc.ftm.tools`,
      accounts: [process.env.privateKey],
      gas: "auto"
    },
  },
  solidity: {
    compilers: [
      { version: "0.8.0" },
      //{ version: "0.8.7" },
      { version: "0.7.0" },
      { version: "0.6.6" }
    ]
  },
};
