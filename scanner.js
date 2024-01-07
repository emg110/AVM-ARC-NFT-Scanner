const fs = require('fs');
const path = require('path');
const algosdk = require('algosdk');
const fetch = require('node-fetch');
const sha512_256 = require('js-sha512').sha512_256;
const msgpack = require('algo-msgpack-with-bigint');
const base32 = require('hi-base32');
const nacl = require('tweetnacl');

module.exports = class {
    constructor(props) {
        this.config = props.config
        this.mnemonic = props.mnemonic
        this.mnemonicRekey = props.mnemonicRekey
        this.mode = props.config.deployment.mode

        this.algodServer = props.config.scanner.network === 'testnet' ? props.config.scanner.algod_testnet_remote_server : props.config.scanner.algod_remote_server
        this.algodTestServer = props.config.scanner.algod_testnet_remote_server
        this.algodToken = props.config.scanner.algod_remote_token
        this.algodPort = props.config.scanner.algod_remote_port
        this.algodClient = new algosdk.Algodv2(this.algodToken, this.algodServer, this.algodPort)
        this.indexerServer = props.config.scanner.network === 'testnet' ? props.config.scanner.indexer_testnet_remote_server : props.config.scanner.indexer_remote_server
        this.indexerToken = props.config.scanner.indexer_remote_token
        this.indexerPort = props.config.scanner.indexer_remote_port
        this.indexerClient = new algosdk.Indexer(this.algodToken, this.indexerServer, this.indexerPort)
        this.approvalProgData = props.approvalProgData
        this.clearProgData = props.clearProgData

        this.accountObject = null
        this.accountBalance = null
        this.assetsHeld = null
        this.assetsCreated = null
        this.appsCreated = null
        this.assetsHeldBalance = null
        this.assetsCreatedBalance = null
        this.trxPayment = null
        this.trxTransfer = null
    }
    /**
     * Imports an account using the provided mnemonic and returns the account object.
     * @returns {Object} The imported account object.
     */
    importAccount() {
        const acc = algosdk.mnemonicToSecretKey(this.mnemonic);
        let addr = acc.addr
        const accRekey = null;
        console.info("Account Address = %s", addr);
        let acc_decoded = algosdk.decodeAddress(addr);
        console.info("Account Address Decoded Public Key = %s", acc_decoded.publicKey.toString());
        console.info("Account Address Decoded Checksum = %s", acc_decoded.checksum.toString());
        let acc_encoded = algosdk.encodeAddress(acc_decoded.publicKey);
        console.info("Account Address Encoded = %s", acc_encoded);
        console.warn(this.config.scanner['algo_dispenser'] + addr);
        return { acc, accRekey };
    };
    /**
     * Retrieves a method from a contract by its name.
     * @param {string} name - The name of the method.
     * @param {object} contract - The contract object.
     * @returns {object} - The method object.
     * @throws {Error} - If the method is undefined.
     */
    getMethodByName(name, contract) {
        const m = contract.methods.find((mt) => { return mt.name == name })
        if (m === undefined)
            throw Error("Method undefined: " + name)
        return m
    }

    /**
     * Fetches the wallet information for the Algorand blockchain.
     * @returns {Promise<void>} A promise that resolves when the wallet information is fetched.
     */
    async fetchAlgoWalletInfo() {
        if (algosdk.isValidAddress(this.accountObject.addr)) {
            const url = `${this.config.scanner.network === 'testnet' ? this.config.scanner['algod_testnet_remote_server'] : this.config.scanner['algod_remote_server']}/v2/accounts/${this.accountObject.addr}`;
            const urlTrx = `${this.config.scanner.network === 'testnet' ? this.config.scanner['indexer_testnet_remote_server'] : this.config.scanner['indexer_remote_server']}/v2/accounts/${this.accountObject.addr}/transactions?limit=10`;
            let res = await fetch(url, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            })
            let data = await res.json()
            if (data) {
                if (data.account) {
                    if (String(data.account.address) === String(this.accountObject.addr)) {
                        this.accountBalance = data.account.amount
                        this.assetsHeld = data.account.assets
                        this.assetsCreated = data.account["created-assets"]
                        this.appsCreated = data.account["created-apps"]
                        this.assetsHeldBalance = !!this.assetsHeld ? this.assetsHeld.length : 0
                        this.assetsCreatedBalance = !!this.assetsCreated ? this.assetsCreated.length : 0
                        if (this.appsCreated) this.appsCreatedBalance = this.appsCreated.length

                        console.info('------------------------------')
                        console.info("Account Balance = %s", this.accountBalance);
                        console.info('------------------------------')
                        console.info("Account Created Assets = %s", JSON.stringify(this.assetsCreated, null, 2));
                        console.info('------------------------------')
                        console.info("Account Created Assets Balance= %s", this.assetsHeldBalance);
                        console.info('------------------------------')
                        console.info("Account Held Assets = %s", JSON.stringify(this.assetsHeld, null, 2));
                        console.info('------------------------------')
                        console.info("Account Held Assets Balance= %s", + this.assetsHeldBalance);
                        console.info('------------------------------')
                        console.info("Account Created Apps = %s", JSON.stringify(this.appsCreated, null, 2));
                        console.info('------------------------------')
                        console.info("Account Created Apps Balance = %s", this.appsCreatedBalance);
                        console.info('------------------------------')
                    }
                }

            }
            let resTrx = await fetch(urlTrx, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            })
            let dataTrx = await resTrx.json()
            if (dataTrx) {
                if (dataTrx.transactions) {
                    this.trxPayment = dataTrx.transactions.filter(
                        (trx) => !!trx["payment-transaction"]
                    )
                    this.trxTransfer = dataTrx.transactions.filter(
                        (trx) => !!trx["asset-transfer-transaction"]
                    )
                    console.info('trxPayment: %s', this.trxPayment.length)
                    console.info('trxTransfer: %s', this.trxTransfer.length)

                }
            }


        }
    }
    /**
     * Converts a base64 string to an array of bytes.
     * 
     * @param {string} base64 - The base64 string to convert.
     * @returns {Uint8Array} - The array of bytes.
     */
    base64ToBytes(base64) {
        const binString = atob(base64);
        return Uint8Array.from(binString, (m) => m.codePointAt(0));
    }

    /**
     * Converts an array of bytes to a base64-encoded string.
     * @param {number[]} bytes - The array of bytes to convert.
     * @returns {string} The base64-encoded string.
     */
    bytesToBase64(bytes) {
        const binString = String.fromCodePoint(...bytes);
        return btoa(binString);
    }
    /**
     * Concatenates multiple arrays into a single Uint8Array.
     * 
     * @param {Array<Array<number>>} arrs - The arrays to be concatenated.
     * @returns {Uint8Array} - The concatenated Uint8Array.
     */
    concatArrays(arrs) {
        const size = arrs.reduce((sum, arr) => sum + arr.length, 0);
        const c = new Uint8Array(size);

        let offset = 0;
        for (let i = 0; i < arrs.length; i++) {
            c.set(arrs[i], offset);
            offset += arrs[i].length;
        }

        return c;
    }
    /**
     * Retrieves and prints transaction logs for a given transaction ID.
     * @param {string} txID - The transaction ID.
     * @param {number} round - The confirmed round of the transaction.
     * @returns {Promise<void>} - A promise that resolves once the logs are printed.
     */
    async printTransactionLogs(txID, round) {
        try {
            if (algosdk.isValidAddress(this.accountObject.addr)) {

                console.info(`The TxnID being logged: ${txID}`)
                //let txIDBase32Decoded = b32.decode(Buffer.from(txID))
                //console.log( txIDBase32Decoded.byteLength)
                const urlTrx = `${this.config.scanner.network === 'testnet' ? this.config.scanner['indexer_testnet_remote_server'] : this.config.scanner['indexer_remote_server']}/v2/transactions/${txID}`;

                let resTrx = await fetch(urlTrx, {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                    },
                })
                let dataTrx = await resTrx.json()

                if (dataTrx && dataTrx.transaction) {
                    if (dataTrx.transaction.logs) {
                        dataTrx.transaction.logs.map((item, index) => {
                            try {
                                if (Buffer.from(item, 'base64').byteLength === 8) {
                                    const buffer = Buffer.from(item, 'base64');
                                    let uint64Log = buffer.readUIntBE(2, 6)
                                    console.info(`Scanner TXN log [${index}]:uint64:  %s`, uint64Log)
                                } else {
                                    let log = atob(item)
                                    console.info(`Scanner TXN log [${index}]:ATOB bytes: %s`, log)
                                    // log = base32.encode(Buffer.from(item, 'base64'));
                                    // console.info(`Scanner TXN log [${index}]:BASE32 bytes: %s`, log.toUpperCase())
                                }
                            } catch (error) {
                                console.error(error)

                            }
                        })


                    }

                }
            }
        } catch (error) {
            console.error(error)
        }
    }
    /**
     * Prints the global state of an application.
     * @param {number} appId - The ID of the application.
     * @returns {Promise<void>} - A promise that resolves when the global state is printed.
     */
    async printAppGlobalState(appId) {
        if (algosdk.isValidAddress(this.accountObject.addr)) {
            const urlApp = `${this.config.scanner.network === 'testnet' ? this.config.scanner['algod_testnet_remote_server'] : this.config.scanner['algod_remote_server']}/v2/applications/${appId}`;

            let resApp = await fetch(urlApp, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            })
            let dataApp = await resApp.json()
            if (dataApp && dataApp.params) {
                if (dataApp.params["global-state"]) {
                    let gs = dataApp.params["global-state"];
                    let gsKeys = Object.keys(gs);
                    for (let i = 0; i < gsKeys.length; i++) {
                        let k = gsKeys[i];


                        let kv = gs[k];
                        let gsValueDecoded = null;
                        let keyStr = Buffer.from(
                            kv.key,
                            "base64"
                        ).toString();
                        console.info('Scanner App Global State Key: %s', keyStr)
                        if (kv.value.bytes !== "" && kv.value.uint === 0) {
                            try {
                                let buf = Buffer.from(kv.value.bytes, "base64");
                                let uintArr = new Uint8Array(buf);
                                let addr = algosdk.encodeAddress(uintArr);
                                if (algosdk.isValidAddress(addr)) {
                                    gsValueDecoded = algosdk.encodeAddress(uintArr);
                                } else {
                                    throw new Error();
                                }
                            } catch (error) {
                                let buf = Buffer.from(kv.value.bytes, "base64");
                                let uintArr = new Uint8Array(buf);
                                //uintArr = uintArr.slice(2, uintArr.length);
                                gsValueDecoded = new TextDecoder().decode(uintArr);
                            }
                        } else if (kv.value.uint > 0) {
                            gsValueDecoded = kv.value.uint;
                        }
                        console.info('Scanner GlobalState Uint64 value: %s', gsValueDecoded)
                    }
                }
            }


        }
    }
    /**
     * Prints the account balance, created assets, and their details.
     * @returns {Promise<void>} A promise that resolves once the printing is done.
     */
    async printCreatedAsset() {
        let accountInfo = await this.indexerClient.lookupAccountByID(this.accountObject.addr).do();
        this.accountBalance = accountInfo.account.amount
        this.assetsCreated = accountInfo['account']["created-assets"]
        this.assetsCreatedBalance = !!this.assetsCreated ? this.assetsCreated.length : 0

        console.info('------------------------------')
        console.info("Printed Account Balance = %s", this.accountBalance);
        console.info('------------------------------')
        console.info("Printed Account Created Assets = %s", JSON.stringify(!!this.assetsCreated ? this.assetsCreated.length : {}, null, 2));
        console.info('------------------------------')
        console.info("Printed Account Created Assets Balance= %s", this.assetsHeldBalance);
        console.info('------------------------------')

        if (!!this.assetsCreated) {
            for (let idx = 0; idx < accountInfo['account']['created-assets'].length; idx++) {
                let sAsset = accountInfo['account']['created-assets'][idx];
                if (assetid) {
                    if (sAsset['index'] == assetid) {
                        let params = JSON.stringify(sAsset['params'], null, 2);
                        console.info('------------------------------')
                        console.info("AssetID = %s", sAsset['index']);
                        console.info("Asset params = %s", params);
                        break;
                    }
                } else {
                    let params = JSON.stringify(sAsset['params'], null, 2);
                    console.info('------------------------------')
                    console.info("Created AssetID = %s", sAsset['index']);
                    console.info("Created Asset Info = %s", params);
                }
            }
        }
    }
    /**
     * Prints the asset holding information for a given account and asset ID.
     * @param {string} account - The account ID.
     * @param {string} assetid - The asset ID.
     * @returns {Promise<void>} - A promise that resolves when the asset holding information is printed.
     */
    async printAssetHolding(account, assetid) {
        let accountInfo = await this.indexerClient.lookupAccountByID(account).do();
        this.accountBalance = accountInfo.account.amount
        this.assetsHeld = accountInfo.account.assets
        this.assetsHeldBalance = !!this.assetsHeld ? this.assetsHeld.length : 0

        console.info('------------------------------')
        console.info("Printed Account Balance = %s", this.accountBalance);
        console.info('------------------------------')

        console.info("Printed Account Held Assets = %s", JSON.stringify(!!this.assetsHeld ? this.assetsHeld.length : {}, null, 2));
        console.info('------------------------------')
        console.info("Printed Account Held Assets Balance= %s", this.assetsHeldBalance);
        console.info('------------------------------')

        if (!!this.assetsHeld) {
            for (let idx = 0; idx < accountInfo['account']['assets'].length; idx++) {
                let sAsset = accountInfo['account']['assets'][idx];
                if (assetid) {
                    if (sAsset['asset-id'] == assetid) {
                        let assetHoldings = JSON.stringify(sAsset, null, 2);
                        console.info("Printed Held Asset Info = %s", assetHoldings);
                        break;
                    }
                } else {
                    let assetHoldings = JSON.stringify(sAsset, null, 2);
                    console.info('------------------------------')
                    console.info("Printed Held AssetID = %s", sAsset['asset-id']);
                    console.info("Printed Held Asset Info = %s", assetHoldings);
                }
            }
        }
    }
    /**
     * Generates a random integer between the specified minimum and maximum values.
     *
     * @param {number} min - The minimum value (inclusive).
     * @param {number} max - The maximum value (exclusive).
     * @returns {number} The random integer generated.
     */
    getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min)) + min;
    }
    /**
     * Generates a deployment report by fetching Algo wallet information,
     * printing created assets, and printing asset holdings.
     * 
     * @returns {Promise<void>} A promise that resolves when the deployment report is generated.
     */
    async deploymentReport() {
        try {
            await this.fetchAlgoWalletInfo();
            await this.printCreatedAsset();
            await this.printAssetHolding(this.accountObject.addr);
        }
        catch (err) {
            console.error(err);
        }
    }
    /**
     * Retrieves the deployment account for the scanner.
     * @returns {Promise<void>} A promise that resolves when the deployment account is retrieved.
     */
    async deploymentAccount() {
        try {
            const accounts = await this.importAccount();
            this.accountObject = accounts.acc
        }
        catch (err) {
            console.error(err);
        }
    }

    async printApplTransactionsFromBlocks() {
        let start_round = this.config.deployment['start_round']
        if (algosdk.isValidAddress(this.accountObject.addr)) {
            const urlTrx = `${this.config.scanner.network === 'testnet' ? this.config.scanner['algod_testnet_remote_server'] : this.config.scanner['algod_remote_server']}/v2/blocks/${start_round}`;

            let resTrx = await fetch(urlTrx, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            })
            let dataTrx = await resTrx.json()
            if (dataTrx) {
                if (dataTrx.block && dataTrx.block.txns) {
                    const block = dataTrx.block
                    dataTrx.block.txns.map((item, index) => {
                        if (item && item.txn) {
                            let innerTxnData = item.dt && item.dt.itx ? item.dt.itx : null;
                            if (!!innerTxnData) {
                                innerTxnData = innerTxnData.map((innerTxn, index) => {
                                    let itxnData = innerTxn.txn;
                                    if (itxnData.type = 'appl') {
                                        return itxnData
                                    }

                                })
                            }
                            let txnData = item.txn;
                            return {
                                txnData,
                                innerTxnData
                            }
                        }

                    })
                    fs.writeFileSync(path.join(__dirname, `round_${start_round}_scanned_txns.json`), JSON.stringify(block, null, 2))
                    return block
                }

            }

        }
    }
    /**
     * Runs the scanner.
     * @returns {Promise<void>} A promise that resolves when the scanner has finished running.
     */
    async run() {
        await this.deploymentAccount()
        if (this.config.deployment['deployment_report']) await this.deploymentReport();
        if (this.config.deployment['arc72_scanner_round']) await this.printApplTransactionsFromBlocks();
        process.exit();
    }
}