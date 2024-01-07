const fs = require('fs');
const path = require('path');
const config = require('./config.json');
const logger = require('./logger');
const Scanner = require('./scanner.js');
/**
 * Creates a new instance of the Scanner class.
 * @param {Object} options - The options for the scanner.
 * @param {string} options.mnemonic - The mnemonic for the scanner.
 * @param {Object} options.config - The configuration for the scanner.
 * @param {Object} options.logger - The logger for the scanner.
 * @param {string} options.arc72ApprovalProgData - The approval program data for ARC-72.
 * @param {string} options.arc72ClearProgData - The clear program data for ARC-72.
 * @param {string} options.arc72Schema - The ABI schema for ARC-72.
 */
const scanner = new Scanner({
    mnemonic: fs.readFileSync(path.join(__dirname, 'arc-72_mnemonic.txt'), 'utf8'),
    config,
    logger,
    arc72ApprovalProgData: fs.readFileSync(path.join(__dirname, 'arc-72-main.teal')),
    arc72ClearProgData: fs.readFileSync(path.join(__dirname, 'arc-72-clear.teal')),
    arc72Schema: fs.readFileSync(path.join(__dirname, 'arc-72-abi.json')),

});
scanner.run();