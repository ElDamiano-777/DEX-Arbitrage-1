const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

const cacheFolder = path.join(__dirname, '..', 'cache');
const artifactsFolder = path.join(__dirname, '..', 'artifacts');


async function main() {
    // Delete cache and artifacts
    deleteFolder(cacheFolder);
    deleteFolder(artifactsFolder);
    console.log("Deleted cache and artifacts");

    [owner] = await ethers.getSigners();
   console.log(`Owner: ${owner.address}`);
  const contractName = 'ArbV2';
  await hre.run("compile");
  const smartContract = await hre.ethers.getContractFactory(contractName);
  const contract = await smartContract.deploy();
  await contract.deployed();
  console.log(`${contractName} deployed to: ${contract.address}`); 
  console.log('Put the above contract address into the .env file under arbContract');
}

function deleteFolder(folderPath) {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const curPath = path.join(folderPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        // Rekursiv Unterordner löschen
        deleteFolder(curPath);
      } else {
        // Datei löschen
        fs.unlinkSync(curPath);
      }
    });
    // Leeren Ordner löschen
    fs.rmdirSync(folderPath);
    //console.log(`Deleted folder: ${folderPath}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
