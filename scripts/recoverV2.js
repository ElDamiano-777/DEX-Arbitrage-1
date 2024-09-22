const hre = require("hardhat");
const fs = require("fs");
require("dotenv").config();

let config, arb, owner;
const network = hre.network.name;
if (network === 'aurora') config = require('./../config/aurora.json');
if (network === 'fantom') config = require('./../config/fantom.json');

const main = async () => {
  [owner] = await ethers.getSigners();
  console.log(`Owner: ${owner.address}`);
  
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  
  // Funktion zur Bestimmung des Gaspreises
  const getGasPrice = async () => {
    try {
      // Versuche zuerst, den Gaspreis vom Netzwerk zu erhalten
      return await provider.getGasPrice();
    } catch (error) {
      console.log("Couldn't get gas price from network, using default value");
      // Wenn das fehlschlägt, verwende einen Standardwert (z.B. 20 Gwei)
      return ethers.utils.parseUnits("20", "gwei");
    }
  };

  const IArb = await ethers.getContractFactory('ArbV2');
  arb = await IArb.attach(config.arbContract);

  console.log("Eth recover...");
  const gasPrice = await getGasPrice();
  const ethTx = await arb.connect(owner).recoverEth({
    gasPrice: gasPrice,
    gasLimit: 300000
  });
  await ethTx.wait();
  console.log("Eth recover complete");

  for (let i = 0; i < config.baseAssets.length; i++) {
    const asset = config.baseAssets[i];
    let balance = await arb.getBalance(asset.address);
    console.log(`${asset.sym} Start Balance: `, balance.toString());
    
    const tokenTx = await arb.connect(owner).recoverTokens(asset.address, {
      gasPrice: await getGasPrice(),
      gasLimit: 300000
    });
    await tokenTx.wait();
    
    balance = await arb.getBalance(asset.address);
    console.log(`${asset.sym} Close Balance: `, balance.toString());
    
    // Warte 2 Sekunden zwischen den Transaktionen
    await new Promise(r => setTimeout(r, 2000));
  }
}

process.on('uncaughtException', function(err) {
  console.log('UnCaught Exception 83: ' + err);
  console.error(err.stack);
  fs.appendFile('./critical.txt', err.stack, function(){ });
});

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: '+p+' - reason: '+reason);
});

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });