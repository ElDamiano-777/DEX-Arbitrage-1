const hre = require('hardhat');
const ethers = hre.ethers;
const fs = require('fs');
require('dotenv').config();

let config, arb, owner, inTrade, balances;
const network = hre.network.name;

if (network === 'aurora') config = require('./../config/aurora.json');
if (network === 'fantom') config = require('./../config/fantom.json');

console.log('DEX Arbitrage Bot started...\n');
console.log(`${config.routes.length} Routes loaded`);

const manualGasLimit = ethers.utils.parseUnits('816674451', 'wei'); // Anpassen Sie diesen Wert bei Bedarf
console.log('manualGasLimit: ' + manualGasLimit.toString() + ' wei\n');

const main = async () => {
  await setup();
  await lookForDualTrade();
};

const searchForRoutes = () => {
  const targetRoute = {};

  calc_router1 = Math.floor(Math.random() * config.routers.length);
  calc_router2 = Math.floor(Math.random() * config.routers.length);
  calc_token1 = Math.floor(Math.random() * config.baseAssets.length);
  calc_token2 = Math.floor(Math.random() * config.tokens.length);

  targetRoute.router1 = config.routers[calc_router1].address;
  targetRoute.router2 = config.routers[calc_router2].address;
  targetRoute.token1 = config.baseAssets[calc_token1].address;
  targetRoute.token2 = config.tokens[calc_token2].address;

  if (targetRoute.router1 == targetRoute.router2) return {};
  if (targetRoute.token1 == targetRoute.token2) return {};

  console.log(
    '----------------------------------------------------------------------'
  );
  console.log('NEW ROUTE\n');

  console.log(
    '\tSwap:\t\t' +
      config.baseAssets[calc_token1].sym +
      ' -> ' +
      config.tokens[calc_token2].sym
  );
  console.log(
    '\tContract:\t' +
      config.baseAssets[calc_token1].address +
      ' -> ' +
      config.tokens[calc_token2].address
  );

  console.log(
    '\n\tRoute:\t\t' +
      config.routers[calc_router1].dex +
      ' -> ' +
      config.routers[calc_router2].dex
  );
  console.log(
    '\tContract:\t' +
      config.routers[calc_router1].address +
      ' -> ' +
      config.routers[calc_router2].address
  );
  console.log('\n');
  return targetRoute;
};

let goodCount = 0;
const useGoodRoutes = () => {
  const route = config.routes[goodCount];
  goodCount = (goodCount + 1) % config.routes.length;
  return {
    router1: route[0],
    router2: route[1],
    token1: route[2],
    token2: route[3],
  };
};

const checkNetworkStatus = async () => {
  try {
    //console.log('Attempting to get network information...');
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
    const network = await provider.getNetwork();
    //console.log('Network:', network);
    const blockNumber = await provider.getBlockNumber();
    console.log('Current block number:', blockNumber);
    return true;
  } catch (error) {
    console.error('Network problem:', error);
    return false;
  }
};

/*const checkAndApproveAllowance = async (
  tokenAddress,
  spenderAddress,
  amount
) => {
  const tokenContract = await ethers.getContractAt(
    'IERC20',
    tokenAddress,
    owner
  );
  const ownerAddress = await owner.getAddress();

  console.log(`Checking allowance for ${tokenAddress}`);
  const allowance = await tokenContract.allowance(ownerAddress, spenderAddress);
  console.log('Current allowance:', allowance.toString());

  if (allowance.lt(amount)) {
    console.log(`Granting approval for ${tokenAddress} to ${spenderAddress}`);
    const approveTx = await tokenContract.approve(
      spenderAddress,
      ethers.constants.MaxUint256
    );
    const txResult = await approveTx.wait();
    console.log('Approval granted.');

    const newAllowance = await tokenContract.allowance(
      ownerAddress,
      spenderAddress
    );
    console.log('New allowance:', newAllowance.toString());
    if (newAllowance.lt(amount)) {
      throw new Error(
        'Approval transaction failed to increase allowance sufficiently.'
      );
    }
  } else {
    console.log('Sufficient allowance already granted.');
  }
};
*/

const checkSufficientBalance = async (tokenAddress, amount) => {
  const tokenContract = await ethers.getContractAt(
    'IERC20',
    tokenAddress,
    owner
  );
  const balance = await tokenContract.balanceOf(arb.address);
  return balance.gte(amount);
};

