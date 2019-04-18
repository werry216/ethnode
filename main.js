const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const findCacheDir = require("find-cache-dir");
const { getKeypairs } = require("./crypto");

const KEYS_SOURCE = path.join(__dirname, "keys");
const HOMEDIR = findCacheDir({
  name: "ethnode",
  cwd: __dirname,
  create: true
});
const LOGLEVELS = [, "warn", "info", "debug"];

function randomId() {
  return 1e9 + Math.round(Math.random() * 1e9);
}

function getPaths(client, workdir) {
  const base = path.join(workdir, client);
  return {
    binary: path.join(HOMEDIR, client),
    base: base,
    genesis: path.join(base, "genesis.json"),
    data: path.join(base, "data"),
    keys: path.join(base, "keys"),
    password: path.join(__dirname, "keys", "password.secret")
  };
}

function generateGenesis(client, balances) {
  const genesis = JSON.parse(
    JSON.stringify(require(`./genesis.${client}.json`))
  );
  if (client === "geth") {
    genesis.config.chainId = randomId();
    genesis.extraData =
      "0x" +
      "0".repeat(64) +
      Object.keys(balances)[0].substr(2) +
      "0".repeat(130);
    genesis.alloc = { ...genesis.alloc, ...balances };
  } else if (client === "parity") {
    genesis.params.networkID = randomId();
    genesis.accounts = { ...genesis.accounts, ...balances };
  }
  return genesis;
}

function generateBalances(addresses, balance) {
  balance = balance || "100000000000000000000";
  const balances = {};
  for (var i = 0; i < addresses.length; i++) {
    balances[addresses[i]] = {
      balance: balance
    };
  }
  return balances;
}

function downloadClient(client, workdir) {
  const paths = getPaths(client, workdir);
  if (!fs.existsSync(paths.binary)) {
    console.log(`Download latest ${client} version, please wait.`);
    spawnSync(path.join(__dirname, `get_${client}.sh`), {
      env: { HOMEDIR },
      stdio: "inherit"
    });
  }
}

function provide(client, workdir, allocate) {
  const paths = getPaths(client, workdir);
  const keypairs = getKeypairs(KEYS_SOURCE, "password");
  const balances = generateBalances(
    keypairs.map(x => x.address).concat(allocate)
  );
  const genesis = generateGenesis(client, balances);
  let keysDest =
    client === "geth" ? paths.keys : path.join(paths.keys, genesis.name);

  try {
    fs.mkdirSync(paths.base, { recursive: true });
    fs.mkdirSync(keysDest, { recursive: true });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  console.log("Init new configuration in", workdir);

  fs.writeFileSync(paths.genesis, JSON.stringify(genesis, null, 2));

  fs.readdirSync(KEYS_SOURCE)
    .filter(filename => filename.startsWith("UTC--"))
    .map(filename =>
      fs.copyFileSync(
        path.join(KEYS_SOURCE, filename),
        path.join(keysDest, filename)
      )
    );

  if (client === "geth") {
    const childResult = spawnSync(
      paths.binary,
      ["--datadir", paths.data, "init", paths.genesis],
      {
        stdio: "inherit"
      }
    );
    if (childResult.status !== 0) {
      process.exit(childResult.status);
    }
  }
}

function run(client, { download, workdir, logging, allocate }) {
  const paths = getPaths(client, workdir);
  downloadClient(client, workdir);
  if (download) {
    return;
  }
  if (!fs.existsSync(paths.genesis)) {
    provide(client, workdir, allocate);
  }

  const genesis = JSON.parse(fs.readFileSync(paths.genesis));
  const keypairs = getKeypairs(
    client === "geth" ? paths.keys : path.join(paths.keys, genesis.name),
    "password"
  );

  console.log("Run development node using configuration in", workdir);
  console.log("Test accounts");
  console.log("#  Address                                    Private Key");
  for (let i = 0; i < keypairs.length; i++) {
    console.log(`${i}: ${keypairs[i].address} ${keypairs[i].privateKey}`);
  }
  if (allocate.length > 0) {
    console.log();
    console.log("Extra account allocations");
    console.log("Address                                    Private Key");
    for (let i = 0; i < allocate.length; i++) {
      console.log(`${allocate[i]} <no private key available>`);
    }
  }
  console.log();

  let args;
  if (client === "geth") {
    args = [
      "--datadir",
      paths.data,
      "--port",
      "30311",
      "--rpc",
      "--rpcaddr",
      "localhost",
      "--rpcport",
      "8545",
      "--rpcapi",
      "personal,db,eth,net,web3,txpool,miner,debug",
      "--rpccorsdomain",
      "*",
      "--ws",
      "--wsaddr",
      "localhost",
      "--wsport",
      "8546",
      "--wsapi",
      "personal,db,eth,net,web3,txpool,miner,debug",
      "--wsorigins",
      "*",
      "--mine",
      "--miner.gastarget",
      "94000000",
      "--miner.gasprice",
      "1000000000",
      "--keystore",
      paths.keys,
      "--unlock",
      keypairs.map(keypair => keypair.address).join(","),
      "--password",
      paths.password,
      "--networkid",
      genesis.config.chainId
    ];
    if (logging) {
      args.push("--verbosity");
      args.push(LOGLEVELS.indexOf(logging));
    }
  } else if (client === "parity") {
    args = [
      "--db-path",
      paths.data,
      "--chain",
      paths.genesis,
      "--keys-path",
      paths.keys,
      "--min-gas-price",
      "4000000000",
      "--jsonrpc-cors",
      "all",
      "--jsonrpc-apis",
      "all",
      "--ws-apis",
      "all",
      "--ws-origins",
      "all",
      "--fast-unlock",
      "--unlock",
      keypairs.map(keypair => keypair.address).join(","),
      "--password",
      paths.password,
      "--network-id",
      parseInt(genesis.params.networkID, 16)
    ];
    if (logging) {
      args.push("--logging");
      args.push(logging);
    }
  } else {
    throw `Client "${client}" is not supported`;
  }

  if (logging === "debug") {
    console.log("running:", paths.binary, args.join(" "));
  }
  spawnSync(paths.binary, args, { stdio: "inherit" });
}

module.exports = run;
