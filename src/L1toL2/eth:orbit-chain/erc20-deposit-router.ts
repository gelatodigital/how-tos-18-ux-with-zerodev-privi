import { BigNumber, Contract, Wallet, ethers } from "ethers";
import { Provider } from "@ethersproject/abstract-provider";
import { defaultAbiCoder } from "ethers/lib/utils";
import {
  Erc20Bridger,
  addCustomNetwork
} from "@arbitrum/sdk";

import dotenv from "dotenv";
import { l2Network } from "../../helpers/custom-network-reya";


dotenv.config();


/**
 * Set up: instantiate L1 / L2 wallets connected to providers
 */
const walletPrivateKey: string = process.env.DEVNET_PRIVKEY as string;
let l1Provider = new ethers.providers.JsonRpcProvider(process.env.L1RPC);
const l2Provider = new ethers.providers.JsonRpcProvider(process.env.L2RPC);
const l1Wallet = new Wallet(walletPrivateKey, l1Provider);

const main = async () => {
  console.log("L2 Network Reached");

  // register - needed for retryables
  addCustomNetwork({
    customL2Network: l2Network,
  });

  console.log("Custom Network Added");

  // Set up the Erc20Bridger
  const l1Erc20Address = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; 
  const tokenAmount = BigNumber.from(1000000);

  const erc20Bridger = new Erc20Bridger(l2Network);

  console.log("Erc20 Bridger Set Up");

  // We get the address of L1 Gateway for our DappToken

  // Validate that the token address is correctly set
  if (!l1Erc20Address) {
    throw new Error("Invalid ERC20 token address.");
  }

  console.log("L1 ERC20 Address Validated");

  // Define the ERC20 contract interface
  const ERC20_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ];

  //Get the ERC20 contract instance
  const erc20Contract = new ethers.Contract(
    l1Erc20Address,
    ERC20_ABI,
    l1Wallet
  );

  // Get the expected L1 Gateway address
  const expectedL1GatewayAddress = await erc20Bridger.getL1GatewayAddress(
    l1Erc20Address,
    l1Provider as Provider
  );

  console.log(
    "Expected L1 Gateway Address Retrieved: ",
    expectedL1GatewayAddress
  );

  // Check if the expectedL1GatewayAddress is valid
  if (!expectedL1GatewayAddress || expectedL1GatewayAddress === "") {
    throw new Error("Failed to get L1 Gateway address.");
  }

  // Get the initial token balance of the Bridge
  const initialBridgeTokenBalance = await erc20Contract.balanceOf(
    expectedL1GatewayAddress
  );

  // Log the initial balance
  console.log(
    `Initial Bridge Token Balance: ${initialBridgeTokenBalance.toString()}`
  );

  const walletAddress = await l1Wallet.address;

  //  Approve the token transfer
  console.log("Approving:");
  const approveTx = await erc20Bridger.approveToken({
    l1Signer: l1Wallet,
    erc20L1Address: l1Erc20Address,
  });
  const approveRec = await approveTx.wait();
  


  console.log(
    `You successfully allowed the Arbitrum Bridge to spend USDC ${approveRec.transactionHash}`
  );

  const depositRequest = (await erc20Bridger.getDepositRequest({
    amount: tokenAmount,
    erc20L1Address: l1Erc20Address,
    l1Provider: l1Provider,
    from: l1Wallet.address,
    l2Provider: l2Provider,
  })) as any;

  let retryableData = depositRequest.retryableData;
  let l2Gaslimit = retryableData.gasLimit;
  let maxFeePerGas = retryableData.maxFeePerGas;
  let maxSubmissionCost = retryableData.maxSubmissionCost;
  let deposit = depositRequest.retryableData.deposit;

  let data1 = defaultAbiCoder.encode(
    ["uint256", "bytes"],
    [+maxSubmissionCost.toString(), "0x"]
  );

  let routerABI = [
    "function outboundTransferCustomRefund( address _l1Token,address _refundTo,   address _to,   uint256 _amount,    uint256 _maxGas, uint256 _gasPriceBid, bytes calldata _data) external payable returns (bytes memory)",
  ];
  const routerContract = new Contract(
    "0xf446986e261E84aB2A55159F3Fba60F7E8AeDdAF",
    routerABI,
    l1Wallet
  );

  //Deposit the token to L2
  console.log("Transferring DappToken to L2:");

  const { data } =
    await routerContract.populateTransaction.outboundTransferCustomRefund(
      l1Erc20Address,
      walletAddress,
      walletAddress,
      tokenAmount,
      l2Gaslimit,
      maxFeePerGas,
      data1
    );

  const depositTx = await l1Wallet.sendTransaction({
    to: routerContract.address,
    data,
    value:deposit
  });

  let rec = await depositTx.wait();
  console.log(rec);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
