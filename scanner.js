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
        this.approvalProgData = props.arc72ApprovalProgData
        this.clearProgData = props.arc72ClearProgData
        this.arc72Contract = props.arc72Contract

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
    /**
     * Executes the ARC72 transferFrom method.
     * @param {number} index - The index of the token to transfer.
     * @returns {Promise<void>} - A promise that resolves when the transfer is complete.
     */
    async callArc72TransferFrom(index) {
        let addr = this.accountObject.addr;
        let params = await this.algodClient.getTransactionParams().do();
        let application = Number(this.applicationId)
        let applicationAddress = this.applicationAddr
        const arc72Contract = new algosdk.ABIContract(JSON.parse(this.arc72Contract.toString()))
        const signer = algosdk.makeBasicAccountTransactionSigner(this.accountObject)


        const atc = new algosdk.AtomicTransactionComposer()
        let methodTransferFrom = this.getMethodByName("arc72_transferFrom", arc72Contract)


        // let appEncode = algosdk.encodeUint64(application)
        // let tokenIndexEncode = algosdk.encodeUint256(index)
        const args = [
            applicationAddress,
            addr,
            Number(`${application}${index}`)
        ];
        let appCallNote = algosdk.encodeObj(
            JSON.stringify({
                arc72: `transfer token ${application}${index}from ${applicationAddress} to ${addr}!`,
            })
        );
        //let acc_decoded = algosdk.decodeAddress(addr);
        atc.addMethodCall({
            signer: signer,
            note: appCallNote,
            sender: addr,
            suggestedParams: params,
            appID: application,
            method: methodTransferFrom,
            accounts: [
                addr,
            ],

            methodArgs: args,
        });
        console.info('------------------------------')
        console.info("ARC72 Contract ABI Exec method = %s", methodTransferFrom);
        let tokenId = Number(BigInt('0x' + Buffer.from(atc.transactions[0].txn.appArgs[3]).toString('hex')))
        let signature = Buffer.from(atc.transactions[0].txn.appArgs[0]).toString('hex');
        const resultTransferFrom = await atc.execute(this.algodClient, 10);
        for (const idx in resultTransferFrom.methodResults) {
            let txid = resultTransferFrom.txIDs[idx]
            let confirmedRound = resultTransferFrom.confirmedRound
            console.info(`ARC72 TransferFrom ABI call TXId =  %s`, txid);
            console.info(`ARC72 TransferFrom ABI call TXN confirmed round =  %s`, confirmedRound);
            fs.writeFileSync(path.join(__dirname, 'start_round.txt'), `${confirmedRound}`)
            if (Number(idx) === 0) await this.printTransactionLogs(txid, confirmedRound)

        }
    }
    /**
     * Retrieves the approval program of an application identified by its ID.
     * @param {number} appId - The ID of the application.
     * @returns {string} - The decoded approval program of the application.
     */
    async getApplicationTeal(appId) {
        let appInfo = await this.algodClient.getApplicationByID(appId).do();
        if (appInfo && appInfo.params) {
            if (appInfo.params["approval-program"]) {
                let approvalProgram = appInfo.params["approval-program"];
                let clearProgram = appInfo.params["clear-state-program"];
                let approvalProgramDecoded = Buffer.from(
                    approvalProgram,
                    "base64"
                ).toString();
                let clearProgramDecoded = Buffer.from(
                    clearProgram,
                    "base64"
                ).toString();
                console.info('------------------------------')
                console.info("ARC72 Application Approval Program = %s", approvalProgramDecoded);
                console.info('------------------------------')
                console.info("ARC72 Application Clear Program = %s", clearProgramDecoded);
                console.info('------------------------------')
                return approvalProgramDecoded
            }
        }
    }
    /**
     * Deploys the ARC 72 contract.
     * @returns {Promise<void>} A promise that resolves when the contract is deployed.
     */
    async deployArc72Contract() {
        let addr = this.accountObject.addr;
        let localInts = this.config.deployment['num_local_int'];
        let localBytes = this.config.deployment['num_local_byte'];
        let globalInts = this.config.deployment['num_global_int'];
        let globalBytes = this.config.deployment['num_global_byte'];
        let params = await this.algodClient.getTransactionParams().do();
        let onComplete = algosdk.OnApplicationComplete.NoOpOC;

        const compiledResult = await this.algodClient.compile(this.approvalProgData).do();
        const compiledClearResult = await this.algodClient.compile(this.clearProgData).do();
        const compiledResultUint8 = new Uint8Array(Buffer.from(compiledResult.result, "base64"));
        const compiledClearResultUint8 = new Uint8Array(Buffer.from(compiledClearResult.result, "base64"));
        console.info('------------------------------')
        console.info("ARC 72 Contract Hash = %s", compiledResult.hash);
        //console.info("ARC 72 Contract Result = %s", compiledResult.result)
        console.info("ARC 72 Clear Hash = %s", compiledClearResult.hash);
        //console.info("ARC 72 Clear Result = %s", compiledClearResult.result);
        params.fee = 1000
        params.flatFee = true
        let appTxn = algosdk.makeApplicationCreateTxnFromObject({
            from: addr, suggestedParams: params, onComplete,
            approvalProgram: compiledResultUint8, clearProgram: compiledClearResultUint8,
            numLocalInts: localInts, numLocalByteSlices: localBytes, numGlobalInts: globalInts, numGlobalByteSlices: globalBytes, extraPages: 0
        });
        let appTxnId = appTxn.txID().toString();

        console.info('------------------------------')
        console.info("ARC 72 Application Creation TXId =  %s", appTxnId);
        let signedAppTxn = appTxn.signTxn(this.accountObject.sk);
        await this.algodClient.sendRawTransaction(signedAppTxn).do();
        await algosdk.waitForConfirmation(this.algodClient, appTxnId, 5)

        let transactionResponse = await this.algodClient.pendingTransactionInformation(appTxnId).do();
        let appId = transactionResponse['application-index'];
        await this.printTransactionLogs(appTxnId)
        await this.printAppGlobalState(appId)
        console.info('------------------------------')
        console.info("ARC 72 Transaction ID: %s", appTxnId);
        console.info('------------------------------')
        console.info("ARC 72 Transaction Confirmed Round: %s", transactionResponse['confirmed-round']);
        console.info('------------------------------')
        console.info("ARC 72 Application ID: %s", appId);
        console.info('------------------------------')
        // fs.writeFileSync(path.join(__dirname, 'start_round.txt'), `${transactionResponse['confirmed-round']}`)
        this.applicationId = appId
        this.applicationAddr = algosdk.getApplicationAddress(appId);
        await this.callArc72TransferFrom(1)
        // await this.callArc72TransferFrom(2)
        // await this.callArc72TransferFrom(3)
        console.info('------------------------------')
        console.info("ARC 72 Application Address: %s", algosdk.getApplicationAddress(Number(appId)));
        console.info('------------------------------')
    }
    /**
     * Checks if the given app is an ARC-72 app.
     * @param {string} apap - The app to check.
     * @returns {boolean} - True if the app is an ARC-72 app, false otherwise.
     */
    async checkIfAppIsArc72(apap) {
        let apapBinary = Buffer.from(apap, 'base64');
        //apapBinary = apapBinary.slice(2, apapBinary.length)
        try {
            let decodedApap = await this.algodClient.disassemble(apapBinary)
            console.log(decodedApap)
            if (decodedApap.source) {
                let tealSource = Buffer.from(decodedApap.source).toString();
                console.info(tealSource)
                if (tealSource.indexOf('0x53f02a40') > -1) {
                    return true
                }
            }
            return false

        } catch (error) {
            console.error(error)
            return false
        }

        // if (decodedApap.indexOf('0x53f02a40') > -1) {
        //     return true
        // }
        // return false

    }

    /**
     * Prints application transactions from blocks.
     * @async
     * @function printApplTransactionsFromBlocks
     * @memberof Scanner
     * @returns {Promise<void>}
     */
    async printApplTransactionsFromBlocks() {
        let start_round = Number(fs.readFileSync(path.join(__dirname, 'start_round.txt'), 'utf8')) || this.config.deployment['start_round'];
        if (algosdk.isValidAddress(this.accountObject.addr) && start_round > 0) {
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
                    let txns = dataTrx.block.txns
                    const txnsLength = txns.length
                    console.info("Scanned Block round: %s", start_round)
                    console.info("Number of TXNs in scanned block: %s", txnsLength)
                    let scannedTxns = []
                    txns =  txns.map(async(item, index) => {
                        if (item && item.txn) {
                            //let itxns = item.dt && item.dt.itx ? item.dt.itx : null;
                            // if (!!itxns) {
                            //     itxns = itxns.map(async (itxn, index) => {
                            //         let itxnData = itxn.txn;
                            //         if (itxnData.type = 'appl' && itxnData['apap']) {
                            //             let isArc72 = await this.checkIfAppIsArc72(itxnData['apap'])
                            //             if (isArc72) {
                            //                 return itxnData
                            //             }
                            //         }
                            //     })
                            // }
                            let txn = null;
                            if (item.txn && item.txn.type && item.txn.type === 'appl' && item.txn['apap'] && !item.txn['apid']) {
                                let isArc72 = await this.checkIfAppIsArc72(item.txn['apap'])
                                txn = isArc72 ? item.txn : null;
                            }
                            if (item.txn && item.txn.type && item.txn.type === 'appl' && item.txn['apid'] && item.txn['apaa'] /* && item.txn['apar'].length === 4 */) {
                                let args = item.txn['apaa']
                                if (args.length === 4 && Buffer.from(args[0], 'base64').toString('hex') === "f2f194a0") {
                                    txn = item.txn
                                }
                            }
                            if (!!txn /* || !!itxns */) {
                                
                                let indexerUrl = "https://avm-arc-nft-indexer-testnet.emg110.workers.dev/api/v1/tokens"
                                let ownerBuffer = Buffer.from(txn.apaa[2], 'base64')
                                let ownerBufferLength = ownerBuffer.length
                                let decodedAddress = algosdk.encodeAddress(ownerBuffer)
                                console.log(decodedAddress)
                                let indexerRes = await fetch(indexerUrl, {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                        round: Number(start_round),
                                        contractId: txn.txn['apid'],
                                        tokenId: Number(BigInt('0x' + Buffer.from(txn.txn.apaa[3]).toString('hex'))),
                                        owner: decodedAddress,
                                    }),
                                })
                                if (indexerRes.status === 200) {
                                    scannedTxns.push(txn)
                                }
                            }

                        }
                    })
                    fs.writeFileSync(path.join(__dirname, `rounds/round_${start_round}_scanned_txns.json`), JSON.stringify(scannedTxns, null, 2))
                    console.info("Number of ARC72 token transfer TXNs in block: %s", scannedTxns.length)
                    

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
        if (this.config.deployment['arc72_deploy']) await this.deployArc72Contract();
        if (this.config.deployment['arc72_scanner_round']) await this.printApplTransactionsFromBlocks();
        process.exit();
    }
}