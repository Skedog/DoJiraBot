const log = require('npmlog');
const Discord = require('discord.js');
const config = require('./config.js');
const { Permissions, Intents } = require('discord.js');
const discordClient = new Discord.Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES]});

async function start() {
	await connect();
	monitorDiscordChat();
}

async function connect() {
	discordClient.login(config.discordAPIKey);
	discordClient.on('ready', () => {
		log.info('Now monitoring Discord chat');
	});
}

function monitorDiscordChat() {
	discordClient.on('error', error => {
		log.error('An error occurred with the discord API:' + error);
	});
}

async function sendChatMessage(message) {
	discordClient.channels.cache.get(config.discordChannelID).send(message);
}

async function sendEmbedMessage(discordData) {
	const report = new Discord.MessageEmbed();
	report.setColor(discordData.color);
	report.setTitle(discordData.type);
	report.setURL(discordData.URLtoUse);
	if (discordData.description) {
		report.setDescription(discordData.description);
	}
	if (discordData.fieldTitle1 && discordData.fieldText1) {
		report.addField(discordData.fieldTitle1, discordData.fieldText1, false);
	}
	if (discordData.fieldTitle2 && discordData.fieldText2) {
		report.addField(discordData.fieldTitle2, discordData.fieldText2, false);
	}
	report.setTimestamp();
	report.setFooter(config.botName,'https://cdn.icon-icons.com/icons2/2699/PNG/512/atlassian_jira_logo_icon_170511.png');
	discordClient.channels.cache.get(config.discordChannelID).send({embeds: [report]});
}

module.exports = {
	start,
	sendChatMessage,
	sendEmbedMessage
};