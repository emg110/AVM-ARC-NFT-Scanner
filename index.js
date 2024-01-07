const fs = require('fs');
const path = require('path');
const config = require('./config.json');
const Scanner = require('./scanner.js');
const { default: algosdk } = require('algosdk');

const folderPath = path.join(__dirname, 'rounds');
if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath);
    console.log(`Rounds output folder created: ${folderPath}`);
} else {
    console.log(`Rounds output folder already exists: ${folderPath}`);
}
let mnemonics = ""
try {
    mnemonics = fs.readFileSync(path.join(__dirname, 'arc-72_mnemonic.txt'), 'utf8')
} catch (error) {
    mnemonics = algosdk.secretKeyToMnemonic(algosdk.generateAccount().sk)
    console.info("mnemonics generated: ", mnemonics)
    fs.writeFileSync(path.join(__dirname, 'arc-72_mnemonic.txt'), mnemonics)
    console.info("mnemonics wrote to disk at root folder as arc-72_mnemonic.txt")
}
/**
 * Creates a new instance of the Scanner class.
 * @param {Object} options - The options for the scanner.
 * @param {string} options.mnemonic - The mnemonic for the scanner.
 * @param {Object} options.config - The configuration for the scanner.
 * @param {string} options.arc72ApprovalProgData - The approval program data for ARC-72.
 * @param {string} options.arc72ClearProgData - The clear program data for ARC-72.
 * @param {string} options.arc72Schema - The ABI schema for ARC-72.
 */
const scanner = new Scanner({
    mnemonic: mnemonics,
    config,
    arc72ApprovalProgData: fs.readFileSync(path.join(__dirname, 'arc72-app.teal')),
    arc72ClearProgData: fs.readFileSync(path.join(__dirname, 'arc72-clear.teal')),
    arc72Schema: fs.readFileSync(path.join(__dirname, 'arc72-abi.json')),
});
scanner.run();