import { Wallet, Provider, Contract, utils } from "zksync-ethers";
import { expect } from "chai";
import * as ethers from "ethers";

import { toBN, Tx, getBalances } from "./utils/helper";
import { deployAAFactory, deployAccount } from "./utils/deploy";
import { sendTx } from "./utils/sendtx";
import { rich_wallet } from "./utils/rich-wallets";
import { getProvider } from "../deploy/utils";

const dev_pk = rich_wallet[0].privateKey;
const ETH_ADDRESS = "0x000000000000000000000000000000000000800A";
const SLEEP_TIME = 10; // 10 sec

let provider: Provider;
let wallet: Wallet;
let user: Wallet;

let factory: Contract;
let factoryAddress: string;
let account: Contract;
let accountAddress: string;

before(async () => {
  provider = getProvider();
  wallet = new Wallet(dev_pk, provider);
  const randomWallet = Wallet.createRandom();
  user = new Wallet(randomWallet.privateKey, provider);

  factory = await deployAAFactory(wallet);
  factoryAddress = await factory.getAddress();
  account = await deployAccount(wallet, user, factoryAddress);
  accountAddress = await account.getAddress();
  // 100 ETH transfered to Account
  await (
    await wallet.sendTransaction({
      to: accountAddress,
      value: toBN("100"),
    })
  ).wait();

  // Modify ONE_DAY from 24horus to 10 seconds for the sake of testing.
  await (await account.changeONE_DAY(SLEEP_TIME)).wait();
});

describe("Deployment, Setup & Transfer", function () {
  it.only("Should deploy contracts, send ETH, and set varible correctly", async function () {
    expect((await provider.getBalance(accountAddress)) === toBN("100"));
    expect((await account.ONE_DAY()).toString()).to.equal(
      SLEEP_TIME.toString()
    );

    expect(await account.owner()).to.equal(user.address);

    // await consoleAddreses(wallet, factory, account, user)
  });

  it.only("Set Limit: Should add ETH spendinglimit correctly", async function () {
    const block = await provider.getBlock("latest");

    let tx = await account.setSpendingLimit.populateTransaction(
      ETH_ADDRESS,
      toBN("10"),
      { value: toBN("0") }
    );

    const txReceipt = await sendTx(provider, account, user, tx);
    await txReceipt.wait();

    const limit = await account.limits(ETH_ADDRESS);
    expect(limit.limit).to.eq(toBN("10"));
    expect(limit.available).to.eq(toBN("10"));
    expect(Number(limit.resetTime)).to.closeTo(block.timestamp, 5);
    expect(limit.isEnabled).to.eq(true);

    // await consoleLimit(limit)
  });

  it.only("Transfer ETH 1: Should transfer correctly", async function () {
    const block = await provider.getBlock("latest");
    const balances = await getBalances(provider, wallet, account, user);
    const tx = Tx(user, "5");

    //await utils.sleep(SLEEP_TIME * 1000);
    const txReceipt = await sendTx(provider, account, user, tx);
    await txReceipt.wait();

    expect(Number(await provider.getBalance(accountAddress))).to.be.closeTo(
      Number(balances.AccountETHBal - toBN("5")),
      Number(toBN("0.01"))
    );
    expect(await provider.getBalance(await user.getAddress())).to.eq(
      balances.UserETHBal + toBN("5")
    );

    const limit = await account.limits(ETH_ADDRESS);
    // await consoleLimit(limit)

    expect(limit.limit).to.eq(toBN("10"));
    expect(limit.available).to.eq(toBN("5"));
    expect(Number(limit.resetTime)).to.gt(block.timestamp);
    expect(limit.isEnabled).to.eq(true);

    // await getBalances(provider, wallet, account, user)
  });

  // it.only("Transfer ETH 2: Should revert due to spending limit", async function () {
  //   const block = await provider.getBlock("latest");
  //   const balances = await getBalances(provider, wallet, account, user);

  //   const tx = Tx(user, "6") as any;
  //   tx.gasLimit = 800000;
  //   const txReceipt = await sendTx(provider, account, user, tx);
  //   await expect(txReceipt.wait()).to.be.revertedWith("Exceeds daily limit");

  //   expect(
  //     ethers.formatUnits(
  //       (
  //         ((await provider.getBalance(accountAddress)) * toBN("1")) /
  //         balances.AccountETHBal
  //       ).toString()
  //     )
  //   ).to.be.approximately(1, 0.01);
  //   expect(await provider.getBalance(user.address)).to.eq(balances.UserETHBal);

  //   const limit = await account.limits(ETH_ADDRESS);
  //   // await consoleLimit(limit)

  //   expect(limit.limit).to.eq(toBN("10"));
  //   expect(limit.available).to.eq(toBN("5"));
  //   expect(Number(limit.resetTime)).to.gt(block.timestamp);
  //   expect(limit.isEnabled).to.eq(true);

  //   // await getBalances(provider, wallet, account, user)
  // });

  it("Transfer ETH 3: Should revert first but succeed after the daily limit resets", async function () {
    const balances = await getBalances(provider, wallet, account, user);

    const tx = Tx(user, "6");
    const resetTime = (await account.limits(ETH_ADDRESS)).resetTime.toNumber();

    if (Math.floor(Date.now() / 1000) < resetTime) {
      // before 10 seconds has passed
      const txReceipt = await sendTx(provider, account, user, tx);
      await expect(txReceipt.wait()).to.be.revertedWithoutReason;
    }

    await utils.sleep(SLEEP_TIME * 1000);

    if (Math.floor(Date.now() / 1000) > resetTime) {
      // after 10 seconds has passed
      const txReceipt = await sendTx(provider, account, user, tx);
      await txReceipt.wait();
    }

    expect(await provider.getBalance(accountAddress)).to.be.closeTo(
      balances.AccountETHBal - toBN("6"),
      toBN("0.01")
    );
    expect(await provider.getBalance(user.address)).to.eq(
      balances.UserETHBal + toBN("6")
    );

    const limit = await account.limits(ETH_ADDRESS);
    // await consoleLimit(limit)

    expect(limit.limit).to.eq(toBN("10"));
    expect(limit.available).to.eq(toBN("4"));
    expect(Number(limit.resetTime)).to.gt(resetTime);
    expect(limit.isEnabled).to.eq(true);

    // await getBalances(provider, wallet, account, user)
  });
});

describe("Spending Limit Updates to make a transfer", function () {
  beforeEach(async function () {
    await utils.sleep(SLEEP_TIME * 1000);

    let tx = await account.setSpendingLimit.populateTransaction(
      ETH_ADDRESS,
      toBN("10"),
      { value: toBN("0") }
    );

    const txReceipt = await sendTx(provider, account, user, tx);
    await txReceipt.wait();
  });

  it("Should succeed after overwriting SpendLimit", async function () {
    const balances = await getBalances(provider, wallet, account, user);

    const tx1 = Tx(user, "15");
    const txReceipt1 = await sendTx(provider, account, user, tx1);
    await expect(txReceipt1.wait()).to.be.revertedWithoutReason;

    await utils.sleep(SLEEP_TIME * 1000);

    // Increase Limit
    const tx2 = await account.setSpendingLimit.populateTransaction(
      ETH_ADDRESS,
      toBN("20"),
      { value: toBN("0") }
    );

    const txReceipt2 = await sendTx(provider, account, user, tx2);
    await txReceipt2.wait();

    const txReceipt3 = await sendTx(provider, account, user, tx1);
    await txReceipt3.wait();

    expect(await provider.getBalance(accountAddress)).to.be.closeTo(
      balances.AccountETHBal - toBN("15"),
      toBN("0.01")
    );
    expect(await provider.getBalance(user.address)).to.eq(
      balances.UserETHBal + toBN("15")
    );

    const limit = await account.limits(ETH_ADDRESS);
    // await consoleLimit(limit)

    expect(limit.limit).to.eq(toBN("20"));
    expect(limit.available).to.eq(toBN("5"));
    expect(limit.resetTime.toNumber()).to.gt(Math.floor(Date.now() / 1000));
    expect(limit.isEnabled).to.eq(true);

    // await getBalances(provider, wallet, account, user)
  });

  it("Should succeed after removing SpendLimit", async function () {
    const balances = await getBalances(provider, wallet, account, user);

    const tx1 = Tx(user, "30");
    const txReceipt1 = await sendTx(provider, account, user, tx1);
    await expect(txReceipt1.wait()).to.be.revertedWithoutReason;

    await utils.sleep(SLEEP_TIME * 1000);

    // Remove Limit
    const tx2 = await account.removeSpendingLimit.populateTransaction(
      ETH_ADDRESS,
      { value: toBN("0") }
    );

    const txReceipt2 = await sendTx(provider, account, user, tx2);
    await txReceipt2.wait();

    const txReceipt3 = await sendTx(provider, account, user, tx1);
    await txReceipt3.wait();

    expect(await provider.getBalance(accountAddress)).to.be.closeTo(
      balances.AccountETHBal - toBN("30"),
      toBN("0.01")
    );
    expect(await provider.getBalance(user.address)).to.eq(
      balances.UserETHBal - toBN("30")
    );

    const limit = await account.limits(ETH_ADDRESS);
    // await consoleLimit(limit)

    expect(limit.limit).to.eq(toBN("0"));
    expect(limit.available).to.eq(toBN("0"));
    expect(limit.resetTime.toNumber()).to.eq(0);
    expect(limit.isEnabled).to.eq(false);

    // await getBalances(provider, wallet, account, user)
  });
});

// describe("Spending Limit Updates", function () {
//   before(async function () {
//     //await utils.sleep(SLEEP_TIME * 1000);

//     let tx = await account.setSpendingLimit.populateTransaction(
//       ETH_ADDRESS,
//       toBN("10"),
//       { value: toBN("0"), gasLimit: 600000 }
//     );

//     const txReceipt = await sendTx(provider, account, user, tx);
//     await txReceipt.wait();

//     const tx2 = Tx(user, "5");
//     const txReceipt2 = await sendTx(provider, account, user, tx2);
//     await txReceipt2.wait();
//   });

//   it("Should revert. Invalid update for setSpendingLimit", async function () {
//     const tx = await account.setSpendingLimit.populateTransaction(
//       ETH_ADDRESS,
//       toBN("100"),
//       { value: toBN("0"), gasLimit: 600000 }
//     );

//     const txReceipt = await sendTx(provider, account, user, tx);
//     await expect(txReceipt.wait()).to.be.revertedWithoutReason;

//     const limit = await account.limits(ETH_ADDRESS);
//     // await consoleLimit(limit)

//     expect(limit.limit).to.eq(toBN("10"));
//     expect(limit.available).to.eq(toBN("5"));
//     expect(limit.resetTime.toNumber()).to.gt(Math.floor(Date.now() / 1000));
//     expect(limit.isEnabled).to.eq(true);
//   });

//   it("Should revert. Invalid update for removeSpendingLimit", async function () {
//     const tx2 = await account.removeSpendingLimit.populateTransaction(
//       ETH_ADDRESS,
//       { value: toBN("0"), gasLimit: 600000 }
//     );

//     const txReceipt = await sendTx(provider, account, user, tx2);
//     await expect(txReceipt.wait()).to.be.revertedWithoutReason;

//     const limit = await account.limits(ETH_ADDRESS);
//     // await consoleLimit(limit)

//     expect(limit.limit).to.eq(toBN("10"));
//     expect(limit.available).to.eq(toBN("5"));
//     expect(limit.resetTime.toNumber()).to.gt(Math.floor(Date.now() / 1000));
//     expect(limit.isEnabled).to.eq(true);
//   });
// });
