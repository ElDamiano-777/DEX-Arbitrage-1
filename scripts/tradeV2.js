const hre = require("hardhat");
const fs = require("fs");
require("dotenv").config();

let config, arb, owner, inTrade, balances;
const network = hre.network.name;

if (network === 'aurora') config = require('./../config/aurora.json');
if (network === 'fantom') config = require('./../config/fantom.json');

console.log(`${config.routes.length} Routen geladen`);

const main = async () => {
  await setup();
  await lookForDualTrade();
}

const searchForRoutes = () => {
  console.log("Suche neue Routen...");
  const targetRoute = {
    router1: config.routers[Math.floor(Math.random() * config.routers.length)].address,
    router2: config.routers[Math.floor(Math.random() * config.routers.length)].address,
    token1: config.baseAssets[Math.floor(Math.random() * config.baseAssets.length)].address,
    token2: config.tokens[Math.floor(Math.random() * config.tokens.length)].address
  };
  console.log(targetRoute);
  return targetRoute;
}

let goodCount = 0;
const useGoodRoutes = () => {
  const route = config.routes[goodCount];
  goodCount = (goodCount + 1) % config.routes.length;
  return {
    router1: route[0],
    router2: route[1],
    token1: route[2],
    token2: route[3]
  };
}

const checkNetworkStatus = async () => {
  try {
    console.log("Attempting to get network information...");
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
    const network = await provider.getNetwork();
    console.log("Network:", network);
    const blockNumber = await provider.getBlockNumber();
    console.log("Current block number:", blockNumber);
    return true;
  } catch (error) {
    console.error("Network problem:", error);
    return false;
  }
}

const lookForDualTrade = async () => {
  while (true) {
    try {
      const targetRoute = config.routes.length > 0 ? useGoodRoutes() : searchForRoutes();
      const tradeSize = balances[targetRoute.token1].balance;

      if (tradeSize.lte(ethers.constants.Zero)) {
        console.log("Handelsgröße zu klein, überspringe...");
        continue;
      }

      const slippage = 50; // 0.5%
      const amountOutMin = tradeSize.mul(10000 - slippage).div(10000);

      console.log("Prüfe Parameter vor Gasschätzung:", targetRoute, tradeSize.toString(), amountOutMin.toString());
      console.log("Arb-Kontrakt-Adresse:", arb.address);

      const networkStatus = await checkNetworkStatus();
      if (!networkStatus) {
        console.log("Network check failed, retrying...");
        continue;
      }

      const balance = await ethers.provider.getBalance(owner.address);
      console.log("Aktueller Kontosaldo:", ethers.utils.formatEther(balance));

      const token1Contract = await ethers.getContractAt("IERC20", targetRoute.token1);
      const token1Balance = await token1Contract.balanceOf(arb.address);
      console.log("Token1 Guthaben des Arb-Kontrakts:", token1Balance.toString());

      let gasEstimate;
      try {
        gasEstimate = await arb.estimateGas.estimateDualDexTrade(
          targetRoute.router1, targetRoute.router2, targetRoute.token1, targetRoute.token2, tradeSize
        );
      } catch (error) {
        console.error("Fehler bei der Gasschätzung:", error);
        gasEstimate = ethers.BigNumber.from("500000"); // Manueller Gaswert
      }

      const amtBack = await arb.callStatic.estimateDualDexTrade(
        targetRoute.router1, targetRoute.router2, targetRoute.token1, targetRoute.token2, tradeSize
      );

      const profitTarget = tradeSize.mul(ethers.BigNumber.from(config.minBasisPointsPerTrade + 10000)).div(10000);

      if (config.routes.length === 0) {
        fs.appendFile(`./data/${network}RouteLog.txt`, `["${targetRoute.router1}","${targetRoute.router2}","${targetRoute.token1}","${targetRoute.token2}"],\n`, () => {});
      }

      if (amtBack.gt(profitTarget)) {
        console.log("Trade wird ausgeführt...");
        await dualTrade(targetRoute.router1, targetRoute.router2, targetRoute.token1, targetRoute.token2, tradeSize, amountOutMin);
      }
    } catch (error) {
      console.error("Fehler in lookForDualTrade:", error);
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

const dualTrade = async (router1, router2, baseToken, token2, amount, amountOutMin) => {
  if (inTrade) {
    console.log("Bereits im Handel, überspringe...");
    return false;
  }

  try {
    inTrade = true;
    console.log('> Führe dualTrade aus...');
    const gasEstimate = await arb.estimateGas.dualDexTrade(router1, router2, baseToken, token2, amount, amountOutMin);
    const tx = await arb.connect(owner).dualDexTrade(router1, router2, baseToken, token2, amount, amountOutMin, {
      gasLimit: gasEstimate.mul(120).div(100)
    });
    console.log('Transaktion gesendet. Warte auf Bestätigung...');
    const receipt = await tx.wait();
    console.log('Transaktion bestätigt. Gas verwendet:', receipt.gasUsed.toString());
  } catch (e) {
    console.error("Fehler bei dualTrade:", e);
  } finally {
    inTrade = false;
  }
}

const setup = async () => {
  [owner] = await ethers.getSigners();
  console.log(`Besitzer: ${owner.address}`);
  const IArb = await ethers.getContractFactory('ArbV2');
  arb = await IArb.attach(config.arbContract);
  balances = {};

  for (const asset of config.baseAssets) {
    const assetToken = await ethers.getContractFactory('WETH9').then(f => f.attach(asset.address));
    const balance = await assetToken.balanceOf(config.arbContract);
    console.log(asset.sym, balance.toString());
    balances[asset.address] = { sym: asset.sym, balance, startBalance: balance };
  }

  const ownerBalance = await ethers.provider.getBalance(owner.address);
  console.log(`Kontostand des Besitzers: ${ethers.utils.formatEther(ownerBalance)} FTM`);

  setTimeout(() => {
    setInterval(logResults, 600000);
    logResults();
  }, 120000);
}

const logResults = async () => {
  console.log(`############# LOGS #############`);
  for (const asset of config.baseAssets) {
    const assetToken = await ethers.getContractFactory('WETH9').then(f => f.attach(asset.address));
    balances[asset.address].balance = await assetToken.balanceOf(config.arbContract);
    const diff = balances[asset.address].balance.sub(balances[asset.address].startBalance);
    const basisPoints = diff.mul(10000).div(balances[asset.address].startBalance);
    console.log(`# ${asset.sym}: ${basisPoints.toString()}bps`);
  }
}

process.on('uncaughtException', (err) => {
  console.error('Unbehandelte Ausnahme:', err);
  fs.appendFile('./critical.txt', err.stack, () => {});
});

process.on('unhandledRejection', (reason, p) => {
  console.error('Unbehandelte Ablehnung:', p, 'Grund:', reason);
});

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });