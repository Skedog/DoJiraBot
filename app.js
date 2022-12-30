const log = require('npmlog');
const discord = require('./discord.js');
const express = require('./express.js');

async function init() {
	try {
		discord.start();
		express.start();
	} catch (err) {
		log.error(err);
	}
}
init();