const lookForDualTrade = async () => {
  while (true) {
    try {
      const targetRoute =
        config.routes.length > 0 ? useGoodRoutes() : searchForRoutes();

      const tradeSize = balances[targetRoute.token1].balance;

      //console.log("Contract balance token1: " + tradeSize.toString() + " " + balances[targetRoute.token1].sym);
      if (tradeSize.lte(ethers.constants.Zero)) {
        console.log('Contract out of funds! EXITING...');
        break;
      }

      //console.log('Contract:', arb.address);

      const networkStatus = await checkNetworkStatus();
      if (!networkStatus) {
        console.log('Network check failed, retrying...');
        continue;
      }

      //const balance = await ethers.provider.getBalance(owner.address);
      //console.log('Owner balance token1: ' + ethers.utils.formatEther(balance) + " " + balances[targetRoute.token1].sym);

      /* BRAUCHEN WIR DAS???? Wir haben schon die contract balance von token 1
      const token1Contract = await ethers.getContractAt(
        'IERC20',
        targetRoute.token1,
        owner
      );
      
      const token1Balance = await token1Contract.balanceOf(arb.address);
      console.log('Contract balance token1: ' + token1Balance.toString() + " " + balances[targetRoute.token1].sym);
      

      // Überprüfe ausreichendes Guthaben
      if (!(await checkSufficientBalance(targetRoute.token1, tradeSize))) {
        console.log('Unzureichendes Guthaben für den Handel');
        continue;
      } else {
        console.log('Guthaben vorhanden');
      }
      

      console.log(
        'Parameters:',
        targetRoute.router1,
        targetRoute.router2,
        targetRoute.token1,
        targetRoute.token2,
        tradeSize.toString()
      );
      */

      console.log('Calling estimateDualDexTrade() on contract');

      const actualGasLimit = await getPrice();
      try {
        const profit = await arb.callStatic.estimateDualDexTrade(
          targetRoute.router1,
          targetRoute.router2,
          targetRoute.token1,
          targetRoute.token2,
          tradeSize
          //{ gasLimit: actualGasLimit.recommendedPrice }
        );
        logRoute(targetRoute);
      } catch (e) {     
        
        if(e.reason == 'cannot estimate gas; transaction may fail or may require manual gas limit') {          
          //IM CONTRACT SCHLÄGT FEHEL: uint256[] memory amountOutMins = IUniswapV2Router(router).getAmountsOut(_amount, path);
          console.log('getAmountsOut() in internal contract call failed: Pair not found!');
          continue;
        }

        console.log(JSON.stringify(e));
        continue;
      }

      console.log(
        'Arb found with calculated Profit: ' +
          profit.toString() +
          ' ' +
          balances[targetRoute.token1].sym
      );

      if (profit.gt(0)) {
        console.log('Trade execution...');
        // Überprüfe und erteile Genehmigungen
        /*await checkAndApproveAllowance(
          targetRoute.token1,
          targetRoute.router1,
          tradeSize
        );
        await checkAndApproveAllowance(
          targetRoute.token2,
          targetRoute.router2,
          ethers.constants.MaxUint256
        );*/
        await dualTrade(
          targetRoute.router1,
          targetRoute.router2,
          targetRoute.token1,
          targetRoute.token2,
          ethers.BigNumber.from(tradeSize)
        );
      }
    } catch (error) {
      //console.error("Route nicht bekannt oder Liqidität nicht vorhanden!");
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
};

const dualTrade = async (router1, router2, baseToken, token2, amount) => {
  if (inTrade) {
    console.log('Bereits im Handel, überspringe...');
    return false;
  }

  try {
    inTrade = true;
    console.log('> Führe dualTrade aus...');

    const actualGasLimit = await getPrice();
    const tx = await arb
      .connect(owner)
      .dualDexTrade(router1, router2, baseToken, token2, amount, {
        gasLimit: actualGasLimit.recommendedPrice,
      });
    console.log('Transaktion gesendet. Warte auf Bestätigung...');
    const receipt = await tx.wait();
    console.log(
      'Transaktion bestätigt. Gas verwendet:',
      receipt.gasUsed.toString()
    );
  } catch (e) {
    console.error('Fehler bei dualTrade:', e);
  } finally {
    inTrade = false;
  }
};

const getPrice = async () => {
  const gasPrice = await ethers.provider.getGasPrice();
  //{gasPrice: 1000000000001}
  //console.log(`Gas Price: ${gasPrice.toString()}`);
  const recommendedPrice = gasPrice.mul(10).div(9);
  //console.log(`Recommended Price: ${recommendedPrice.toString()}`);
  return { gasPrice, recommendedPrice };
};

const logRoute = (targetRoute) => {
  if (config.routes.length === 0) {
    fs.appendFile(
      `./data/${network}RouteLog.txt`,
      `["${targetRoute.router1}","${targetRoute.router2}","${targetRoute.token1}","${targetRoute.token2}"],\n`,
      () => {}
    );
  }
};

const setup = async () => {
  [owner] = await ethers.getSigners();

  console.log(`Owner: ${owner.address}`);
  const ownerBalance = await ethers.provider.getBalance(owner.address);
  console.log(`Owner Balance: ${ethers.utils.formatEther(ownerBalance)} FTM\n`);

  const IArb = await ethers.getContractFactory('ArbV2');
  arb = await IArb.attach(config.arbContract);

  balances = {};

  console.log('Contract: ' + arb.address + '');
  console.log('Contract Balances:');
  for (const asset of config.baseAssets) {
    const assetToken = await ethers
      .getContractFactory('WETH9')
      .then((f) => f.attach(asset.address));

    const balance = await assetToken.balanceOf(config.arbContract);
    console.log(`${asset.sym} ${balance.toString()}`);

    balances[asset.address] = {
      sym: asset.sym,
      balance,
      startBalance: balance,
    };
  }
  console.log('');

  setTimeout(() => {
    setInterval(logResults, 600000);
    logResults();
  }, 120000);
};

const logResults = async () => {
  console.log(`############# LOGS #############`);
  for (const asset of config.baseAssets) {
    const assetToken = await ethers
      .getContractFactory('WETH9')
      .then((f) => f.attach(asset.address));
    balances[asset.address].balance = await assetToken.balanceOf(
      config.arbContract
    );
    const diff = balances[asset.address].balance.sub(
      balances[asset.address].startBalance
    );
    const basisPoints = diff
      .mul(10000)
      .div(balances[asset.address].startBalance);
    console.log(`# ${asset.sym}: ${basisPoints.toString()}bps`);
  }
};

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
