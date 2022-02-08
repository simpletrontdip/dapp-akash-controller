// @ts-check
/* eslint-env node */
// Agoric Dapp api deployment script

import { E } from '@agoric/eventual-send';
import { AmountMath } from '@agoric/ertp';

import '@agoric/zoe/exported.js';

import installationConstants from '../conf/installationConstants.mjs';

const akt = harden({
  peg: {
    name: 'peg-channel-0-uphoton',
  },
  dest: {
    address: 'cosmos1p26rc0ytxvc9lhxv825ekxw43vc3ucqp4cektr',
  },
  wallet: {
    pursePetName: 'PhotonPurse',
  },
  payment: {
    value: 20_000n,
  },
});

// deploy.js runs in an ephemeral Node.js outside of swingset. The
// spawner runs within ag-solo, so is persistent.  Once the deploy.js
// script ends, connections to any of its objects are severed.

/**
 * @typedef {Object} DeployPowers The special powers that `agoric deploy` gives us
 * @property {(path: string) => { moduleFormat: string, source: string }} bundleSource
 * @property {(path: string, opts?: any) => Promise<any>} installUnsafePlugin
 * @property {(path: string, format?: any) => string} pathResolve
 */

/**
 * @param {any} homePromise A promise for the references
 * available from REPL home
 * @param {DeployPowers} powers
 */
export default async function deployApi(homePromise, { installUnsafePlugin }) {
  // Let's wait for the promise to resolve.
  const home = await homePromise;

  // Unpack the references.
  const { zoe, wallet, board, chainTimerService, scratch, agoricNames } = home;

  console.log('Finding the akt fund purse');
  const purseP = E(E(wallet).getAdminFacet()).getPurse(akt.wallet.pursePetName);

  console.log('Finding the aktPeg, pegasus instance...');
  const [aktPeg, aktBrand, instance] = await Promise.all([
    E(scratch).get(akt.peg.name),
    E(purseP).getAllegedBrand(),
    E(agoricNames).lookup('instance', 'Pegasus'),
  ]);

  assert(aktPeg, 'You may need to peg the `uakt` first');
  assert(aktBrand, `No purse ${akt.wallet.pursePetName} found`);
  const pegasus = await E(home.zoe).getPublicFacet(instance);
  const aktIssuer = await E(pegasus).getLocalIssuer(aktBrand);

  const akashClient = await installUnsafePlugin('./src/akash.js', {
    mnemonic: process.env.AKASH_MNEMNONIC,
    deploymentId: process.env.AKASH_WATCHED_DSEQ,
  }).catch((e) => console.error(`${e}`));

  const { INSTALLATION_BOARD_ID } = installationConstants;
  const installation = await E(board).getValue(INSTALLATION_BOARD_ID);

  const issuerKeywordRecord = harden({
    Fund: aktIssuer,
  });
  const terms = harden({
    akashClient,
    timeAuthority: chainTimerService,
    checkInterval: 15n,
    deploymentId: '1232',
    cosmosAddr: akt.dest.address,
    pegasus,
    aktPeg,
  });

  // start the contract
  const { creatorInvitation } = await E(zoe).startInstance(
    installation,
    issuerKeywordRecord,
    terms,
  );

  assert(creatorInvitation, 'Creator invitation must not be null');
  console.log('Controller instance started');

  // setup the Fund for this contract
  const amount = harden(AmountMath.make(aktBrand, akt.payment.value));
  const payment = await E(purseP).withdraw(amount);
  const proposal = harden({
    give: {
      Fund: amount,
    },
  });
  const paymentRecords = harden({
    Fund: payment,
  });

  console.log('Sending offer...');
  const seatP = E(zoe).offer(creatorInvitation, proposal, paymentRecords);

  console.log('Waiting for result...');
  await E(seatP).getOfferResult();

  console.log('Waiting for payout');
  const payout = await E(seatP).getPayout('Fund');

  const remain = await E(aktIssuer).getAmountOf(payout);
  console.log('Payout here', remain);

  await E(purseP).deposit(payout);
  console.log('Deposit back');
}
